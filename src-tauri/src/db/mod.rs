pub mod migrations;
pub mod pool;

use pool::DbPool;
use rusqlite::Connection;
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
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    migrations::run(&conn)?;

    let pool = DbPool {
        conn: Mutex::new(conn),
    };

    Ok(AppState {
        pool,
        db_path: path,
        scheduler_running: Arc::new(std::sync::atomic::AtomicBool::new(true)),
    })
}
