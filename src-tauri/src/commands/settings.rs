use crate::db::AppState;
use rusqlite::params;
use std::collections::HashMap;

#[tauri::command]
pub fn get_settings(state: tauri::State<AppState>) -> Result<HashMap<String, String>, String> {
    state.pool.with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|e| e.to_string())?;
            map.insert(k, v);
        }
        Ok(map)
    })
}

#[tauri::command]
pub fn set_setting(
    state: tauri::State<AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_db_path(state: tauri::State<AppState>) -> Result<String, String> {
    Ok(state.db_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn backup_database(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    use chrono::Local;
    use std::fs;
    use std::path::PathBuf;

    let src = &state.db_path;
    if !src.exists() {
        return Err("Файл базы данных не найден".to_string());
    }

    let stamp = Local::now().format("%Y%m%d_%H%M%S");
    let default_name = format!("tutor-backup-{stamp}.db");
    let suggested = src
        .parent()
        .map(|p| p.join(&default_name))
        .unwrap_or_else(|| PathBuf::from(&default_name));

    let dest = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .set_directory(suggested.parent().unwrap_or(src.parent().unwrap_or(std::path::Path::new("."))))
        .add_filter("SQLite", &["db"])
        .save_file();

    let Some(path) = dest else {
        return Ok(None);
    };

    // Checkpoint WAL so backup is consistent
    let _ = state.pool.with_conn(|conn| {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(FULL);");
        Ok(())
    });

    fs::copy(src, &path).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}
