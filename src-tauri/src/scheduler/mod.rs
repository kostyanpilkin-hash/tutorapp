use crate::db::AppState;
use crate::commands::reminders::{clear_reminder_snooze, reminder_snooze_until};
use crate::recurrence::{expand_weekly_starts, is_weekly};
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

struct LessonReminderRow {
    id: String,
    student_name: String,
    subject: String,
    start_at: DateTime<Utc>,
    link: Option<String>,
    recurrence_rule: Option<String>,
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
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.student_name, l.subject, l.start_at, l.link, l.recurrence_rule, r.minutes_before
                 FROM lessons l
                 JOIN reminders r ON r.lesson_id = l.id
                 WHERE l.status = 'scheduled'
                   AND (l.recurrence_parent_id IS NULL OR l.recurrence_parent_id = '')",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut lessons = Vec::new();
        for row in rows {
            let (id, student_name, subject, start_at, link, recurrence_rule, minutes_before) =
                row.map_err(|e| e.to_string())?;
            let start: DateTime<Utc> = start_at
                .parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())?;
            lessons.push(LessonReminderRow {
                id,
                student_name,
                subject,
                start_at: start,
                link,
                recurrence_rule,
                minutes_before,
            });
        }

        // Exception instance starts keyed by parent id: (instance_ts, status)
        let mut exceptions: std::collections::HashMap<String, Vec<(i64, String)>> =
            std::collections::HashMap::new();
        {
            let mut estmt = conn
                .prepare(
                    "SELECT recurrence_parent_id, recurrence_instance_date, status
                     FROM lessons
                     WHERE recurrence_parent_id IS NOT NULL AND recurrence_parent_id != ''
                       AND recurrence_instance_date IS NOT NULL",
                )
                .map_err(|e| e.to_string())?;
            let erows = estmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in erows {
                let (parent_id, instance_date, status) = row.map_err(|e| e.to_string())?;
                if let Ok(dt) = instance_date.parse::<DateTime<Utc>>() {
                    exceptions
                        .entry(parent_id)
                        .or_default()
                        .push((dt.timestamp(), status));
                }
            }
        }

        for lesson in lessons {
            let starts = if is_weekly(&lesson.recurrence_rule) {
                expand_weekly_starts(lesson.start_at, &lesson.recurrence_rule, lookback, horizon)
            } else if lesson.start_at >= lookback && lesson.start_at <= horizon {
                vec![lesson.start_at]
            } else {
                vec![]
            };

            for instance_start in starts {
                if let Some(list) = exceptions.get(&lesson.id) {
                    if list
                        .iter()
                        .any(|(ts, _)| *ts == instance_start.timestamp())
                    {
                        // Any exception for this slot replaces the series instance.
                        continue;
                    }
                }
                fire_reminder(
                    app,
                    conn,
                    &lesson.id,
                    &lesson.student_name,
                    &lesson.subject,
                    instance_start,
                    &lesson.link,
                    lesson.minutes_before,
                    now,
                )?;
            }
        }

        // Fire only for scheduled exception lessons (their own start_at).
        let mut estmt = conn
            .prepare(
                "SELECT l.id, l.student_name, l.subject, l.start_at, l.link, r.minutes_before
                 FROM lessons l
                 JOIN reminders r ON r.lesson_id = l.id
                 WHERE l.status = 'scheduled'
                   AND l.recurrence_parent_id IS NOT NULL AND l.recurrence_parent_id != ''",
            )
            .map_err(|e| e.to_string())?;
        let erows = estmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in erows {
            let (id, student_name, subject, start_at, link, minutes_before) =
                row.map_err(|e| e.to_string())?;
            let start: DateTime<Utc> = start_at
                .parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())?;
            if start < lookback || start > horizon {
                continue;
            }
            fire_reminder(
                app,
                conn,
                &id,
                &student_name,
                &subject,
                start,
                &link,
                minutes_before,
                now,
            )?;
        }

        Ok(())
    })
}
