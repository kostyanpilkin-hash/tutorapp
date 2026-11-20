use crate::db::AppState;
use crate::domain::identity::{exception_rank, parse_slot_key};
use chrono::Utc;
use rusqlite::{params, Connection};
use super::*;

/// Resolves the exception row for one slot inside the caller's transaction.
/// Extra rows of the same slot are archived (undoable) before removal; rows
/// with an unparseable instance key never match and are never deleted.
pub(crate) fn dedupe_exceptions_for_instance(
    conn: &Connection,
    parent_id: &str,
    instance_date: &str,
) -> Result<Option<String>, String> {
    let tz = crate::occurrences::timezone(conn);
    let target = parse_slot_key(parent_id, instance_date, tz).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, recurrence_instance_date, status,
                    COALESCE(updated_at, ''), COALESCE(created_at, '')
             FROM lessons
             WHERE recurrence_parent_id = ?1
               AND recurrence_instance_date IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut matches: Vec<(String, String, String, String)> = Vec::new();
    for row in rows {
        let (id, inst, status, updated, created) = row.map_err(|e| e.to_string())?;
        if parse_slot_key(parent_id, &inst, tz).as_ref() == Ok(&target) {
            matches.push((id, status, updated, created));
        }
    }
    if matches.is_empty() {
        return Ok(None);
    }
    matches.sort_by(|a, b| exception_rank(&b.1, &b.2, &b.3, &b.0).cmp(&exception_rank(&a.1, &a.2, &a.3, &a.0)));
    let keep = matches[0].0.clone();
    let extra: Vec<String> = matches.into_iter().skip(1).map(|m| m.0).collect();
    if !extra.is_empty() {
        archive_rows(conn, "exception_dedupe", &extra)?;
        for id in &extra {
            delete_lesson_cascade(conn, id)?;
        }
    }
    Ok(Some(keep))
}

const DEDUPE_MIGRATION_KEY: &str = "migration_exception_slot_dedupe_v1";

/// One-time cleanup of duplicate exception rows (same parent + local date).
/// Only the rows `identity::scan_exception_slots` marks as `extra` are
/// touched: archived first (restorable via `restore_lesson_archive`), then
/// deleted, all in one transaction together with the done-flag. Invalid keys
/// are never touched. The caller must take a verified snapshot first.
/// Returns the number of archived rows.
pub(crate) fn exception_dedupe_done(conn: &Connection) -> bool {
    conn.query_row("SELECT 1 FROM settings WHERE key = ?1", params![DEDUPE_MIGRATION_KEY], |_| Ok(()))
        .is_ok()
}

pub(crate) fn run_exception_dedupe_migration(conn: &Connection) -> Result<usize, String> {
    if exception_dedupe_done(conn) {
        return Ok(0);
    }
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| -> Result<usize, String> {
        let tz = crate::occurrences::timezone(conn);
        let extra: Vec<String> = crate::domain::identity::scan_exception_slots(conn, tz)?
            .duplicates
            .into_iter()
            .flat_map(|g| g.extra)
            .collect();
        if !extra.is_empty() {
            let archive_id = archive_rows(conn, "exception_dedupe", &extra)?;
            for id in &extra {
                delete_lesson_cascade(conn, id)?;
            }
            if !crate::domain::identity::scan_exception_slots(conn, tz)?.duplicates.is_empty() {
                return Err("duplicates remain after cleanup".into());
            }
            log_activity(conn, "lesson", "exception_dedupe", None, None, None, None, Some(&extra.len().to_string()), Some(&archive_id));
        }
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![DEDUPE_MIGRATION_KEY, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(extra.len())
    })();
    match result {
        Ok(n) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(n)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

pub(crate) fn archive_rows(
    conn: &Connection,
    action: &str,
    lesson_ids: &[String],
) -> Result<String, String> {
    if lesson_ids.is_empty() {
        return Ok(String::new());
    }
    let archive_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO lesson_archive (id, action, created_at) VALUES (?1, ?2, ?3)",
        params![archive_id, action, Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    for id in lesson_ids {
        conn.execute(
            &format!(
                "INSERT INTO archived_lessons (archive_id, {LESSON_COLS}) SELECT ?1, {LESSON_COLS} FROM lessons WHERE id = ?2"
            ),
            params![archive_id, id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO archived_lesson_students (archive_id, lesson_id, student_id, cost, currency, payment_status)
             SELECT ?1, lesson_id, student_id, cost, currency, payment_status FROM lesson_students WHERE lesson_id = ?2",
            params![archive_id, id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO archived_reminders (archive_id, id, lesson_id, minutes_before)
             SELECT ?1, id, lesson_id, minutes_before FROM reminders WHERE lesson_id = ?2",
            params![archive_id, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(archive_id)
}

/// Deletes "this and following": truncates the series before the instance
/// and removes future exceptions. Past history is preserved.
/// Returns archive id for undo.
#[tauri::command]
pub fn delete_lesson_series_from_instance(
    state: tauri::State<AppState>,
    id: String,
    instance_date: String,
) -> Result<String, String> {
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<String, String> {
            // Resolve parent id
            let parent_id: String = conn
                .query_row(
                    "SELECT COALESCE(NULLIF(recurrence_parent_id, ''), id) FROM lessons WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;

            let rule: Option<String> = conn
                .query_row(
                    "SELECT recurrence_rule FROM lessons WHERE id = ?1",
                    params![parent_id],
                    |r| r.get(0),
                )
                .ok()
                .flatten();

            // Collect exception rows at/after instance_date
            let mut estmt = conn
                .prepare("SELECT id FROM lessons WHERE recurrence_parent_id = ?1 AND recurrence_instance_date >= ?2")
                .map_err(|e| e.to_string())?;
            let exception_ids: Vec<String> = estmt
                .query_map(params![parent_id, instance_date], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            // Archive everything we touch: parent (rule change) + exceptions
            let mut ids = vec![parent_id.clone()];
            ids.extend(exception_ids.clone());
            let archive_id = archive_rows(conn, "series_delete_from_instance", &ids)?;
            let pname: Option<String> = conn
                .query_row(
                    "SELECT student_name FROM lessons WHERE id = ?1",
                    params![parent_id],
                    |r| r.get(0),
                )
                .ok()
                .map(|n: String| {
                    lesson_display_name(conn, &parent_id, &n).unwrap_or(n)
                });
            log_activity(
                conn,
                "lesson",
                "series_deleted_from",
                Some(&parent_id),
                pname.as_deref(),
                Some("start_at"),
                None,
                Some(&instance_date),
                Some(&archive_id),
            );

            // Truncate series: strip COUNT/UNTIL, set UNTIL = day before instance
            if let Some(rule) = rule {
                if !rule.is_empty() {
                    let base: Vec<&str> = rule
                        .split(';')
                        .filter(|p| {
                            let u = p.to_uppercase();
                            !u.starts_with("UNTIL=") && !u.starts_with("COUNT=")
                        })
                        .collect();
                    let until = chrono::DateTime::parse_from_rfc3339(&instance_date)
                        .map(|d| (d - chrono::Duration::days(1)).to_rfc3339())
                        .map_err(|e| e.to_string())?;
                    let new_rule = format!("{};UNTIL={}", base.join(";"), until);
                    conn.execute(
                        "UPDATE lessons SET recurrence_rule = ?2, updated_at = ?3 WHERE id = ?1",
                        params![parent_id, new_rule, Utc::now().to_rfc3339()],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }

            // Delete future exceptions
            for eid in &exception_ids {
                conn.execute("DELETE FROM lessons WHERE id = ?1", params![eid])
                    .map_err(|e| e.to_string())?;
            }
            Ok(archive_id)
        })();
        match result {
            Ok(v) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(v)
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })
}

#[tauri::command]
pub fn restore_lesson_archive(
    state: tauri::State<AppState>,
    archive_id: String,
) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let restored: Option<(String, String)> = conn
                .query_row(
                    "SELECT id, student_name FROM archived_lessons WHERE archive_id = ?1 ORDER BY (recurrence_parent_id IS NULL OR recurrence_parent_id = '') DESC LIMIT 1",
                    params![archive_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            conn.execute(
                &format!("INSERT OR REPLACE INTO lessons ({LESSON_COLS}) SELECT {LESSON_COLS} FROM archived_lessons WHERE archive_id = ?1"),
                params![archive_id],
            )
            .map_err(|e| e.to_string())?;
            if let Some((lid, lname)) = &restored {
                log_activity(conn, "lesson", "restored", Some(lid), Some(lname), None, None, None, None);
            }
            conn.execute(
                "INSERT OR IGNORE INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
                 SELECT lesson_id, student_id, cost, currency, payment_status FROM archived_lesson_students WHERE archive_id = ?1",
                params![archive_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR IGNORE INTO reminders (id, lesson_id, minutes_before)
                 SELECT id, lesson_id, minutes_before FROM archived_reminders WHERE archive_id = ?1",
                params![archive_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM archived_lessons WHERE archive_id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM archived_lesson_students WHERE archive_id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM archived_reminders WHERE archive_id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM lesson_archive WHERE id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        match result {
            Ok(v) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(v)
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })
}

