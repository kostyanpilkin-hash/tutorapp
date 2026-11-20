//! Consistent SQLite snapshots through the online backup API.
//!
//! Copying `tutor.db` with `fs::copy` misses committed pages that still live
//! in the WAL and can tear while another connection writes. The backup API
//! reads a consistent image (restarting if another connection writes
//! mid-copy). The snapshot is written to `<dest>.partial`, verified, and only
//! then renamed over `dest`, so a failure never replaces the last good copy.

use rusqlite::backup::{Backup, StepResult};
use rusqlite::Connection;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const PAGES_PER_STEP: i32 = 256;
const BUSY_PAUSE: Duration = Duration::from_millis(100);
const MAX_BUSY_RETRIES: u32 = 50;

/// A verified snapshot (integrity_check passed) at `path`.
#[derive(Debug)]
pub struct BackupReceipt {
    pub path: PathBuf,
}

pub fn create_snapshot(source: &Connection, destination: &Path) -> Result<BackupReceipt, String> {
    if let Some(src) = source.path().filter(|p| !p.is_empty()) {
        if canonical(Path::new(src)) == canonical(destination) {
            return Err("Нельзя сохранить копию поверх рабочей базы".into());
        }
    }
    let partial = with_suffix(destination, ".partial");
    remove_partial(&partial);
    match write_and_verify(source, &partial) {
        Ok(()) => {
            fs::rename(&partial, destination).map_err(|e| {
                remove_partial(&partial);
                format!("Не удалось сохранить копию: {e}")
            })?;
            Ok(BackupReceipt { path: destination.to_path_buf() })
        }
        Err(e) => {
            remove_partial(&partial);
            Err(e)
        }
    }
}

fn write_and_verify(source: &Connection, partial: &Path) -> Result<(), String> {
    let mut dst = Connection::open(partial).map_err(|e| format!("Не удалось создать копию: {e}"))?;
    {
        let backup = Backup::new(source, &mut dst).map_err(|e| e.to_string())?;
        let mut retries = 0;
        loop {
            match backup.step(PAGES_PER_STEP).map_err(|e| e.to_string())? {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => {
                    retries += 1;
                    if retries > MAX_BUSY_RETRIES {
                        return Err("База занята, копия не создана — повторите позже".into());
                    }
                    thread::sleep(BUSY_PAUSE);
                }
                // StepResult is non_exhaustive.
                _ => return Err("Неизвестный результат резервного копирования".into()),
            }
        }
    }
    // A self-contained single file: no -wal/-shm needed to open the copy.
    dst.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let integrity: String = dst
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err(format!("Копия не прошла проверку целостности: {integrity}"));
    }
    dst.close().map_err(|(_, e)| e.to_string())
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Removes only our own temporary file and its journals.
fn remove_partial(partial: &Path) {
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let p = with_suffix(partial, suffix);
        if p.is_file() {
            let _ = fs::remove_file(p);
        }
    }
}

fn canonical(p: &Path) -> Option<PathBuf> {
    fs::canonicalize(p).ok().or_else(|| {
        let dir = fs::canonicalize(p.parent()?).ok()?;
        Some(dir.join(p.file_name()?))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("tutor-backup-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// WAL db with auto-checkpoint off: committed rows stay in -wal.
    fn wal_db(dir: &Path) -> (PathBuf, Connection) {
        let path = dir.join("tutor.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
             CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
             PRAGMA wal_checkpoint(TRUNCATE);
             INSERT INTO t (v) VALUES ('committed-in-wal');",
        )
        .unwrap();
        (path, conn)
    }

    fn rows(path: &Path) -> i64 {
        let c = Connection::open(path).unwrap();
        c.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap_or(-1)
    }

    #[test]
    fn plain_file_copy_misses_wal_but_snapshot_does_not() {
        let dir = TempDir::new();
        let (path, conn) = wal_db(&dir.0);
        assert!(fs::metadata(with_suffix(&path, "-wal")).unwrap().len() > 0);

        let copied = dir.0.join("copied.db");
        fs::copy(&path, &copied).unwrap();
        assert_eq!(rows(&copied), 0, "baseline: fs::copy loses WAL-only commits");

        let snap = dir.0.join("snap.db");
        let receipt = create_snapshot(&conn, &snap).unwrap();
        assert_eq!(receipt.path, snap);
        assert_eq!(rows(&snap), 1);
        assert!(!with_suffix(&snap, "-wal").exists());
        assert!(!with_suffix(&snap, ".partial").exists());
    }

    #[test]
    fn snapshot_includes_commit_from_second_writer() {
        let dir = TempDir::new();
        let (path, conn) = wal_db(&dir.0);
        let other = Connection::open(&path).unwrap();
        other.execute("INSERT INTO t (v) VALUES ('other-writer')", []).unwrap();
        let snap = dir.0.join("snap.db");
        create_snapshot(&conn, &snap).unwrap();
        assert_eq!(rows(&snap), 2);
    }

    #[test]
    fn snapshot_succeeds_while_another_connection_holds_write_lock() {
        let dir = TempDir::new();
        let (path, conn) = wal_db(&dir.0);
        let other = Connection::open(&path).unwrap();
        other.execute_batch("BEGIN IMMEDIATE; INSERT INTO t (v) VALUES ('uncommitted');").unwrap();
        let snap = dir.0.join("snap.db");
        create_snapshot(&conn, &snap).unwrap();
        assert_eq!(rows(&snap), 1, "uncommitted rows must not leak into the snapshot");
        other.execute_batch("ROLLBACK").unwrap();
    }

    #[test]
    fn backup_onto_source_is_rejected() {
        let dir = TempDir::new();
        let (path, conn) = wal_db(&dir.0);
        let err = create_snapshot(&conn, &path).unwrap_err();
        assert!(err.contains("рабочей базы"));
        assert_eq!(rows(&path), 1);
    }

    #[test]
    fn unavailable_destination_fails_cleanly() {
        let dir = TempDir::new();
        let (_path, conn) = wal_db(&dir.0);
        let missing = dir.0.join("no-such-dir").join("snap.db");
        assert!(create_snapshot(&conn, &missing).is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn failure_keeps_last_good_copy() {
        let dir = TempDir::new();
        let (_path, conn) = wal_db(&dir.0);
        let snap = dir.0.join("snap.db");
        create_snapshot(&conn, &snap).unwrap();
        conn.execute("INSERT INTO t (v) VALUES ('later')", []).unwrap();
        // Block the temp file: a directory where `<snap>.partial` should go.
        fs::create_dir(with_suffix(&snap, ".partial")).unwrap();
        assert!(create_snapshot(&conn, &snap).is_err());
        assert_eq!(rows(&snap), 1, "previous snapshot must survive a failed backup");
    }

    #[test]
    fn repeated_snapshot_replaces_previous() {
        let dir = TempDir::new();
        let (_path, conn) = wal_db(&dir.0);
        let snap = dir.0.join("snap.db");
        create_snapshot(&conn, &snap).unwrap();
        conn.execute("INSERT INTO t (v) VALUES ('later')", []).unwrap();
        create_snapshot(&conn, &snap).unwrap();
        assert_eq!(rows(&snap), 2);
    }
}
