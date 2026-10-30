use crate::db::{app_data_dir, AppState};
use chrono::Utc;
use rusqlite::params;
use std::fs;

fn link_update_subquery() -> &'static str {
    r#"
    SELECT l.id
    FROM lessons l
    JOIN lesson_students ls ON l.id = ls.lesson_id
    WHERE ls.student_id = ?1
      AND l.start_at >= ?2
      AND (SELECT COUNT(*) FROM lesson_students WHERE lesson_id = l.id) = 1
      AND l.link IS DISTINCT FROM ?3
    "#
}

fn count_student_lessons_for_link_update_conn(
    conn: &rusqlite::Connection,
    student_id: &str,
    link: Option<&str>,
    now: &str,
) -> Result<i64, rusqlite::Error> {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM ({})", link_update_subquery()),
        params![student_id, now, link],
        |r| r.get(0),
    )
}

fn update_student_lessons_link_conn(
    conn: &rusqlite::Connection,
    student_id: &str,
    link: Option<&str>,
    now: &str,
) -> Result<i64, rusqlite::Error> {
    let subquery = link_update_subquery()
        .replace("?3", "?5")
        .replace("?2", "?4")
        .replace("?1", "?3");
    conn.execute(
        &format!(
            "UPDATE lessons SET link = ?1, updated_at = ?2 WHERE id IN ({})",
            subquery
        ),
        params![link, now, student_id, now, link],
    )?;
    Ok(conn.changes() as i64)
}

#[tauri::command]
pub fn count_student_lessons_for_link_update(
    state: tauri::State<AppState>,
    student_id: String,
    link: Option<String>,
) -> Result<i64, String> {
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        count_student_lessons_for_link_update_conn(conn, &student_id, link.as_deref(), &now)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn update_student_lessons_link(
    state: tauri::State<AppState>,
    student_id: String,
    link: Option<String>,
) -> Result<i64, String> {
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        update_student_lessons_link_conn(conn, &student_id, link.as_deref(), &now)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn update_student_lessons_currency(
    state: tauri::State<AppState>,
    student_id: String,
    currency: String,
    cost: f64,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        conn.execute(
            "UPDATE lesson_students SET currency = ?1, cost = ?2 WHERE student_id = ?3",
            params![currency, cost, student_id],
        )
        .map_err(|e| e.to_string())?;

        // Update the base lesson row only for single-student lessons,
        // so other students' data is never touched.
        conn.execute(
            "UPDATE lessons SET currency = ?1, cost = ?2, updated_at = ?3
             WHERE id IN (
               SELECT lesson_id FROM lesson_students
               GROUP BY lesson_id
               HAVING COUNT(*) = 1 AND MIN(student_id) = ?4
             )",
            params![currency, cost, now, student_id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

#[tauri::command]
pub fn get_student_settings_log(
    state: tauri::State<AppState>,
    student_id: Option<String>,
) -> Result<Vec<crate::models::StudentSettingsLog>, String> {
    state.pool.with_conn(|conn| {
        let mut logs: Vec<crate::models::StudentSettingsLog> = Vec::new();

        if let Some(sid) = student_id {
            let mut stmt = conn.prepare(
                "SELECT id, student_id, field, old_value, new_value, changed_at
                 FROM student_settings_log
                 WHERE student_id = ?1
                 ORDER BY changed_at DESC"
            )
            .map_err(|e| e.to_string())?;

            let rows = stmt.query_map(params![sid], |row| {
                Ok(crate::models::StudentSettingsLog {
                    id: row.get(0)?,
                    student_id: row.get(1)?,
                    field: row.get(2)?,
                    old_value: row.get(3)?,
                    new_value: row.get(4)?,
                    changed_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

            for row in rows {
                logs.push(row.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, student_id, field, old_value, new_value, changed_at
                 FROM student_settings_log
                 ORDER BY changed_at DESC"
            )
            .map_err(|e| e.to_string())?;

            let rows = stmt.query_map([], |row| {
                Ok(crate::models::StudentSettingsLog {
                    id: row.get(0)?,
                    student_id: row.get(1)?,
                    field: row.get(2)?,
                    old_value: row.get(3)?,
                    new_value: row.get(4)?,
                    changed_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

            for row in rows {
                logs.push(row.map_err(|e| e.to_string())?);
            }
        }

        Ok(logs)
    })
}

#[tauri::command]
pub fn get_activity_log(
    state: tauri::State<AppState>,
    category: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<crate::models::ActivityLogEntry>, String> {
    state.pool.with_conn(|conn| {
        let lim = limit.unwrap_or(100);
        let off = offset.unwrap_or(0);
        let mut stmt = conn
            .prepare(
                "SELECT id, category, action, entity_id, entity_name, field, old_value, new_value, details, created_at
                 FROM activity_log
                 WHERE (?1 IS NULL OR category = ?1)
                 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![category, lim, off], |row| {
                Ok(crate::models::ActivityLogEntry {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    action: row.get(2)?,
                    entity_id: row.get(3)?,
                    entity_name: row.get(4)?,
                    field: row.get(5)?,
                    old_value: row.get(6)?,
                    new_value: row.get(7)?,
                    details: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn apply_prepaid_lessons(
    state: tauri::State<AppState>,
    student_id: String,
) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        let prepaid: i64 = conn
            .query_row(
                "SELECT paid_lessons FROM students WHERE id = ?1",
                params![student_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if prepaid <= 0 {
            return Ok(());
        }

        let mut stmt = conn
            .prepare(
                "SELECT ls.lesson_id FROM lesson_students ls
                 JOIN lessons l ON l.id = ls.lesson_id
                 WHERE ls.student_id = ?1 AND ls.payment_status = 'unpaid'
                 ORDER BY l.start_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![student_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .take(prepaid as usize)
            .collect();
        drop(stmt);

        let applied = ids.len() as i64;
        for lesson_id in &ids {
            conn.execute(
                "UPDATE lesson_students SET payment_status = 'paid'
                 WHERE lesson_id = ?1 AND student_id = ?2",
                params![lesson_id, student_id],
            )
            .map_err(|e| e.to_string())?;
            let others: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM lesson_students WHERE lesson_id = ?1 AND payment_status != 'paid'",
                    params![lesson_id],
                    |r| r.get(0),
                )
                .unwrap_or(1);
            if others == 0 {
                let _ = conn.execute(
                    "UPDATE lessons SET payment_status = 'paid' WHERE id = ?1",
                    params![lesson_id],
                );
            }
        }

        conn.execute(
            "UPDATE students SET paid_lessons = MAX(0, paid_lessons - ?2), updated_at = ?3 WHERE id = ?1",
            params![student_id, applied, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        if applied > 0 {
            let name: Option<String> = conn
                .query_row("SELECT name FROM students WHERE id = ?1", params![student_id], |r| r.get(0))
                .ok();
            super::lessons::log_activity(
                conn,
                "finance",
                "prepaid_applied",
                Some(&student_id),
                name.as_deref(),
                Some("paid_lessons"),
                None,
                Some(&applied.to_string()),
                None,
            );
        }
        Ok(())
    })
}

#[tauri::command]
pub fn get_student_photo_data_url(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::path::PathBuf;

    let allowed_root = app_data_dir()
        .canonicalize()
        .unwrap_or_else(|_| app_data_dir());
    let file_path = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !file_path.starts_with(&allowed_root) {
        return Err("Invalid file path".to_string());
    }
    if !file_path.exists() {
        return Err("File not found".to_string());
    }

    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let mime = match file_path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    };
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};
    use rusqlite::{Connection, params};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn
    }

    fn insert_student(conn: &Connection, id: &str, name: &str) {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO students (id, name, notes, archived, created_at, updated_at)
             VALUES (?1, ?2, '', 0, ?3, ?3)",
            params![id, name, now],
        )
        .unwrap();
    }

    fn insert_lesson(
        conn: &Connection,
        id: &str,
        start_at: &str,
        link: Option<&str>,
        students: &[&str],
    ) {
        let now = Utc::now().to_rfc3339();
        let student_name = students
            .first()
            .map(|sid| {
                conn.query_row(
                    "SELECT name FROM students WHERE id = ?1",
                    params![sid],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_default()
            })
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, status, payment_status, created_at, updated_at)
             VALUES (?1, ?2, 'Math', ?3, 60, 20.0, 'USD', ?4, '', '', 'scheduled', 'unpaid', ?5, ?5)",
            params![id, student_name, start_at, link, now],
        )
        .unwrap();
        for sid in students {
            conn.execute(
                "INSERT INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
                 VALUES (?1, ?2, NULL, NULL, 'unpaid')",
                params![id, sid],
            )
            .unwrap();
        }
    }

    #[test]
    fn link_update_counts_only_future_single_student_lessons() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        let future = (Utc::now() + Duration::days(1)).to_rfc3339();
        let past = (Utc::now() - Duration::days(1)).to_rfc3339();
        insert_lesson(&conn, "l_future", &future, None, &["s1"]);
        insert_lesson(&conn, "l_past", &past, None, &["s1"]);

        let now = Utc::now().to_rfc3339();
        let count = count_student_lessons_for_link_update_conn(&conn, "s1", Some("https://meet"), &now).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn link_update_excludes_group_lessons() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_student(&conn, "s2", "Maria");
        let future = (Utc::now() + Duration::days(1)).to_rfc3339();
        insert_lesson(&conn, "l_single", &future, None, &["s1"]);
        insert_lesson(&conn, "l_group", &future, None, &["s1", "s2"]);

        let now = Utc::now().to_rfc3339();
        let count = count_student_lessons_for_link_update_conn(&conn, "s1", Some("https://meet"), &now).unwrap();
        assert_eq!(count, 1);

        let updated = update_student_lessons_link_conn(&conn, "s1", Some("https://meet"), &now).unwrap();
        assert_eq!(updated, 1);

        let single_link: Option<String> = conn
            .query_row("SELECT link FROM lessons WHERE id = 'l_single'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(single_link.as_deref(), Some("https://meet"));

        let group_link: Option<String> = conn
            .query_row("SELECT link FROM lessons WHERE id = 'l_group'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(group_link.as_deref(), None);
    }

    #[test]
    fn link_update_skips_lessons_with_same_link() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        let future = (Utc::now() + Duration::days(1)).to_rfc3339();
        insert_lesson(&conn, "l_same", &future, Some("https://meet"), &["s1"]);

        let now = Utc::now().to_rfc3339();
        let count = count_student_lessons_for_link_update_conn(&conn, "s1", Some("https://meet"), &now).unwrap();
        assert_eq!(count, 0);
    }
}