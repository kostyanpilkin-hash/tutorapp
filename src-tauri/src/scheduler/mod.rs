use crate::db::AppState;
use crate::commands::reminders::{clear_reminder_snooze, reminder_snooze_until};
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, serde::Serialize)]
struct ReminderPayload {
    lesson_id: String,
    student_name: String,
    subject: String,
    start_at: String,
    link: Option<String>,
    minutes_before: i64,
}

fn show_reminder_toast(app: &AppHandle, title: &str, body: &str) {
    #[cfg(windows)]
    {
        crate::windows_toast::ensure_app_toast_identity(app).ok();
        crate::windows_toast::show_app_toast(app, title, body);
    }
    #[cfg(not(windows))]
    {
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}

pub fn start_scheduler(app: AppHandle, running: Arc<AtomicBool>) {
    let running_clone = running.clone();

    std::thread::spawn(move || {
        while running_clone.load(Ordering::Relaxed) {
            if let Some(state) = app.try_state::<AppState>() {
                if let Err(e) = check_reminders(&app, &state) {
                    eprintln!("Reminder check error: {e}");
                }
            }
            // Check every 30 seconds, but allow for faster shutdown
            for _ in 0..30 {
                if !running_clone.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn fire_reminder(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    lesson_id: &str,
    student_name: &str,
    subject: &str,
    instance_start: DateTime<Utc>,
    link: &Option<String>,
    minutes_before: i64,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let instance_key = instance_start.to_rfc3339();
    let base_remind_at = instance_start - Duration::minutes(minutes_before);
    let remind_at = reminder_snooze_until(conn, lesson_id, &instance_key, minutes_before)?
        .map(|until| until.max(base_remind_at))
        .unwrap_or(base_remind_at);
    let diff = (now - remind_at).abs().num_seconds();
    if diff > 60 {
        return Ok(());
    }

    let fired: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM fired_reminders WHERE lesson_id=?1 AND instance_start=?2 AND minutes_before=?3",
            params![lesson_id, instance_key, minutes_before],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if fired > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT OR IGNORE INTO fired_reminders (lesson_id, instance_start, minutes_before, fired_at) VALUES (?1,?2,?3,?4)",
        params![lesson_id, instance_key, minutes_before, now.to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    clear_reminder_snooze(conn, lesson_id, &instance_key, minutes_before)?;

    let when = if minutes_before == 0 {
        "сейчас".to_string()
    } else if minutes_before >= 60 {
        format!("через {} ч", minutes_before / 60)
    } else {
        format!("через {} мин", minutes_before)
    };

    let body = format!("{subject} — {student_name} ({when})");
    show_reminder_toast(app, "Напоминание о занятии", &body);

    let _ = app.emit(
        "lesson-reminder",
        ReminderPayload {
            lesson_id: lesson_id.to_string(),
            student_name: student_name.to_string(),
            subject: subject.to_string(),
            start_at: instance_key,
            link: link.clone(),
            minutes_before,
        },
    );
    Ok(())
}

fn check_reminders(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let now = Utc::now();
    let horizon = now + Duration::hours(48);
    let lookback = now - Duration::hours(1);

    state.pool.with_conn(|conn| {
        // Single source of truth: occurrences::collect expands series,
        // resolves exceptions and drops cancelled slots — same as the UI,
        // the bot and the phone page. `row_id` is the lesson_id the
        // reminder/snooze keys are stored under.
        let tz = crate::occurrences::timezone(conn);
        let occs = crate::occurrences::collect(
            conn,
            tz,
            lookback.with_timezone(&tz).date_naive(),
            horizon.with_timezone(&tz).date_naive(),
        )?;

        let mut stmt = conn
            .prepare("SELECT minutes_before FROM reminders WHERE lesson_id = ?1")
            .map_err(|e| e.to_string())?;

        for occ in occs {
            if occ.status != "scheduled" {
                continue;
            }
            if occ.start_utc < lookback || occ.start_utc > horizon {
                continue;
            }
            let minutes: Vec<i64> = stmt
                .query_map(params![&occ.row_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            for mb in minutes {
                fire_reminder(
                    app,
                    conn,
                    &occ.row_id,
                    &occ.name,
                    &occ.subject,
                    occ.start_utc,
                    &occ.link,
                    mb,
                    now,
                )?;
            }
        }
        Ok(())
    })
}
