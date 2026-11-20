pub mod backup;
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

/// Startup snapshot `tutor.db.bak`, taken before migrations run. On failure
/// the previous `.bak` stays as is.
fn startup_snapshot(conn: &Connection, path: &Path) {
    if let Err(e) = backup::create_snapshot(conn, &path.with_extension("db.bak")) {
        eprintln!("Startup snapshot failed: {e}");
    }
}

/// One-time duplicate-exception cleanup. Runs only after its own verified,
/// never-overwritten snapshot `tutor.db.pre-exception-dedupe.bak`; rows are
/// also archived, so the cleanup is undoable either way.
fn exception_dedupe(conn: &Connection, path: &Path) {
    use crate::commands::lessons::{exception_dedupe_done, run_exception_dedupe_migration};
    if exception_dedupe_done(conn) {
        return;
    }
    let snap = path.with_extension("db.pre-exception-dedupe.bak");
    // If a previous attempt already left its snapshot, keep that older copy.
    if !snap.exists() {
        if let Err(e) = backup::create_snapshot(conn, &snap) {
            eprintln!("Exception dedupe skipped, snapshot failed: {e}");
            return;
        }
    }
    match run_exception_dedupe_migration(conn) {
        Ok(n) => eprintln!("Exception dedupe: archived {n} duplicate row(s)"),
        Err(e) => eprintln!("Exception dedupe failed, nothing changed: {e}"),
    }
}

pub fn init_db() -> Result<AppState, String> {
    let path = db_path();
    let existed = path.exists();

    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-20000;")
        .map_err(|e| e.to_string())?;
    if existed {
        startup_snapshot(&conn, &path);
    }
    migrations::run(&conn)?;
    if existed {
        exception_dedupe(&conn, &path);
    }
    // Diagnostics: invalid keys (never touched) and anything left over.
    match crate::domain::identity::scan_exception_slots(&conn, crate::occurrences::timezone(&conn)) {
        Ok(scan) => {
            for g in &scan.duplicates {
                eprintln!(
                    "Exception slot duplicate: parent {} on {} keeps {}, extra {:?}",
                    g.key.parent_id, g.key.local_date, g.keep, g.extra
                );
            }
            for i in &scan.invalid {
                eprintln!("Exception slot invalid: row {} (parent {}): {}", i.row_id, i.parent_id, i.reason);
            }
        }
        Err(e) => eprintln!("Exception slot scan failed: {e}"),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(dir: &Path) -> (PathBuf, Connection) {
        let path = dir.join("tutor.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        migrations::run(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO lessons (id, student_name, start_at, status, recurrence_rule, created_at, updated_at)
               VALUES ('p1', 'X', '2026-11-02T10:00:00Z', 'scheduled', 'FREQ=WEEKLY;BYDAY=MO', '1', '1');
             INSERT INTO lessons (id, student_name, start_at, status, recurrence_parent_id, recurrence_instance_date, created_at, updated_at)
               VALUES ('keep', 'X', '2026-11-09T10:00:00Z', 'completed', 'p1', '2026-11-09T10:00:00Z', '2', '2'),
                      ('extra', 'X', '2026-11-09T10:00:00Z', 'cancelled', 'p1', '2026-11-09T10:00:00Z', '1', '1');",
        )
        .unwrap();
        (path, conn)
    }

    fn has(path: &Path, id: &str) -> bool {
        Connection::open(path)
            .unwrap()
            .query_row("SELECT 1 FROM lessons WHERE id = ?1", [id], |_| Ok(()))
            .is_ok()
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("tutor-dedupe-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn dedupe_runs_after_its_own_snapshot() {
        let dir = tmp();
        let (path, conn) = fixture(&dir);
        exception_dedupe(&conn, &path);
        let snap = path.with_extension("db.pre-exception-dedupe.bak");
        assert!(has(&snap, "extra"), "pre-cleanup snapshot keeps the original row");
        assert!(!has(&path, "extra"));
        assert!(has(&path, "keep"));
        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Rehearsal on a COPY of a real DB: `DEDUPE_DB=<copy> cargo test dedupe_rehearsal -- --ignored --nocapture`.
    /// Prints only counts and per-currency sums.
    #[test]
    #[ignore]
    fn dedupe_rehearsal() {
        let path = PathBuf::from(std::env::var("DEDUPE_DB").expect("DEDUPE_DB"));
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        let stats = |c: &Connection| {
            let n: i64 = c.query_row("SELECT COUNT(*) FROM lessons", [], |r| r.get(0)).unwrap();
            let debts = crate::commands::finance::debt_lessons(c).unwrap();
            let mut sums: std::collections::BTreeMap<String, f64> = Default::default();
            for d in debts {
                *sums.entry(d.currency).or_default() += d.cost;
            }
            let fk: i64 = c.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
            let ic: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
            (n, sums, fk, ic)
        };
        println!("before: {:?}", stats(&conn));
        exception_dedupe(&conn, &path);
        println!("after:  {:?}", stats(&conn));
        let dups = crate::domain::identity::scan_exception_slots(&conn, crate::occurrences::timezone(&conn)).unwrap();
        println!("remaining duplicate groups: {}, invalid: {}", dups.duplicates.len(), dups.invalid.len());
    }

    #[test]
    fn dedupe_is_skipped_when_snapshot_fails() {
        let dir = tmp();
        let (path, conn) = fixture(&dir);
        // Snapshot target blocked by a directory of the same name.
        fs::create_dir(path.with_extension("db.pre-exception-dedupe.bak.partial")).unwrap();
        let blocked = path.with_extension("db.pre-exception-dedupe.bak");
        assert!(!blocked.exists());
        exception_dedupe(&conn, &path);
        assert!(has(&path, "extra"), "no snapshot, no cleanup");
        assert!(!crate::commands::lessons::exception_dedupe_done(&conn));
        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }
}
