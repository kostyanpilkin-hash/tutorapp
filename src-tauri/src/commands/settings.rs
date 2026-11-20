use crate::db::AppState;
use rusqlite::params;
use std::collections::HashMap;

/// Settings the UI may read and write. Everything else in `settings` —
/// Telegram token and pairing code, phone key, migration flags, internal
/// state — stays inside the backend.
const PUBLIC_SETTINGS: &[&str] = &[
    "language",
    "theme",
    "timezone",
    "default_duration",
    "default_reminders",
    "default_calendar_view",
    "default_page",
    "default_currency",
    "onboarding_done",
    "payment_details",
    "reminder_snooze",
    "message_templates",
    "tg_fields",
    "tg_offsets",
    "tg_digest_time",
    "tg_quiet_from",
    "tg_quiet_to",
];

pub(crate) fn public_settings(conn: &rusqlite::Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        if PUBLIC_SETTINGS.contains(&k.as_str()) {
            map.insert(k, v);
        }
    }
    Ok(map)
}

pub(crate) fn set_public_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    if !PUBLIC_SETTINGS.contains(&key) {
        return Err(format!("Настройка «{key}» не изменяется из интерфейса"));
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<AppState>) -> Result<HashMap<String, String>, String> {
    state.pool.with_conn(public_settings)
}

#[tauri::command]
pub fn set_setting(
    state: tauri::State<AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.pool.with_conn(|conn| set_public_setting(conn, &key, &value))
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
    })
}

#[tauri::command]
pub fn get_db_path(state: tauri::State<AppState>) -> Result<String, String> {
    Ok(state.db_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn backup_database(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    use chrono::Local;
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

    let receipt = state
        .pool
        .with_conn(|conn| crate::db::backup::create_snapshot(conn, &path))?;
    Ok(Some(receipt.path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&c).unwrap();
        c.execute_batch(
            "INSERT OR REPLACE INTO settings (key, value) VALUES
               ('tg_token', 'SECRET-TOKEN'), ('phone_key', 'SECRET-KEY'), ('tg_pair_code', '123456'),
               ('migration_exception_slot_dedupe_v1', 'x'), ('theme', 'dark'), ('tg_quiet_from', '22:00');",
        )
        .unwrap();
        c
    }

    #[test]
    fn get_settings_does_not_return_secret_values() {
        let map = public_settings(&conn()).unwrap();
        assert_eq!(map.get("theme").map(String::as_str), Some("dark"));
        assert_eq!(map.get("tg_quiet_from").map(String::as_str), Some("22:00"));
        for secret in ["tg_token", "phone_key", "tg_pair_code", "migration_exception_slot_dedupe_v1"] {
            assert!(!map.contains_key(secret), "{secret} leaked to the UI");
        }
        assert!(!map.values().any(|v| v.contains("SECRET")));
    }

    #[test]
    fn ui_cannot_overwrite_backend_settings() {
        let c = conn();
        assert!(set_public_setting(&c, "tg_token", "attacker").is_err());
        assert!(set_public_setting(&c, "phone_key", "attacker").is_err());
        assert!(set_public_setting(&c, "phone_server_enabled", "1").is_err());
        let token: String = c.query_row("SELECT value FROM settings WHERE key='tg_token'", [], |r| r.get(0)).unwrap();
        assert_eq!(token, "SECRET-TOKEN");
        set_public_setting(&c, "theme", "light").unwrap();
        assert_eq!(public_settings(&c).unwrap()["theme"], "light");
    }
}
