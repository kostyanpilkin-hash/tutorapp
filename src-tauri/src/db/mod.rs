pub mod migrations;
pub mod pool;

use chrono::{Duration, Utc};
use pool::DbPool;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub pool: DbPool,
    pub db_path: PathBuf,
    pub scheduler_running: Arc<std::sync::atomic::AtomicBool>,
}

pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("TutorApp");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn db_path() -> PathBuf {
    app_data_dir().join("tutor.db")
}

pub fn backup_db(path: &Path) {
    let backup = path.with_extension("db.bak");
    if path.exists() {
        let _ = fs::copy(path, backup);
    }
}

pub fn init_db() -> Result<AppState, String> {
    let path = db_path();
    backup_db(&path);

    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-20000;")
        .map_err(|e| e.to_string())?;
    migrations::run(&conn)?;
    if let Err(e) = crate::commands::lessons::dedupe_all_exception_slots(&conn) {
        eprintln!("Exception dedupe on startup: {e}");
    }
    conn.execute(
        "DELETE FROM reminder_snoozes WHERE snooze_until < ?1",
        params![(Utc::now() - Duration::days(1)).to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;

    let pool = DbPool {
        conn: Mutex::new(conn),
    };

    Ok(AppState {
        pool,
        db_path: path,
        scheduler_running: Arc::new(std::sync::atomic::AtomicBool::new(true)),
    })
}
