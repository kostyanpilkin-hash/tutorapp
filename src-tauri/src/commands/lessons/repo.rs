use crate::models::{Lesson, LessonStudent, LessonStudentInput, Reminder};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use super::LESSON_SELECT;

pub(crate) fn load_reminders_conn(conn: &Connection, lesson_id: &str) -> Result<Vec<Reminder>, String> {
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
pub(crate) fn load_lesson_students(conn: &Connection, lesson_id: &str) -> Result<Vec<LessonStudent>, String> {
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
pub(crate) fn row_to_lesson(conn: &Connection, row: &Row) -> Result<Lesson, rusqlite::Error> {
    let id: String = row.get(0)?;
    let reminders = load_reminders_conn(conn, &id).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
    })?;
    let students = load_lesson_students(conn, &id).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e)))
    })?;
    let stored_name: String = row.get(1)?;
    Ok(Lesson {
        id,
        student_name: if students.is_empty() {
            stored_name
        } else {
            join_student_names(students.iter().map(|s| s.name.as_str()))
        },
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
pub(crate) fn insert_reminders(conn: &Connection, lesson_id: &str, minutes: &[i64]) -> Result<(), String> {
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

pub(crate) fn same_instant_str(a: &str, b: &str) -> bool {
    match (a.parse::<DateTime<Utc>>(), b.parse::<DateTime<Utc>>()) {
        (Ok(da), Ok(db)) => da.timestamp() == db.timestamp(),
        _ => a == b,
    }
}

pub(crate) fn delete_lesson_cascade(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM reminders WHERE lesson_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lesson_students WHERE lesson_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lessons WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn join_student_names<'a>(names: impl Iterator<Item = &'a str>) -> String {
    names.collect::<Vec<_>>().join(", ")
}

/// Display name for one lesson: names of linked students via
/// `lesson_students → students` (same order as `load_lesson_students`),
/// or `stored` (`lessons.student_name`) when the lesson is orphaned.
pub(crate) fn lesson_display_name(
    conn: &Connection,
    lesson_id: &str,
    stored: &str,
) -> Result<String, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.name FROM lesson_students ls
             JOIN students s ON s.id = ls.student_id
             WHERE ls.lesson_id = ?1 ORDER BY s.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map(params![lesson_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if names.is_empty() {
        Ok(stored.to_string())
    } else {
        Ok(join_student_names(names.iter().map(|n| n.as_str())))
    }
}

/// `lesson_id → joined student names` for every lesson with linked students.
/// Callers fall back to `lessons.student_name` for ids absent from the map.
pub(crate) fn lesson_display_names(
    conn: &Connection,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT ls.lesson_id, s.name FROM lesson_students ls
             JOIN students s ON s.id = ls.student_id
             ORDER BY ls.lesson_id, s.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut grouped: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for row in rows {
        let (lesson_id, name) = row.map_err(|e| e.to_string())?;
        grouped.entry(lesson_id).or_default().push(name);
    }
    Ok(grouped
        .into_iter()
        .map(|(k, v)| (k, join_student_names(v.iter().map(|n| n.as_str()))))
        .collect())
}

/// Keep a single exception per (parent, instance slot); prefer finalized status, then newest.

pub(crate) fn student_names(conn: &Connection, students: &[LessonStudentInput]) -> Result<String, String> {
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
pub(crate) fn resolve_lesson_color(
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
pub(crate) fn save_lesson_students(
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

pub(crate) fn load_lesson_by_id(conn: &Connection, id: &str) -> Result<Lesson, String> {
    let mut stmt = conn
        .prepare(&format!("{LESSON_SELECT} FROM lessons WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| row_to_lesson(conn, row))
        .map_err(|e| e.to_string())
}

