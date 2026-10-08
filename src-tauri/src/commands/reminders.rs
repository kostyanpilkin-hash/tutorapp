use crate::db::AppState;
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use std::collections::HashMap;

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

fn reminder_key(lesson_id: &str, instance_start: &str, minutes_before: i64) -> String {
    format!("{lesson_id}|{instance_start}|{minutes_before}")
}

fn load_snooze_map(conn: &rusqlite::Connection) -> Result<HashMap<String, String>, String> {
    let raw: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'reminder_snooze'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "{}".to_string());
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn save_snooze_map(
    conn: &rusqlite::Connection,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    let value = serde_json::to_string(map).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('reminder_snooze', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn reminder_snooze_until(
    conn: &rusqlite::Connection,
    lesson_id: &str,
    instance_start: &str,
    minutes_before: i64,
) -> Result<Option<DateTime<Utc>>, String> {
    let map = load_snooze_map(conn)?;
    Ok(map
        .get(&reminder_key(lesson_id, instance_start, minutes_before))
        .and_then(|value| value.parse::<DateTime<Utc>>().ok()))
}

pub(crate) fn clear_reminder_snooze(
    conn: &rusqlite::Connection,
    lesson_id: &str,
    instance_start: &str,
    minutes_before: i64,
) -> Result<(), String> {
    let mut map = load_snooze_map(conn)?;
    map.remove(&reminder_key(lesson_id, instance_start, minutes_before));
    save_snooze_map(conn, &map)
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
        let mut map = load_snooze_map(conn)?;
        let snooze_until = (Utc::now() + Duration::minutes(snooze_minutes)).to_rfc3339();
        map.insert(
            reminder_key(&lesson_id, &instance_start, minutes_before),
            snooze_until,
        );
        save_snooze_map(conn, &map)?;
        conn.execute(
            "DELETE FROM fired_reminders
             WHERE lesson_id = ?1 AND instance_start = ?2 AND minutes_before = ?3",
            params![lesson_id, instance_start, minutes_before],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
