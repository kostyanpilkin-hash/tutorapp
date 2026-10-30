use crate::db::AppState;
use crate::models::{Lesson, LessonInput, LessonStudent, LessonStudentInput, OverlapInfo, Reminder};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;
use validator::Validate;
const LESSON_SELECT: &str = "SELECT id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, materials_link, status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, color, created_at, updated_at";
fn load_reminders_conn(conn: &Connection, lesson_id: &str) -> Result<Vec<Reminder>, String> {
    let mut stmt = conn
        .prepare("SELECT id, lesson_id, minutes_before FROM reminders WHERE lesson_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([lesson_id], |row| {
            Ok(Reminder {
                id: row.get(0)?,
                lesson_id: row.get(1)?,
                minutes_before: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
fn load_lesson_students(conn: &Connection, lesson_id: &str) -> Result<Vec<LessonStudent>, String> {
    let mut stmt = conn
        .prepare("SELECT s.id, s.name, ls.cost, ls.currency, ls.payment_status, s.color, s.timezone, s.notes FROM lesson_students ls JOIN students s ON s.id = ls.student_id WHERE ls.lesson_id = ?1 ORDER BY s.name ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![lesson_id], |row| {
            Ok(LessonStudent {
                student_id: row.get(0)?,
                name: row.get(1)?,
                cost: row.get(2)?,
                currency: row.get(3)?,
                payment_status: row.get(4)?,
                color: row.get(5)?,
                timezone: row.get(6)?,
                lesson_note: row.get(7).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
fn row_to_lesson(conn: &Connection, row: &Row) -> Result<Lesson, rusqlite::Error> {
    let id: String = row.get(0)?;
    let reminders = load_reminders_conn(conn, &id).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
    })?;
    let students = load_lesson_students(conn, &id).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
    })?;
    Ok(Lesson {
        id,
        student_name: row.get(1)?,
        subject: row.get(2)?,
        start_at: row.get(3)?,
        duration_minutes: row.get(4)?,
        cost: row.get(5)?,
        currency: row.get(6)?,
        link: row.get(7)?,
        notes: row.get(8)?,
        materials: row.get(9)?,
        materials_link: row.get(10)?,
        status: row.get(11)?,
        payment_status: row.get(12)?,
        recurrence_rule: row.get(13)?,
        recurrence_parent_id: row.get(14)?,
        recurrence_instance_date: row.get(15)?,
        color: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        reminders,
        students,
    })
}
fn insert_reminders(conn: &Connection, lesson_id: &str, minutes: &[i64]) -> Result<(), String> {
    conn.execute(
        "DELETE FROM reminders WHERE lesson_id = ?1",
        params![lesson_id],
    )
    .map_err(|e| e.to_string())?;
    for m in minutes {
        conn.execute(
            "INSERT INTO reminders (id, lesson_id, minutes_before) VALUES (?1, ?2, ?3)",
            params![Uuid::new_v4().to_string(), lesson_id, m],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn same_instant_str(a: &str, b: &str) -> bool {
    match (a.parse::<DateTime<Utc>>(), b.parse::<DateTime<Utc>>()) {
        (Ok(da), Ok(db)) => da.timestamp() == db.timestamp(),
        _ => a == b,
    }
}

fn delete_lesson_cascade(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM reminders WHERE lesson_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lesson_students WHERE lesson_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lessons WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Keep a single exception per (parent, instance slot); prefer finalized status, then newest.
fn dedupe_exceptions_for_instance(
    conn: &Connection,
    parent_id: &str,
    instance_date: &str,
) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, recurrence_instance_date, status, updated_at FROM lessons
             WHERE recurrence_parent_id = ?1
               AND recurrence_instance_date IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut matches: Vec<(String, String, String)> = Vec::new();
    for row in rows {
        let (id, inst, status, updated_at) = row.map_err(|e| e.to_string())?;
        if same_instant_str(&inst, instance_date) {
            matches.push((id, status, updated_at));
        }
    }
    if matches.is_empty() {
        return Ok(None);
    }
    matches.sort_by(|a, b| {
        exception_status_rank(&b.1)
            .cmp(&exception_status_rank(&a.1))
            .then_with(|| b.2.cmp(&a.2))
    });
    let keep = matches[0].0.clone();
    for (id, _, _) in matches.into_iter().skip(1) {
        delete_lesson_cascade(conn, &id)?;
    }
    Ok(Some(keep))
}

fn exception_status_rank(status: &str) -> i32 {
    match status {
        "completed" => 4,
        "no_show" => 3,
        "cancelled" => 2,
        _ => 1,
    }
}

/// Remove duplicate exception rows across the whole DB (same parent + instance slot).
#[allow(clippy::type_complexity)]
pub(crate) fn dedupe_all_exception_slots(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, recurrence_parent_id, recurrence_instance_date, status, updated_at FROM lessons
             WHERE recurrence_parent_id IS NOT NULL AND recurrence_parent_id != ''
               AND recurrence_instance_date IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut groups: std::collections::HashMap<(String, i64), Vec<(String, String, String)>> =
        std::collections::HashMap::new();
    for row in rows {
        let (id, parent_id, instance_date, status, updated_at) = row.map_err(|e| e.to_string())?;
        let ts = instance_date
            .parse::<DateTime<Utc>>()
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        groups
            .entry((parent_id, ts))
            .or_default()
            .push((id, status, updated_at));
    }

    for mut items in groups.into_values() {
        if items.len() < 2 {
            continue;
        }
        items.sort_by(|a, b| {
            exception_status_rank(&b.1)
                .cmp(&exception_status_rank(&a.1))
                .then_with(|| b.2.cmp(&a.2))
        });
        for (id, _, _) in items.into_iter().skip(1) {
            delete_lesson_cascade(conn, &id)?;
        }
    }
    Ok(())
}
fn student_names(conn: &Connection, students: &[LessonStudentInput]) -> Result<String, String> {
    let mut names = Vec::new();
    for s in students {
        let name: String = conn
            .query_row(
                "SELECT name FROM students WHERE id = ?1",
                params![s.student_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        names.push(name);
    }
    Ok(names.join(", "))
}
fn resolve_lesson_color(
    conn: &Connection,
    students: &[LessonStudentInput],
    explicit: &Option<String>,
) -> Option<String> {
    if let Some(c) = explicit {
        if !c.is_empty() {
            return Some(c.clone());
        }
    }
    if let Some(first) = students.first() {
        if let Ok(color) = conn.query_row(
            "SELECT color FROM students WHERE id = ?1",
            params![first.student_id],
            |r| r.get::<_, Option<String>>(0),
        ) {
            return color;
        }
    }
    None
}
fn save_lesson_students(
    conn: &Connection,
    lesson_id: &str,
    students: &[LessonStudentInput],
    default_cost: Option<f64>,
    default_currency: Option<String>,
    default_payment: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM lesson_students WHERE lesson_id = ?1",
        params![lesson_id],
    )
    .map_err(|e| e.to_string())?;
    for s in students {
        let cost = s.cost.or(default_cost);
        let currency = s.currency.clone().or(default_currency.clone());
        let payment = s
            .payment_status
            .clone()
            .unwrap_or_else(|| default_payment.to_string());
        conn.execute(
            "INSERT INTO lesson_students (lesson_id, student_id, cost, currency, payment_status) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![lesson_id, s.student_id, cost, currency, payment],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
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
    state.pool.with_conn(|conn| {
        let mut stmt = conn
            .prepare(&format!("{LESSON_SELECT} FROM lessons WHERE id = ?1"))
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], |row| row_to_lesson(conn, row))
            .map_err(|e| e.to_string())
    })
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
fn log_lesson_diff(
    conn: &Connection,
    id: &str,
    name: &str,
    old: (&str, &str, &str),
    new: (&str, &str, &str),
    instance_date: Option<&str>,
) -> bool {
    let mut logged = false;
    if old.0 != new.0 {
        log_activity(conn, "lesson", "status_changed", Some(id), Some(name), Some("status"), Some(old.0), Some(new.0), instance_date);
        logged = true;
    }
    if old.1 != new.1 {
        log_activity(conn, "lesson", "payment_changed", Some(id), Some(name), Some("payment_status"), Some(old.1), Some(new.1), instance_date);
        logged = true;
    }
    let same_start = match (old.2.parse::<DateTime<Utc>>(), new.2.parse::<DateTime<Utc>>()) {
        (Ok(a), Ok(b)) => a.timestamp() == b.timestamp(),
        _ => old.2 == new.2,
    };
    if !same_start {
        log_activity(conn, "lesson", "rescheduled", Some(id), Some(name), Some("start_at"), Some(old.2), Some(new.2), instance_date);
        logged = true;
    }
    logged
}

/// Collects a lesson id plus all its exception rows (for archiving before delete).
fn lesson_with_children(conn: &Connection, id: &str) -> Vec<String> {
    let mut ids = vec![id.to_string()];
    if let Ok(mut st) = conn.prepare("SELECT id FROM lessons WHERE recurrence_parent_id = ?1") {
        if let Ok(rows) = st.query_map(params![id], |r| r.get::<_, String>(0)) {
            ids.extend(rows.filter_map(|r| r.ok()));
        }
    }
    ids
}

pub(crate) fn log_activity(
    conn: &Connection,
    category: &str,
    action: &str,
    entity_id: Option<&str>,
    entity_name: Option<&str>,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    details: Option<&str>,
) {
    let _ = conn.execute(
        "INSERT INTO activity_log (id, category, action, entity_id, entity_name, field, old_value, new_value, details, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            category,
            action,
            entity_id,
            entity_name,
            field,
            old_value,
            new_value,
            details,
            Utc::now().to_rfc3339()
        ],
    );
}

fn archive_rows(
    conn: &Connection,
    action: &str,
    lesson_ids: &[String],
) -> Result<String, String> {
    if lesson_ids.is_empty() {
        return Ok(String::new());
    }
    let archive_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO lesson_archive (id, action, created_at) VALUES (?1, ?2, ?3)",
        params![archive_id, action, Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    for id in lesson_ids {
        conn.execute(
            &format!(
                "INSERT INTO archived_lessons (archive_id, {LESSON_COLS}) SELECT ?1, {LESSON_COLS} FROM lessons WHERE id = ?2"
            ),
            params![archive_id, id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO archived_lesson_students (archive_id, lesson_id, student_id, cost, currency, payment_status)
             SELECT ?1, lesson_id, student_id, cost, currency, payment_status FROM lesson_students WHERE lesson_id = ?2",
            params![archive_id, id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO archived_reminders (archive_id, id, lesson_id, minutes_before)
             SELECT ?1, id, lesson_id, minutes_before FROM reminders WHERE lesson_id = ?2",
            params![archive_id, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(archive_id)
}

/// Deletes "this and following": truncates the series before the instance
/// and removes future exceptions. Past history is preserved.
/// Returns archive id for undo.
#[tauri::command]
pub fn delete_lesson_series_from_instance(
    state: tauri::State<AppState>,
    id: String,
    instance_date: String,
) -> Result<String, String> {
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<String, String> {
            // Resolve parent id
            let parent_id: String = conn
                .query_row(
                    "SELECT COALESCE(NULLIF(recurrence_parent_id, ''), id) FROM lessons WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;

            let rule: Option<String> = conn
                .query_row(
                    "SELECT recurrence_rule FROM lessons WHERE id = ?1",
                    params![parent_id],
                    |r| r.get(0),
                )
                .ok()
                .flatten();

            // Collect exception rows at/after instance_date
            let mut estmt = conn
                .prepare("SELECT id FROM lessons WHERE recurrence_parent_id = ?1 AND recurrence_instance_date >= ?2")
                .map_err(|e| e.to_string())?;
            let exception_ids: Vec<String> = estmt
                .query_map(params![parent_id, instance_date], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            // Archive everything we touch: parent (rule change) + exceptions
            let mut ids = vec![parent_id.clone()];
            ids.extend(exception_ids.clone());
            let archive_id = archive_rows(conn, "series_delete_from_instance", &ids)?;
            let pname: Option<String> = conn
                .query_row(
                    "SELECT student_name FROM lessons WHERE id = ?1",
                    params![parent_id],
                    |r| r.get(0),
                )
                .ok();
            log_activity(
                conn,
                "lesson",
                "series_deleted_from",
                Some(&parent_id),
                pname.as_deref(),
                Some("start_at"),
                None,
                Some(&instance_date),
                Some(&archive_id),
            );

            // Truncate series: strip COUNT/UNTIL, set UNTIL = day before instance
            if let Some(rule) = rule {
                if !rule.is_empty() {
                    let base: Vec<&str> = rule
                        .split(';')
                        .filter(|p| {
                            let u = p.to_uppercase();
                            !u.starts_with("UNTIL=") && !u.starts_with("COUNT=")
                        })
                        .collect();
                    let until = chrono::DateTime::parse_from_rfc3339(&instance_date)
                        .map(|d| (d - chrono::Duration::days(1)).to_rfc3339())
                        .map_err(|e| e.to_string())?;
                    let new_rule = format!("{};UNTIL={}", base.join(";"), until);
                    conn.execute(
                        "UPDATE lessons SET recurrence_rule = ?2, updated_at = ?3 WHERE id = ?1",
                        params![parent_id, new_rule, Utc::now().to_rfc3339()],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }

            // Delete future exceptions
            for eid in &exception_ids {
                conn.execute("DELETE FROM lessons WHERE id = ?1", params![eid])
                    .map_err(|e| e.to_string())?;
            }
            Ok(archive_id)
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
    })
}

#[tauri::command]
pub fn restore_lesson_archive(
    state: tauri::State<AppState>,
    archive_id: String,
) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let restored: Option<(String, String)> = conn
                .query_row(
                    "SELECT id, student_name FROM archived_lessons WHERE archive_id = ?1 ORDER BY (recurrence_parent_id IS NULL OR recurrence_parent_id = '') DESC LIMIT 1",
                    params![archive_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            conn.execute(
                &format!("INSERT OR REPLACE INTO lessons ({LESSON_COLS}) SELECT {LESSON_COLS} FROM archived_lessons WHERE archive_id = ?1"),
                params![archive_id],
            )
            .map_err(|e| e.to_string())?;
            if let Some((lid, lname)) = &restored {
                log_activity(conn, "lesson", "restored", Some(lid), Some(lname), None, None, None, None);
            }
            conn.execute(
                "INSERT OR IGNORE INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
                 SELECT lesson_id, student_id, cost, currency, payment_status FROM archived_lesson_students WHERE archive_id = ?1",
                params![archive_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR IGNORE INTO reminders (id, lesson_id, minutes_before)
                 SELECT id, lesson_id, minutes_before FROM archived_reminders WHERE archive_id = ?1",
                params![archive_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM archived_lessons WHERE archive_id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM archived_lesson_students WHERE archive_id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM archived_reminders WHERE archive_id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM lesson_archive WHERE id = ?1", params![archive_id])
                .map_err(|e| e.to_string())?;
            Ok(())
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
    })
}

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
#[tauri::command]
pub fn check_overlaps(
    state: tauri::State<AppState>,
    start_at: String,
    duration_minutes: i64,
    exclude_id: Option<String>,
) -> Result<Vec<OverlapInfo>, String> {
    let start: DateTime<Utc> = start_at
        .parse::<DateTime<Utc>>()
        .map_err(|e: chrono::ParseError| e.to_string())?;
    state.pool.with_conn(|conn| {
        find_overlaps(conn, start, duration_minutes, exclude_id.as_deref())
    })
}

fn overlap_error(overlaps: &[OverlapInfo]) -> Option<String> {
    if overlaps.is_empty() {
        return None;
    }
    let mut names: Vec<String> = Vec::new();
    for o in overlaps {
        if !names.contains(&o.student_name) {
            names.push(o.student_name.clone());
        }
    }
    Some(format!("OVERLAP:{}", names.join(", ")))
}

pub(crate) fn find_overlaps(
    conn: &Connection,
    start: DateTime<Utc>,
    duration_minutes: i64,
    exclude_id: Option<&str>,
) -> Result<Vec<OverlapInfo>, String> {
    use crate::recurrence::{expand_weekly_starts, intervals_overlap, is_weekly};

    let end = start + Duration::minutes(duration_minutes);
    let range_from = start - Duration::days(1);
    let range_to = end + Duration::days(8);

    {
        // Include cancelled *exceptions* so deleted series slots stay in the skip list.
        // (Deleting a recurring instance creates status=cancelled with recurrence_parent_id.)
        let mut stmt = conn
            .prepare(
                "SELECT id, student_name, start_at, duration_minutes, recurrence_rule, recurrence_parent_id, recurrence_instance_date, status
                 FROM lessons
                 WHERE status != 'cancelled'
                    OR (recurrence_parent_id IS NOT NULL AND recurrence_parent_id != '')",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut overlaps = Vec::new();
        let mut exceptions: std::collections::HashMap<String, Vec<DateTime<Utc>>> =
            std::collections::HashMap::new();
        let mut parents = Vec::new();
        let mut regular = Vec::new();

        let (exclude_series_id, exclude_instance_at) = exclude_id
            .and_then(|ex| ex.split_once("::"))
            .map(|(pid, inst)| (Some(pid.to_string()), inst.parse::<DateTime<Utc>>().ok()))
            .unwrap_or((None, None));

        for row in rows {
            let (id, student_name, other_start, other_dur, recurrence_rule, parent_id, instance_date, status) =
                row.map_err(|e| e.to_string())?;

            let excluded = Some(id.as_str()) == exclude_id;
            let is_cancelled = status == "cancelled";

            let other_start: DateTime<Utc> = other_start
                .parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())?;

            if let Some(pid) = parent_id {
                if let Some(ref inst) = instance_date {
                    if let Ok(dt) = inst.parse::<DateTime<Utc>>() {
                        exceptions.entry(pid).or_default().push(dt);
                    }
                }
                // Cancelled exceptions only suppress the series slot; they are not an overlap.
                if excluded || is_cancelled {
                    continue;
                }
                let other_end = other_start + Duration::minutes(other_dur);
                if intervals_overlap(start, end, other_start, other_end) {
                    overlaps.push(OverlapInfo {
                        id,
                        student_name,
                        start_at: other_start.to_rfc3339(),
                        duration_minutes: other_dur,
                    });
                }
                continue;
            }

            if excluded || is_cancelled {
                continue;
            }

            if is_weekly(&recurrence_rule) {
                parents.push((id, student_name, other_start, other_dur, recurrence_rule));
            } else {
                regular.push((id, student_name, other_start, other_dur));
            }
        }

        for (id, student_name, other_start, other_dur) in regular {
            let other_end = other_start + Duration::minutes(other_dur);
            if intervals_overlap(start, end, other_start, other_end) {
                overlaps.push(OverlapInfo {
                    id,
                    student_name,
                    start_at: other_start.to_rfc3339(),
                    duration_minutes: other_dur,
                });
            }
        }

        for (id, student_name, anchor, other_dur, rule) in parents {
            let starts = expand_weekly_starts(anchor, &rule, range_from, range_to);
            let skipped = exceptions.get(&id).cloned().unwrap_or_default();
            for instance_start in starts {
                if skipped.contains(&instance_start) {
                    continue;
                }
                if exclude_series_id.as_ref() == Some(&id)
                    && exclude_instance_at == Some(instance_start)
                {
                    continue;
                }
                let instance_end = instance_start + Duration::minutes(other_dur);
                if intervals_overlap(start, end, instance_start, instance_end) {
                    overlaps.push(OverlapInfo {
                        id: format!("{id}::{}", instance_start.to_rfc3339()),
                        student_name: student_name.clone(),
                        start_at: instance_start.to_rfc3339(),
                        duration_minutes: other_dur,
                    });
                }
            }
        }

        Ok(overlaps)
    }
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
}
