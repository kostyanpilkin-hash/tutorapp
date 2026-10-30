use crate::db::AppState;
use crate::models::{Lesson, LessonInput};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;
use validator::Validate;

mod activity_log;
mod archive;
mod overlaps;
mod repo;

pub(crate) use activity_log::{lesson_with_children, log_activity, log_lesson_diff};
pub(crate) use archive::{
    archive_rows, dedupe_all_exception_slots, dedupe_exceptions_for_instance,
};
pub use archive::{delete_lesson_series_from_instance, restore_lesson_archive};
pub(crate) use overlaps::{find_overlaps, overlap_error};
pub use overlaps::check_overlaps;
pub(crate) use repo::{
    delete_lesson_cascade, insert_reminders, load_lesson_by_id, resolve_lesson_color,
    row_to_lesson, same_instant_str, save_lesson_students, student_names,
};

const LESSON_SELECT: &str = "SELECT id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, materials_link, status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, color, created_at, updated_at";
#[tauri::command]
pub fn get_lessons(
    state: tauri::State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<Lesson>, String> {
    state.pool.with_conn(|conn| {
        let _ = dedupe_all_exception_slots(conn);
        let mut stmt = conn
            .prepare(&format!(
                "{LESSON_SELECT} FROM lessons WHERE (start_at >= ?1 AND start_at <= ?2)
                 OR (recurrence_rule IS NOT NULL AND recurrence_rule != ''
                     AND (recurrence_parent_id IS NULL OR recurrence_parent_id = '')
                     AND start_at <= ?2)
                 OR (recurrence_parent_id IS NOT NULL AND recurrence_parent_id != ''
                     AND recurrence_instance_date IS NOT NULL
                     AND recurrence_instance_date >= ?1 AND recurrence_instance_date <= ?2)
                 ORDER BY start_at ASC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from, to], |row| row_to_lesson(conn, row))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}
pub fn get_lessons_for_student(
    state: &AppState,
    student_id: &str,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<Lesson>, String> {
    state.pool.with_conn(|conn| {
        let _ = dedupe_all_exception_slots(conn);
        if let (Some(f), Some(t)) = (from, to) {
            let mut stmt = conn
                .prepare(&format!(
                    "{LESSON_SELECT} FROM lessons l WHERE l.id IN (SELECT lesson_id FROM lesson_students WHERE student_id = ?1) AND l.start_at >= ?2 AND l.start_at <= ?3 ORDER BY l.start_at DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![student_id, f, t], |row| row_to_lesson(conn, row))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        } else {
            let mut stmt = conn
                .prepare(&format!(
                    "{LESSON_SELECT} FROM lessons l WHERE l.id IN (SELECT lesson_id FROM lesson_students WHERE student_id = ?1) ORDER BY l.start_at DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![student_id], |row| row_to_lesson(conn, row))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        }
    })
}
#[tauri::command]
pub fn get_lesson(state: tauri::State<AppState>, id: String) -> Result<Lesson, String> {
    state.pool.with_conn(|conn| load_lesson_by_id(conn, &id))
}

/// Expands recurring series into concrete instances over `[from_dt, to_dt]`
/// (instants). Generated instances get frontend-compatible `parent::ISO`
/// ids (`toISOString` format) and inherit every field from the parent row,
/// including students and reminders. Exceptions/singles keep their real ids.
pub(crate) fn expanded_lessons_in_range(
    conn: &Connection,
    from_dt: DateTime<Utc>,
    to_dt: DateTime<Utc>,
) -> Result<Vec<Lesson>, String> {
    let _ = dedupe_all_exception_slots(conn);
    let tz = crate::occurrences::timezone(conn);
    let occs = crate::occurrences::collect(
        conn,
        tz,
        from_dt.with_timezone(&tz).date_naive(),
        to_dt.with_timezone(&tz).date_naive(),
    )?;
    let mut out = Vec::with_capacity(occs.len());
    for occ in occs {
        // `collect` filters by local date; keep exact instant bounds like the frontend.
        if occ.start_utc < from_dt || occ.start_utc > to_dt {
            continue;
        }
        let mut lesson = load_lesson_by_id(conn, &occ.row_id)?;
        if let Some(iso) = &occ.instance_iso {
            lesson.id = format!("{}::{}", occ.row_id, iso);
            lesson.start_at = iso.clone();
            lesson.recurrence_instance_date = Some(iso.clone());
        }
        out.push(lesson);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_expanded_lessons(
    state: tauri::State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<Lesson>, String> {
    let from_dt = from
        .parse::<DateTime<Utc>>()
        .map_err(|e: chrono::ParseError| e.to_string())?;
    let to_dt = to
        .parse::<DateTime<Utc>>()
        .map_err(|e: chrono::ParseError| e.to_string())?;
    state.pool.with_conn(|conn| expanded_lessons_in_range(conn, from_dt, to_dt))
}
#[tauri::command]
pub fn create_lesson(
    state: tauri::State<AppState>,
    input: LessonInput,
) -> Result<Lesson, String> {
    if let Err(errors) = input.validate() {
        return Err(format!("Ошибка валидации: {}", errors));
    }

    if !input.force {
        let parent = input
            .recurrence_parent_id
            .as_ref()
            .filter(|s| !s.is_empty());
        let instance = input
            .recurrence_instance_date
            .as_ref()
            .filter(|s| !s.is_empty());
        let moved = match (parent, instance) {
            (Some(_), Some(inst)) => {
                match (
                    inst.parse::<DateTime<Utc>>(),
                    input.start_at.parse::<DateTime<Utc>>(),
                ) {
                    (Ok(slot), Ok(start)) => slot.timestamp() != start.timestamp(),
                    _ => true,
                }
            }
            _ => false,
        };
        if parent.is_none() || moved {
            let start: DateTime<Utc> = input
                .start_at
                .parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())?;
            let exclude = match (parent, instance) {
                (Some(p), Some(inst)) => Some(format!("{p}::{inst}")),
                _ => None,
            };
            let overlaps = state.pool.with_conn(|conn| {
                find_overlaps(conn, start, input.duration_minutes, exclude.as_deref())
            })?;
            if let Some(err) = overlap_error(&overlaps) {
                return Err(err);
            }
        }
    }

    // Exception for a series slot: update existing row instead of creating duplicates.
    if let (Some(parent_id), Some(instance_date)) = (
        input
            .recurrence_parent_id
            .as_ref()
            .filter(|s| !s.is_empty()),
        input
            .recurrence_instance_date
            .as_ref()
            .filter(|s| !s.is_empty()),
    ) {
        let existing_id = state.pool.with_conn(|conn| {
            conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
            let result = (|| -> Result<Option<String>, String> {
                let keep = dedupe_exceptions_for_instance(conn, parent_id, instance_date)?;
                let Some(keep_id) = keep else {
                    return Ok(None);
                };
                let student_name = student_names(conn, &input.students)?;
                let color = resolve_lesson_color(conn, &input.students, &input.color);
                let now = Utc::now().to_rfc3339();
                conn.execute(
                    "UPDATE lessons SET student_name=?2, subject=?3, start_at=?4, duration_minutes=?5, cost=?6, currency=?7, link=?8, notes=?9, materials=?10, materials_link=?11, status=?12, payment_status=?13, recurrence_rule=?14, recurrence_parent_id=?15, recurrence_instance_date=?16, color=?17, updated_at=?18 WHERE id=?1",
                    params![
                        keep_id,
                        student_name,
                        input.subject,
                        input.start_at,
                        input.duration_minutes,
                        input.cost,
                        input.currency,
                        input.link,
                        input.notes,
                        input.materials,
                        input.materials_link,
                        input.status,
                        input.payment_status,
                        Option::<String>::None,
                        input.recurrence_parent_id,
                        input.recurrence_instance_date,
                        color,
                        now,
                    ],
                )
                .map_err(|e| e.to_string())?;
                save_lesson_students(
                    conn,
                    &keep_id,
                    &input.students,
                    input.cost,
                    input.currency.clone(),
                    &input.payment_status,
                )?;
                insert_reminders(conn, &keep_id, &input.reminders)?;
                Ok(Some(keep_id))
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
        })?;
        if let Some(id) = existing_id {
            return get_lesson(state, id);
        }
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let student_name = student_names(conn, &input.students)?;
            let color = resolve_lesson_color(conn, &input.students, &input.color);
            conn.execute(
                "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, materials_link, status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, color, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                params![
                    id,
                    student_name,
                    input.subject,
                    input.start_at,
                    input.duration_minutes,
                    input.cost,
                    input.currency,
                    input.link,
                    input.notes,
                    input.materials,
                    input.materials_link,
                    input.status,
                    input.payment_status,
                    input.recurrence_rule,
                    input.recurrence_parent_id,
                    input.recurrence_instance_date,
                    color,
                    now,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            save_lesson_students(
                conn,
                &id,
                &input.students,
                input.cost,
                input.currency.clone(),
                &input.payment_status,
            )?;
            insert_reminders(conn, &id, &input.reminders)?;
            if let Some(parent_id) = input.recurrence_parent_id.as_deref() {
                // Instance override of a series slot: diff against the parent template
                // (the slot's own start is its instance date).
                let parent: Option<(String, String)> = conn
                    .query_row(
                        "SELECT status, payment_status FROM lessons WHERE id = ?1",
                        params![parent_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .ok();
                let (ps, pp) = parent.unwrap_or_else(|| ("scheduled".into(), "unpaid".into()));
                let old_start = input.recurrence_instance_date.as_deref().unwrap_or(&input.start_at);
                let logged = log_lesson_diff(
                    conn, &id, &student_name,
                    (&ps, &pp, old_start),
                    (&input.status, &input.payment_status, &input.start_at),
                    input.recurrence_instance_date.as_deref(),
                );
                if !logged {
                    log_activity(conn, "lesson", "updated", Some(&id), Some(&student_name), None, None, None, input.recurrence_instance_date.as_deref());
                }
            } else {
                log_activity(
                    conn,
                    "lesson",
                    "created",
                    Some(&id),
                    Some(&student_name),
                    Some("start_at"),
                    None,
                    Some(&input.start_at),
                    input.recurrence_rule.as_deref(),
                );
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })?;
    get_lesson(state, id)
}
#[tauri::command]
pub fn update_lesson(
    state: tauri::State<AppState>,
    id: String,
    input: LessonInput,
) -> Result<Lesson, String> {
    if let Err(errors) = input.validate() {
        return Err(format!("Ошибка валидации: {}", errors));
    }
    if !input.force {
        let stored: Option<(String, i64)> = state.pool.with_conn(|conn| {
            conn.query_row(
                "SELECT start_at, duration_minutes FROM lessons WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())
        })?;
        if let Some((old_start, old_duration)) = stored {
            let changed = old_duration != input.duration_minutes
                || match (
                    old_start.parse::<DateTime<Utc>>(),
                    input.start_at.parse::<DateTime<Utc>>(),
                ) {
                    (Ok(a), Ok(b)) => a.timestamp() != b.timestamp(),
                    _ => old_start != input.start_at,
                };
            if changed {
                let start: DateTime<Utc> = input
                    .start_at
                    .parse::<DateTime<Utc>>()
                    .map_err(|e: chrono::ParseError| e.to_string())?;
                let overlaps = state.pool.with_conn(|conn| {
                    find_overlaps(conn, start, input.duration_minutes, Some(id.as_str()))
                })?;
                if let Some(err) = overlap_error(&overlaps) {
                    return Err(err);
                }
            }
        }
    }
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let student_name = student_names(conn, &input.students)?;
            let color = resolve_lesson_color(conn, &input.students, &input.color);
            let old: Option<(String, String, String)> = conn
                .query_row(
                    "SELECT status, payment_status, start_at FROM lessons WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            conn.execute(
                "UPDATE lessons SET student_name=?2, subject=?3, start_at=?4, duration_minutes=?5, cost=?6, currency=?7, link=?8, notes=?9, materials=?10, materials_link=?11, status=?12, payment_status=?13, recurrence_rule=?14, recurrence_parent_id=?15, recurrence_instance_date=?16, color=?17, updated_at=?18 WHERE id=?1",
                params![
                    id,
                    student_name,
                    input.subject,
                    input.start_at,
                    input.duration_minutes,
                    input.cost,
                    input.currency,
                    input.link,
                    input.notes,
                    input.materials,
                    input.materials_link,
                    input.status,
                    input.payment_status,
                    input.recurrence_rule,
                    input.recurrence_parent_id,
                    input.recurrence_instance_date,
                    color,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            save_lesson_students(
                conn,
                &id,
                &input.students,
                input.cost,
                input.currency.clone(),
                &input.payment_status,
            )?;
            conn.execute("DELETE FROM reminders WHERE lesson_id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            insert_reminders(conn, &id, &input.reminders)?;
            let logged = old.as_ref().is_some_and(|(s, p, st)| {
                log_lesson_diff(
                    conn, &id, &student_name,
                    (s, p, st),
                    (&input.status, &input.payment_status, &input.start_at),
                    input.recurrence_instance_date.as_deref(),
                )
            });
            if !logged {
                log_activity(conn, "lesson", "updated", Some(&id), Some(&student_name), None, None, None, input.recurrence_instance_date.as_deref());
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })?;
    get_lesson(state, id)
}
#[tauri::command]
pub fn delete_lesson(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let meta: Option<(String, String)> = conn
                .query_row(
                    "SELECT student_name, start_at FROM lessons WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            let ids = lesson_with_children(conn, &id);
            let archive_id = archive_rows(conn, "delete", &ids)?;
            conn.execute(
                "DELETE FROM lessons WHERE id = ?1 OR recurrence_parent_id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
            let (name, start) = meta.unzip();
            log_activity(
                conn, "lesson", "deleted", Some(&id), name.as_deref(),
                Some("start_at"), start.as_deref(), None,
                if archive_id.is_empty() { None } else { Some(&archive_id) },
            );
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })
}

#[tauri::command]
pub fn delete_lesson_series(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            // Resolve the series root: parent id for exceptions, own id otherwise.
            let root: String = conn
                .query_row(
                    "SELECT COALESCE(NULLIF(recurrence_parent_id, ''), id) FROM lessons WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            let meta: Option<(String, String, Option<String>)> = conn
                .query_row(
                    "SELECT student_name, start_at, recurrence_rule FROM lessons WHERE id = ?1",
                    params![root],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            let ids = lesson_with_children(conn, &root);
            let archive_id = archive_rows(conn, "series_delete", &ids)?;
            conn.execute(
                "DELETE FROM lessons WHERE id = ?1 OR recurrence_parent_id = ?1",
                params![root],
            )
            .map_err(|e| e.to_string())?;
            let (name, start, rule) = match meta {
                Some((n, s, r)) => (Some(n), Some(s), r),
                None => (None, None, None),
            };
            log_activity(
                conn, "lesson", "series_deleted", Some(&root), name.as_deref(),
                Some("start_at"), start.as_deref(), rule.as_deref(),
                if archive_id.is_empty() { None } else { Some(&archive_id) },
            );
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })
}
const LESSON_COLS: &str = "id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, color, created_at, updated_at, materials, materials_link";

/// Logs field-level diffs (status / payment / start) between `old` and `new`.
/// Returns true if anything was logged.
#[tauri::command]
pub fn update_lesson_status(
    state: tauri::State<AppState>,
    id: String,
    status: String,
    payment_status: Option<String>,
) -> Result<Lesson, String> {
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let old: Option<(String, String, String)> = conn
                .query_row(
                    "SELECT student_name, status, payment_status FROM lessons WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            if let Some(ps) = payment_status.clone() {
                conn.execute(
                    "UPDATE lessons SET status = ?2, payment_status = ?3, updated_at = ?4 WHERE id = ?1",
                    params![id, status, ps, now],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE lesson_students SET payment_status = ?2 WHERE lesson_id = ?1",
                    params![id, ps],
                )
                .map_err(|e| e.to_string())?;
                log_activity(
                    conn,
                    "lesson",
                    "payment_changed",
                    Some(&id),
                    old.as_ref().map(|o| o.0.as_str()),
                    Some("payment_status"),
                    old.as_ref().map(|o| o.2.as_str()),
                    Some(&ps),
                    None,
                );
            } else {
                conn.execute(
                    "UPDATE lessons SET status = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, status, now],
                )
                .map_err(|e| e.to_string())?;
            }
            log_activity(
                conn,
                "lesson",
                "status_changed",
                Some(&id),
                old.as_ref().map(|o| o.0.as_str()),
                Some("status"),
                old.as_ref().map(|o| o.1.as_str()),
                Some(&status),
                None,
            );
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    })?;
    get_lesson(state, id)
}
pub(crate) fn setting_timezone(conn: &rusqlite::Connection) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'timezone'",
        [],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "Europe/Moscow".to_string())
}

fn today_bounds_in_tz(tz_name: &str) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    use chrono::TimeZone;
    use chrono_tz::Tz;

    let tz: Tz = tz_name.parse().unwrap_or(chrono_tz::Europe::Moscow);
    let now_local = Utc::now().with_timezone(&tz);
    let date = now_local.date_naive();
    let from_local = tz
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        .single()
        .ok_or_else(|| "Некорректное начало дня".to_string())?;
    let to_local = tz
        .from_local_datetime(&date.and_hms_opt(23, 59, 59).unwrap())
        .single()
        .ok_or_else(|| "Некорректный конец дня".to_string())?;
    Ok((from_local.with_timezone(&Utc), to_local.with_timezone(&Utc)))
}

#[tauri::command]
pub fn get_today_lessons(state: tauri::State<AppState>) -> Result<Vec<Lesson>, String> {
    let (from, to) = state.pool.with_conn(|conn| {
        let tz = setting_timezone(conn);
        today_bounds_in_tz(&tz)
    })?;
    get_lessons(state, from.to_rfc3339(), to.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn
    }

    fn insert_lesson(
        conn: &Connection,
        id: &str,
        student_name: &str,
        start_at_rfc3339: &str,
        duration_minutes: i64,
        status: &str,
    ) {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, status, payment_status, created_at, updated_at)
             VALUES (?1, ?2, 'Math', ?3, ?4, ?5, 'unpaid', ?6, ?6)",
            params![id, student_name, start_at_rfc3339, duration_minutes, status, now],
        )
        .unwrap();
    }

    fn insert_lesson_ex(
        conn: &Connection,
        id: &str,
        student_name: &str,
        start_at: &str,
        status: &str,
        rule: Option<&str>,
        parent: Option<&str>,
        instance_date: Option<&str>,
    ) {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, status, payment_status,
                                  recurrence_rule, recurrence_parent_id, recurrence_instance_date, created_at, updated_at)
             VALUES (?1, ?2, 'Math', ?3, 60, ?4, 'unpaid', ?5, ?6, ?7, ?8, ?8)",
            params![id, student_name, start_at, status, rule, parent, instance_date, now],
        )
        .unwrap();
    }

    fn insert_student(conn: &Connection, id: &str, name: &str) {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO students (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, name, now],
        )
        .unwrap();
    }

    fn expanded_ids(conn: &Connection, from: &str, to: &str) -> Vec<String> {
        expanded_lessons_in_range(
            conn,
            from.parse().unwrap(),
            to.parse().unwrap(),
        )
        .unwrap()
        .into_iter()
        .map(|l| l.id)
        .collect()
    }

    #[test]
    fn expanded_weekly_generates_frontend_ids() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        conn.execute(
            "INSERT INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
             VALUES ('p1', 's1', 100.0, 'USD', 'unpaid')",
            [],
        )
        .unwrap();

        let out = expanded_lessons_in_range(
            &conn,
            "2026-03-09T00:00:00Z".parse().unwrap(),
            "2026-03-22T23:59:59Z".parse().unwrap(),
        )
        .unwrap();
        let ids: Vec<&str> = out.iter().map(|l| l.id.as_str()).collect();
        // The Mar 23 slot falls outside the instant range (local date boundary).
        assert_eq!(
            ids,
            ["p1::2026-03-09T10:00:00.000Z", "p1::2026-03-16T10:00:00.000Z"]
        );
        let inst = &out[0];
        assert_eq!(inst.start_at, "2026-03-09T10:00:00.000Z");
        assert_eq!(
            inst.recurrence_instance_date.as_deref(),
            Some("2026-03-09T10:00:00.000Z")
        );
        // Generated instances keep the parent's rule and null parent — like `{...parent}`.
        assert_eq!(inst.recurrence_rule.as_deref(), Some("FREQ=WEEKLY"));
        assert_eq!(inst.recurrence_parent_id, None);
        assert_eq!(inst.students.len(), 1);
        assert_eq!(inst.students[0].student_id, "s1");
    }

    #[test]
    fn expanded_respects_count_and_exclusive_until() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "pc",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY;COUNT=2"),
            None,
            None,
        );
        insert_lesson_ex(
            &conn,
            "pu",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY;UNTIL=2026-03-16T10:00:00.000Z"),
            None,
            None,
        );
        let ids = expanded_ids(&conn, "2026-03-01T00:00:00Z", "2026-04-30T23:59:59Z");
        assert_eq!(
            ids,
            [
                "pc::2026-03-09T10:00:00.000Z",
                "pu::2026-03-09T10:00:00.000Z",
                "pc::2026-03-16T10:00:00.000Z",
            ]
        );
    }

    #[test]
    fn expanded_byday_emits_each_weekday() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "pb",
            "Ivan",
            "2026-03-09T10:00:00Z", // Monday
            "scheduled",
            Some("FREQ=WEEKLY;BYDAY=MO,WE"),
            None,
            None,
        );
        let ids = expanded_ids(&conn, "2026-03-09T00:00:00Z", "2026-03-15T23:59:59Z");
        assert_eq!(
            ids,
            ["pb::2026-03-09T10:00:00.000Z", "pb::2026-03-11T10:00:00.000Z"]
        );
    }

    #[test]
    fn expanded_applies_moved_exception_and_suppresses_slot() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        // Slot Mar 16 moved to Mar 17.
        insert_lesson_ex(
            &conn,
            "e1",
            "Ivan",
            "2026-03-17T10:00:00Z",
            "scheduled",
            None,
            Some("p1"),
            Some("2026-03-16T10:00:00.000Z"),
        );
        let ids = expanded_ids(&conn, "2026-03-09T00:00:00Z", "2026-03-22T23:59:59Z");
        assert_eq!(ids, ["p1::2026-03-09T10:00:00.000Z", "e1"]);
    }

    #[test]
    fn expanded_skips_cancelled_exception_slot() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        insert_lesson_ex(
            &conn,
            "e1",
            "Ivan",
            "2026-03-16T10:00:00Z",
            "cancelled",
            None,
            Some("p1"),
            Some("2026-03-16T10:00:00.000Z"),
        );
        let ids = expanded_ids(&conn, "2026-03-09T00:00:00Z", "2026-03-22T23:59:59Z");
        assert_eq!(ids, ["p1::2026-03-09T10:00:00.000Z"]);
    }

    #[test]
    fn expanded_picks_best_exception_for_slot() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        // Two rows claim the Mar 16 slot; completed outranks cancelled.
        insert_lesson_ex(
            &conn,
            "e_cancel",
            "Ivan",
            "2026-03-16T10:00:00Z",
            "cancelled",
            None,
            Some("p1"),
            Some("2026-03-16T10:00:00.000Z"),
        );
        insert_lesson_ex(
            &conn,
            "e_done",
            "Ivan",
            "2026-03-16T10:00:00Z",
            "completed",
            None,
            Some("p1"),
            Some("2026-03-16T10:00:00.000Z"),
        );
        let ids = expanded_ids(&conn, "2026-03-09T00:00:00Z", "2026-03-22T23:59:59Z");
        // dedupe_all_exception_slots keeps the best row only.
        assert_eq!(ids, ["p1::2026-03-09T10:00:00.000Z", "e_done"]);
    }

    #[test]
    fn expanded_emits_leftover_exception_inside_range() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        // Exception anchored to a slot beyond the window but moved inside it.
        insert_lesson_ex(
            &conn,
            "e1",
            "Ivan",
            "2026-03-20T10:00:00Z",
            "scheduled",
            None,
            Some("p1"),
            Some("2026-04-06T10:00:00.000Z"),
        );
        let ids = expanded_ids(&conn, "2026-03-09T00:00:00Z", "2026-03-22T23:59:59Z");
        assert_eq!(ids, ["p1::2026-03-09T10:00:00.000Z", "p1::2026-03-16T10:00:00.000Z", "e1"]);
    }

    #[test]
    fn expanded_keeps_singles_and_excludes_parents() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "single",
            "Maria",
            "2026-03-10T09:00:00Z",
            "scheduled",
            None,
            None,
            None,
        );
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        let out = expanded_lessons_in_range(
            &conn,
            "2026-03-09T00:00:00Z".parse().unwrap(),
            "2026-03-16T23:59:59Z".parse().unwrap(),
        )
        .unwrap();
        let ids: Vec<&str> = out.iter().map(|l| l.id.as_str()).collect();
        // The recurring parent row itself must never appear.
        assert!(!ids.contains(&"p1"));
        assert_eq!(
            ids,
            [
                "p1::2026-03-09T10:00:00.000Z",
                "single",
                "p1::2026-03-16T10:00:00.000Z"
            ]
        );
        // Sorted by start instant: Mar 9 10:00 < Mar 10 09:00 < Mar 16 10:00.
        assert_eq!(out[1].start_at, "2026-03-10T09:00:00Z");
    }

    #[test]
    fn find_overlaps_detects_regular_conflict() {
        let conn = test_conn();
        insert_lesson(&conn, "l1", "Ivan", "2026-03-10T10:00:00Z", 60, "scheduled");
        insert_lesson(&conn, "l2", "Maria", "2026-03-10T10:30:00Z", 60, "scheduled");
        let overlaps = find_overlaps(
            &conn,
            "2026-03-10T10:30:00Z".parse().unwrap(),
            60,
            Some("l2"),
        )
        .unwrap();
        assert_eq!(overlaps.len(), 1);
        assert_eq!(overlaps[0].id, "l1");
    }

    #[test]
    fn find_overlaps_excludes_self_and_cancelled() {
        let conn = test_conn();
        insert_lesson(&conn, "l1", "Ivan", "2026-03-10T10:00:00Z", 60, "scheduled");
        insert_lesson(&conn, "l2", "Maria", "2026-03-10T10:00:00Z", 60, "cancelled");
        let overlaps = find_overlaps(
            &conn,
            "2026-03-10T10:00:00Z".parse().unwrap(),
            60,
            Some("l1"),
        )
        .unwrap();
        assert!(overlaps.is_empty());
    }

    #[test]
    fn find_overlaps_detects_series_instance() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        let overlaps = find_overlaps(
            &conn,
            "2026-03-16T10:15:00Z".parse().unwrap(),
            60,
            None,
        )
        .unwrap();
        assert_eq!(overlaps.len(), 1);
        assert_eq!(overlaps[0].id, "p1::2026-03-16T10:00:00.000Z");
    }

    #[test]
    fn find_overlaps_excludes_instance_and_slot() {
        let conn = test_conn();
        insert_lesson_ex(
            &conn,
            "p1",
            "Ivan",
            "2026-03-09T10:00:00Z",
            "scheduled",
            Some("FREQ=WEEKLY"),
            None,
            None,
        );
        // Excluding the Mar 16 slot via `parent::ISO` removes only that instance.
        let overlaps = find_overlaps(
            &conn,
            "2026-03-16T10:15:00Z".parse().unwrap(),
            60,
            Some("p1::2026-03-16T10:00:00.000Z"),
        )
        .unwrap();
        assert!(overlaps.is_empty());
        // Another slot of the same series still overlaps.
        let overlaps = find_overlaps(
            &conn,
            "2026-03-23T10:15:00Z".parse().unwrap(),
            60,
            Some("p1::2026-03-16T10:00:00.000Z"),
        )
        .unwrap();
        assert_eq!(overlaps.len(), 1);
        // A cancelled exception suppresses its slot — no overlap there.
        insert_lesson_ex(
            &conn,
            "e1",
            "Ivan",
            "2026-03-23T10:00:00Z",
            "cancelled",
            None,
            Some("p1"),
            Some("2026-03-23T10:00:00.000Z"),
        );
        let overlaps = find_overlaps(
            &conn,
            "2026-03-23T10:15:00Z".parse().unwrap(),
            60,
            None,
        )
        .unwrap();
        assert!(overlaps.is_empty());
    }

    /// Parity dump for `src/lib/parity.test.ts`: expands a real DB copy for the
    /// ranges in PARITY_IN and writes `{name, lessons:[{id,start}]}` to PARITY_OUT.
    /// `PARITY_DB=<copy> PARITY_IN=<json> PARITY_OUT=<json> cargo test -- --ignored`
    #[test]
    #[ignore]
    fn expanded_dump_real_db() {
        let db = std::env::var("PARITY_DB").expect("PARITY_DB");
        let input_path = std::env::var("PARITY_IN").expect("PARITY_IN");
        let out_path = std::env::var("PARITY_OUT").expect("PARITY_OUT");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::migrations::run(&conn).unwrap();

        let input: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&input_path).unwrap()).unwrap();
        let mut dump = Vec::new();
        for range in input["ranges"].as_array().unwrap() {
            let from: DateTime<Utc> = range["from"].as_str().unwrap().parse().unwrap();
            let to: DateTime<Utc> = range["to"].as_str().unwrap().parse().unwrap();
            let lessons = expanded_lessons_in_range(&conn, from, to).unwrap();
            let items: Vec<serde_json::Value> = lessons
                .iter()
                .map(|l| serde_json::json!({"id": l.id, "start": l.start_at}))
                .collect();
            dump.push(serde_json::json!({
                "name": range["name"],
                "from": range["from"],
                "to": range["to"],
                "lessons": items,
            }));
        }
        std::fs::write(&out_path, serde_json::to_string_pretty(&dump).unwrap()).unwrap();
    }
}
