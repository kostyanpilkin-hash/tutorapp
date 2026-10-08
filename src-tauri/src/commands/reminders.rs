use crate::db::AppState;
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiredReminderEntry {
    lesson_id: String,
    instance_start: String,
    minutes_before: i64,
    fired_at: Option<String>,
    student_name: String,
    subject: String,
    link: Option<String>,
}

pub(crate) fn reminder_snooze_until(
    conn: &rusqlite::Connection,
    lesson_id: &str,
    instance_start: &str,
    minutes_before: i64,
) -> Result<Option<DateTime<Utc>>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT snooze_until FROM reminder_snoozes
             WHERE lesson_id = ?1 AND instance_start = ?2 AND minutes_before = ?3",
            params![lesson_id, instance_start, minutes_before],
            |row| row.get(0),
        )
        .ok();
    Ok(raw.and_then(|value| value.parse::<DateTime<Utc>>().ok()))
}

pub(crate) fn clear_reminder_snooze(
    conn: &rusqlite::Connection,
    lesson_id: &str,
    instance_start: &str,
    minutes_before: i64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM reminder_snoozes
         WHERE lesson_id = ?1 AND instance_start = ?2 AND minutes_before = ?3",
        params![lesson_id, instance_start, minutes_before],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_fired_reminders(
    state: tauri::State<AppState>,
    limit: Option<i64>,
) -> Result<Vec<FiredReminderEntry>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    state.pool.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT fr.lesson_id, fr.instance_start, fr.minutes_before, fr.fired_at,
                        COALESCE(l.student_name, ''), COALESCE(l.subject, ''), l.link
                 FROM fired_reminders fr
                 LEFT JOIN lessons l ON l.id = fr.lesson_id
                 ORDER BY COALESCE(fr.fired_at, fr.instance_start) DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(FiredReminderEntry {
                    lesson_id: row.get(0)?,
                    instance_start: row.get(1)?,
                    minutes_before: row.get(2)?,
                    fired_at: row.get(3)?,
                    student_name: row.get(4)?,
                    subject: row.get(5)?,
                    link: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn snooze_reminder(
    state: tauri::State<AppState>,
    lesson_id: String,
    instance_start: String,
    minutes_before: i64,
    snooze_minutes: i64,
) -> Result<(), String> {
    if snooze_minutes <= 0 {
        return Err("snooze_minutes must be positive".to_string());
    }

    state.pool.with_conn(|conn| {
        let snooze_until = (Utc::now() + Duration::minutes(snooze_minutes)).to_rfc3339();
        conn.execute(
            "INSERT INTO reminder_snoozes (lesson_id, instance_start, minutes_before, snooze_until)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(lesson_id, instance_start, minutes_before)
             DO UPDATE SET snooze_until = excluded.snooze_until",
            params![lesson_id, instance_start, minutes_before, snooze_until],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM fired_reminders
             WHERE lesson_id = ?1 AND instance_start = ?2 AND minutes_before = ?3",
            params![lesson_id, instance_start, minutes_before],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
