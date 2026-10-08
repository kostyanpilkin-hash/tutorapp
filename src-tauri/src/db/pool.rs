use rusqlite::Connection;
use std::sync::Mutex;

pub struct DbPool {
    pub conn: Mutex<Connection>,
}

impl DbPool {
    pub fn with_conn<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String>,
    {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        f(&conn)
    }
}
