use crate::db::{app_data_dir, AppState};
use crate::models::{CurrencyAmount, Student, StudentFinance, StudentInput};
use chrono::Utc;
use rusqlite::{params, Row};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;
use validator::Validate;

const STUDENT_COLORS: &[&str] = &[
    "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

fn students_dir() -> PathBuf {
    let dir = app_data_dir().join("students");
    fs::create_dir_all(&dir).ok();
    dir
}

fn row_to_student(row: &Row) -> Result<Student, rusqlite::Error> {
    Ok(Student {
        id: row.get(0)?,
        name: row.get(1)?,
        phone: row.get(2)?,
        email: row.get(3)?,
        messenger: row.get(4)?,
        parents: row.get(5)?,
        parent_name: row.get(6)?,
        parent_phone: row.get(7)?,
        parent_messenger: row.get(8)?,
        birth_date: row.get(9)?,
        notes: row.get(10)?,
        lesson_note: row.get(11).unwrap_or_default(),
        timezone: row.get(12)?,
        default_cost: row.get(13)?,
        default_currency: row.get(14)?,
        default_link: row.get(15)?,
        default_duration: row.get(16)?,
        color: row.get(17)?,
        photo_path: row.get(18)?,
        paid_lessons: row.get::<_, i64>(19).unwrap_or(0),
        archived: row.get::<_, i64>(20)? != 0,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
    })
}

const STUDENT_SELECT: &str = "SELECT id, name, phone, email, messenger, parents, parent_name, parent_phone, parent_messenger, birth_date, notes,
    lesson_note, timezone, default_cost, default_currency, default_link, default_duration, color, photo_path,
    paid_lessons, archived, created_at, updated_at";

fn next_color(conn: &rusqlite::Connection) -> String {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0))
        .unwrap_or(0);
    STUDENT_COLORS[(count as usize) % STUDENT_COLORS.len()].to_string()
}

#[tauri::command]
pub fn get_students(
    state: tauri::State<AppState>,
    include_archived: bool,
) -> Result<Vec<Student>, String> {
    state.pool.with_conn(|conn| {
        let sql = if include_archived {
            format!("{STUDENT_SELECT} FROM students ORDER BY archived ASC, name ASC")
        } else {
            format!("{STUDENT_SELECT} FROM students WHERE archived = 0 ORDER BY name ASC")
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], row_to_student)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn get_student(state: tauri::State<AppState>, id: String) -> Result<Student, String> {
    state.pool.with_conn(|conn| {
        let mut stmt = conn
            .prepare(&format!("{STUDENT_SELECT} FROM students WHERE id = ?1"))
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], row_to_student)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn create_student(
    state: tauri::State<AppState>,
    input: StudentInput,
) -> Result<Student, String> {
    if let Err(errors) = input.validate() {
        return Err(format!("Ошибка валидации: {}", errors));
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        let color = input
            .color
            .clone()
            .unwrap_or_else(|| next_color(conn));
        conn.execute(
            "INSERT INTO students (id, name, phone, email, messenger, parents, parent_name, parent_phone, parent_messenger, birth_date, notes,
             lesson_note, timezone, default_cost, default_currency, default_link, default_duration, color,
             photo_path, paid_lessons, archived, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,NULL,?19,0,?20,?20)",
            params![
                id,
                input.name,
                input.phone,
                input.email,
                input.messenger,
                input.parents,
                input.parent_name,
                input.parent_phone,
                input.parent_messenger,
                input.birth_date,
                input.notes,
                input.lesson_note,
                input.timezone,
                input.default_cost,
                input.default_currency,
                input.default_link,
                input.default_duration,
                color,
                input.paid_lessons,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        super::lessons::log_activity(
            conn,
            "student",
            "created",
            Some(&id),
            Some(&input.name),
            None,
            None,
            None,
            None,
        );
        Ok(())
    })?;
    get_student(state, id)
}

#[tauri::command]
pub fn update_student(
    state: tauri::State<AppState>,
    id: String,
    input: StudentInput,
) -> Result<Student, String> {
    if let Err(errors) = input.validate() {
        return Err(format!("Ошибка валидации: {}", errors));
    }
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        let (old_currency, old_cost, old_link): (Option<String>, Option<f64>, Option<String>) = conn
            .query_row(
                "SELECT default_currency, default_cost, default_link FROM students WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((None, None, None));

        conn.execute(
            "UPDATE students SET name=?2, phone=?3, email=?4, messenger=?5, parents=?6,
             parent_name=?7, parent_phone=?8, parent_messenger=?9, birth_date=?10, notes=?11,
             lesson_note=?12, timezone=?13, default_cost=?14, default_currency=?15, default_link=?16,
             default_duration=?17, color=?18, paid_lessons=?19, updated_at=?20 WHERE id=?1",
            params![
                id,
                input.name,
                input.phone,
                input.email,
                input.messenger,
                input.parents,
                input.parent_name,
                input.parent_phone,
                input.parent_messenger,
                input.birth_date,
                input.notes,
                input.lesson_note,
                input.timezone,
                input.default_cost,
                input.default_currency,
                input.default_link,
                input.default_duration,
                input.color,
                input.paid_lessons,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        let sname = input.name.clone();
        if old_currency != input.default_currency {
            let _ = conn.execute(
                "INSERT INTO student_settings_log (id, student_id, field, old_value, new_value, changed_at)
                 VALUES (?1, ?2, 'default_currency', ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    old_currency,
                    input.default_currency,
                    now,
                ],
            );
            super::lessons::log_activity(
                conn, "student", "settings_changed", Some(&id), Some(&sname),
                Some("default_currency"), old_currency.as_deref(), input.default_currency.as_deref(), None,
            );
        }
        if old_cost != input.default_cost {
            let oc = old_cost.map(|c| c.to_string());
            let nc = input.default_cost.map(|c| c.to_string());
            let _ = conn.execute(
                "INSERT INTO student_settings_log (id, student_id, field, old_value, new_value, changed_at)
                 VALUES (?1, ?2, 'default_cost', ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    oc,
                    nc,
                    now,
                ],
            );
            super::lessons::log_activity(
                conn, "student", "settings_changed", Some(&id), Some(&sname),
                Some("default_cost"), oc.as_deref(), nc.as_deref(), None,
            );
        }
        if old_link != input.default_link {
            let _ = conn.execute(
                "INSERT INTO student_settings_log (id, student_id, field, old_value, new_value, changed_at)
                 VALUES (?1, ?2, 'default_link', ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    old_link,
                    input.default_link,
                    now,
                ],
            );
            super::lessons::log_activity(
                conn, "student", "settings_changed", Some(&id), Some(&sname),
                Some("default_link"), old_link.as_deref(), input.default_link.as_deref(), None,
            );
        }
        Ok(())
    })?;
    get_student(state, id)
}

#[tauri::command]
pub fn archive_student(
    state: tauri::State<AppState>,
    id: String,
    archived: bool,
) -> Result<Student, String> {
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        conn.execute(
            "UPDATE students SET archived = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, archived as i64, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    get_student(state, id)
}

#[tauri::command]
pub fn pick_student_photo(
    state: tauri::State<AppState>,
    student_id: String,
) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Изображения", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file();

    let Some(source) = file else {
        return Ok(None);
    };

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let dest = students_dir().join(format!("{student_id}.{ext}"));
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;

    let path = dest.to_string_lossy().to_string();
    let now = Utc::now().to_rfc3339();
    state.pool.with_conn(|conn| {
        conn.execute(
            "UPDATE students SET photo_path = ?2, updated_at = ?3 WHERE id = ?1",
            params![student_id, path, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    Ok(Some(path))
}

#[tauri::command]
pub fn remove_student_photo(
    state: tauri::State<AppState>,
    student_id: String,
) -> Result<Student, String> {
    state.pool.with_conn(|conn| {
        if let Ok(Some(p)) = conn.query_row(
            "SELECT photo_path FROM students WHERE id = ?1",
            params![student_id],
            |r| r.get::<_, Option<String>>(0),
        ) {
            let _ = fs::remove_file(p);
        }
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE students SET photo_path = NULL, updated_at = ?2 WHERE id = ?1",
            params![student_id, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    get_student(state, student_id)
}

#[tauri::command]
pub fn get_student_lessons(
    state: tauri::State<AppState>,
    student_id: String,
) -> Result<Vec<crate::models::Lesson>, String> {
    use crate::commands::lessons::get_lessons_for_student;
    get_lessons_for_student(&state, &student_id, None, None)
}

fn add_amount(map: &mut BTreeMap<String, f64>, currency: &str, amount: f64) {
    *map.entry(currency.to_string()).or_insert(0.0) += amount;
}

#[tauri::command]
pub fn get_student_finance(
    state: tauri::State<AppState>,
    student_id: String,
) -> Result<StudentFinance, String> {
    use crate::recurrence::is_weekly;
    use chrono::{DateTime, Duration, Utc};

    #[derive(Clone)]
    struct RowFin {
        id: String,
        start_at: DateTime<Utc>,
        status: String,
        recurrence_rule: Option<String>,
        recurrence_parent_id: Option<String>,
        recurrence_instance_date: Option<String>,
        cost: f64,
        currency: String,
        payment: String,
    }

    state.pool.with_conn(|conn| {
        let sql = r#"SELECT l.id, l.start_at, l.status, l.recurrence_rule,
                        l.recurrence_parent_id, l.recurrence_instance_date,
                        COALESCE(ls.cost, l.cost) AS cost,
                        COALESCE(ls.currency, l.currency, "USD") AS currency,
                        COALESCE(ls.payment_status, l.payment_status) AS payment
                 FROM lesson_students ls
                 JOIN lessons l ON l.id = ls.lesson_id
                 WHERE ls.student_id = ?1"#;

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![student_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut lessons: Vec<RowFin> = Vec::new();
        for row in rows {
            let (id, start_at, status, recurrence_rule, parent_id, instance_date, cost, currency, payment) =
                row.map_err(|e| e.to_string())?;
            let cost = cost.unwrap_or(0.0);
            if cost <= 0.0 {
                continue;
            }
            let start_at: DateTime<Utc> = start_at
                .parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())?;
            lessons.push(RowFin {
                id,
                start_at,
                status,
                recurrence_rule,
                recurrence_parent_id: parent_id,
                recurrence_instance_date: instance_date,
                cost,
                currency: currency.unwrap_or_else(|| "USD".to_string()),
                payment,
            });
        }

        let tz = crate::occurrences::timezone(conn);
        let now = Utc::now();
        let from = now - Duration::days(365);
        let to = now + Duration::days(90);

        let mut exceptions: Vec<RowFin> = Vec::new();
        let mut parents: Vec<RowFin> = Vec::new();
        let mut regular: Vec<RowFin> = Vec::new();

        for lesson in lessons {
            if lesson.recurrence_parent_id.is_some() {
                exceptions.push(lesson);
                continue;
            }
            if is_weekly(&lesson.recurrence_rule) {
                parents.push(lesson);
            } else {
                regular.push(lesson);
            }
        }

        let mut earned_map: BTreeMap<String, f64> = BTreeMap::new();
        let mut debt_map: BTreeMap<String, f64> = BTreeMap::new();
        let mut expected_map: BTreeMap<String, f64> = BTreeMap::new();

        let classify = |status: &str, payment: &str, cost: f64, currency: &str,
                        start_at: DateTime<Utc>,
                        earned: &mut BTreeMap<String, f64>,
                        debt: &mut BTreeMap<String, f64>,
                        expected: &mut BTreeMap<String, f64>| {
            // no_show is schedule-only: never counted in finance.
            if status == "cancelled" || status == "no_show" || cost <= 0.0 {
                return;
            }
            // Prepaid scheduled lessons still count as earned.
            if payment == "paid" {
                add_amount(earned, currency, cost);
            } else if status == "completed" {
                add_amount(debt, currency, cost);
            } else if status == "scheduled" {
                if start_at < now {
                    add_amount(debt, currency, cost);
                } else {
                    add_amount(expected, currency, cost);
                }
            }
        };

        for lesson in &regular {
            if lesson.start_at < from || lesson.start_at > to {
                // Still count past earned/debt outside the expected window
                if lesson.start_at < from
                    && (lesson.payment == "paid"
                        || lesson.status == "completed"
                        || lesson.status == "scheduled")
                {
                    classify(
                        &lesson.status,
                        &lesson.payment,
                        lesson.cost,
                        &lesson.currency,
                        lesson.start_at,
                        &mut earned_map,
                        &mut debt_map,
                        &mut expected_map,
                    );
                }
                continue;
            }
            classify(
                &lesson.status,
                &lesson.payment,
                lesson.cost,
                &lesson.currency,
                lesson.start_at,
                &mut earned_map,
                &mut debt_map,
                &mut expected_map,
            );
        }

        let mut counted_exception_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        for parent in &parents {
            for instance_start in crate::occurrences::expand_weekly_starts_local(
                parent.start_at,
                &parent.recurrence_rule,
                from,
                to,
                tz,
            ) {
                let exception = exceptions.iter().find(|ex| {
                    ex.recurrence_parent_id.as_deref() == Some(parent.id.as_str())
                        && ex
                            .recurrence_instance_date
                            .as_deref()
                            .and_then(|raw| raw.parse::<DateTime<Utc>>().ok())
                            .is_some_and(|dt| dt.timestamp() == instance_start.timestamp())
                });
                if let Some(exception) = exception {
                    counted_exception_ids.insert(exception.id.clone());
                    classify(
                        &exception.status,
                        &exception.payment,
                        exception.cost,
                        &exception.currency,
                        exception.start_at,
                        &mut earned_map,
                        &mut debt_map,
                        &mut expected_map,
                    );
                } else {
                    classify(
                        &parent.status,
                        &parent.payment,
                        parent.cost,
                        &parent.currency,
                        instance_start,
                        &mut earned_map,
                        &mut debt_map,
                        &mut expected_map,
                    );
                }
            }
        }

        // Exception rows whose original instance falls outside the expand window
        for exception in &exceptions {
            if counted_exception_ids.contains(&exception.id) {
                continue;
            }
            classify(
                &exception.status,
                &exception.payment,
                exception.cost,
                &exception.currency,
                exception.start_at,
                &mut earned_map,
                &mut debt_map,
                &mut expected_map,
            );
        }

        let to_vec = |m: BTreeMap<String, f64>| {
            m.into_iter()
                .map(|(currency, amount)| CurrencyAmount { currency, amount })
                .collect()
        };

        Ok(StudentFinance {
            earned: to_vec(earned_map),
            debt: to_vec(debt_map),
            expected: to_vec(expected_map),
        })
    })
}


