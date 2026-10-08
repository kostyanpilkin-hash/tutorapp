use crate::db::{app_data_dir, AppState};
use chrono::Utc;
use rusqlite::params;
use std::fs;

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