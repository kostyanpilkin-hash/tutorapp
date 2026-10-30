use crate::db::AppState;
use crate::models::{
    CurrencyAmount, DebtEntry, FinanceReport, SubjectAmount, TimelinePoint,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection};
use std::collections::BTreeMap;

#[derive(Clone)]
struct StudentCostRow {
    cost: f64,
    currency: String,
    payment_status: String,
}

#[derive(Clone)]
struct LessonFinanceBase {
    id: String,
    subject: String,
    start_at: DateTime<Utc>,
    status: String,
    recurrence_rule: Option<String>,
    recurrence_parent_id: Option<String>,
    recurrence_instance_date: Option<String>,
    students: Vec<StudentCostRow>,
}

struct FinanceEntry {
    subject: String,
    start_at: DateTime<Utc>,
    status: String,
    payment_status: String,
    cost: f64,
    currency: String,
}

fn local_bound(tz: Tz, date: NaiveDate, end_of_day: bool) -> Option<DateTime<Utc>> {
    let time = if end_of_day {
        date.and_hms_opt(23, 59, 59).unwrap()
    } else {
        date.and_hms_opt(0, 0, 0).unwrap()
    };
    tz.from_local_datetime(&time)
        .single()
        .or_else(|| tz.from_local_datetime(&time).earliest())
        .or_else(|| tz.from_local_datetime(&time).latest())
        .map(|dt| dt.with_timezone(&Utc))
}

fn utc_bound(date: NaiveDate, end_of_day: bool) -> DateTime<Utc> {
    let time = if end_of_day {
        date.and_hms_opt(23, 59, 59).unwrap()
    } else {
        date.and_hms_opt(0, 0, 0).unwrap()
    };
    Utc.from_utc_datetime(&time)
}

fn period_bounds(period: &str, anchor: DateTime<Utc>, tz: Tz) -> (DateTime<Utc>, DateTime<Utc>) {
    let date = anchor.with_timezone(&tz).date_naive();
    let (start, end) = match period {
        "week" => {
            let weekday = date.weekday().num_days_from_monday() as i64;
            let start = date - Duration::days(weekday);
            (start, start + Duration::days(6))
        }
        "month" => {
            let start = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap();
            let next = if date.month() == 12 {
                NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap()
            } else {
                NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap()
            };
            (start, next - Duration::days(1))
        }
        "year" => (
            NaiveDate::from_ymd_opt(date.year(), 1, 1).unwrap(),
            NaiveDate::from_ymd_opt(date.year(), 12, 31).unwrap(),
        ),
        _ => (date, date),
    };
    (
        local_bound(tz, start, false).unwrap_or_else(|| utc_bound(start, false)),
        local_bound(tz, end, true).unwrap_or_else(|| utc_bound(end, true)),
    )
}

fn is_weekly(rule: &Option<String>) -> bool {
    rule.as_ref().is_some_and(|r| r.contains("WEEKLY"))
}

fn add_amount(map: &mut BTreeMap<String, f64>, currency: &str, amount: f64) {
    *map.entry(currency.to_string()).or_insert(0.0) += amount;
}

fn timeline_key(period: &str, dt: DateTime<Utc>, tz: Tz) -> String {
    let dt = dt.with_timezone(&tz);
    match period {
        "year" => format!("{:02}", dt.month()),
        "week" | "month" | "day" => format!("{:02}.{:02}", dt.day(), dt.month()),
        _ => format!("{:02}.{:02}", dt.day(), dt.month()),
    }
}

fn timeline_label(period: &str, dt: DateTime<Utc>, tz: Tz) -> String {
    let dt = dt.with_timezone(&tz);
    match period {
        "year" => format!("{}", dt.format("%b")),
        _ => format!("{}", dt.format("%d.%m")),
    }
}

fn push_student_entries(
    out: &mut Vec<FinanceEntry>,
    subject: &str,
    start_at: DateTime<Utc>,
    status: &str,
    students: &[StudentCostRow],
) {
    if status == "cancelled" {
        return;
    }
    for s in students {
        if s.cost <= 0.0 {
            continue;
        }
        out.push(FinanceEntry {
            subject: subject.to_string(),
            start_at,
            status: status.to_string(),
            payment_status: s.payment_status.clone(),
            cost: s.cost,
            currency: s.currency.clone(),
        });
    }
}

fn expand_weekly_instances(
    anchor: DateTime<Utc>,
    rule: &Option<String>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: Tz,
) -> Vec<DateTime<Utc>> {
    crate::occurrences::expand_weekly_starts_local(anchor, rule, from, to, tz)
}

fn parse_instance_dt(raw: &str) -> Option<DateTime<Utc>> {
    raw.parse::<DateTime<Utc>>().ok()
}

fn same_instant(a: DateTime<Utc>, b: DateTime<Utc>) -> bool {
    a.timestamp() == b.timestamp()
}

fn find_exception<'a>(
    exceptions: &'a [LessonFinanceBase],
    parent_id: &str,
    instance_start: DateTime<Utc>,
) -> Option<&'a LessonFinanceBase> {
    exceptions.iter().find(|ex| {
        ex.recurrence_parent_id.as_deref() == Some(parent_id)
            && ex
                .recurrence_instance_date
                .as_deref()
                .and_then(parse_instance_dt)
                .is_some_and(|dt| same_instant(dt, instance_start))
    })
}

#[allow(clippy::too_many_arguments)]
fn classify_finance_amounts(
    status: &str,
    payment_status: &str,
    cost: f64,
    currency: &str,
    start_at: DateTime<Utc>,
    now: DateTime<Utc>,
    earned: &mut BTreeMap<String, f64>,
    debt: &mut BTreeMap<String, f64>,
    expected: &mut BTreeMap<String, f64>,
) -> Option<&'static str> {
    if status == "cancelled" || cost <= 0.0 {
        return None;
    }
    // Paid money counts as earned even if the lesson is still scheduled (prepaid).
    if payment_status == "paid" {
        add_amount(earned, currency, cost);
        return Some("earned");
    }
    if status == "completed" || status == "no_show" {
        add_amount(debt, currency, cost);
        return Some("debt");
    }
    if status == "scheduled" {
        // Past unpaid scheduled lessons are debt; only future ones are expected.
        if start_at < now {
            add_amount(debt, currency, cost);
            return Some("debt");
        }
        add_amount(expected, currency, cost);
        return Some("expected");
    }
    None
}

fn build_finance_entries(
    lessons: &[LessonFinanceBase],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: Tz,
) -> Vec<FinanceEntry> {
    let mut exceptions: Vec<LessonFinanceBase> = Vec::new();
    let mut parents: Vec<LessonFinanceBase> = Vec::new();
    let mut regular: Vec<LessonFinanceBase> = Vec::new();

    for lesson in lessons {
        if lesson.recurrence_parent_id.is_some() {
            exceptions.push(lesson.clone());
            continue;
        }
        if is_weekly(&lesson.recurrence_rule) {
            parents.push(lesson.clone());
        } else if lesson.start_at >= from && lesson.start_at <= to {
            regular.push(lesson.clone());
        }
    }

    let mut out = Vec::new();

    for lesson in regular {
        push_student_entries(
            &mut out,
            &lesson.subject,
            lesson.start_at,
            &lesson.status,
            &lesson.students,
        );
    }

    let mut used_exception_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for parent in parents {
        for instance_start in expand_weekly_instances(parent.start_at, &parent.recurrence_rule, from, to, tz) {
            if let Some(exception) = find_exception(&exceptions, &parent.id, instance_start) {
                used_exception_ids.insert(exception.id.clone());
                if exception.status != "cancelled" {
                    push_student_entries(
                        &mut out,
                        &exception.subject,
                        exception.start_at,
                        &exception.status,
                        &exception.students,
                    );
                }
            } else {
                push_student_entries(
                    &mut out,
                    &parent.subject,
                    instance_start,
                    &parent.status,
                    &parent.students,
                );
            }
        }
    }

    // Exceptions that were moved away from the series slot but still fall in range.
    for exception in &exceptions {
        if used_exception_ids.contains(&exception.id) {
            continue;
        }
        if exception.start_at < from || exception.start_at > to {
            continue;
        }
        push_student_entries(
            &mut out,
            &exception.subject,
            exception.start_at,
            &exception.status,
            &exception.students,
        );
    }

    out
}

fn fill_timeline_slots(
    period: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: Tz,
    currencies: &[String],
    timeline: &mut BTreeMap<(String, String), (String, f64, f64, f64)>,
) {
    if currencies.is_empty() {
        return;
    }
    if period == "month" || period == "week" {
        let mut day = from.with_timezone(&tz).date_naive();
        let end = to.with_timezone(&tz).date_naive();
        while day <= end {
            let noon = day.and_hms_opt(12, 0, 0).unwrap();
            let dt = tz
                .from_local_datetime(&noon)
                .single()
                .or_else(|| tz.from_local_datetime(&noon).earliest())
                .or_else(|| tz.from_local_datetime(&noon).latest())
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|| Utc.from_utc_datetime(&noon));
            let tk = timeline_key(period, dt, tz);
            let label = timeline_label(period, dt, tz);
            for currency in currencies {
                timeline
                    .entry((tk.clone(), currency.clone()))
                    .or_insert((label.clone(), 0.0, 0.0, 0.0));
            }
            day += Duration::days(1);
        }
    }
}

#[tauri::command]
pub fn get_finance_report(
    state: tauri::State<AppState>,
    period: String,
    anchor: String,
    custom_from: Option<String>,
    custom_to: Option<String>,
) -> Result<FinanceReport, String> {
    let anchor_dt: DateTime<Utc> = anchor
        .parse::<DateTime<Utc>>()
        .map_err(|e: chrono::ParseError| e.to_string())?;
    let custom_from = custom_from
        .map(|s| {
            s.parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())
        })
        .transpose()?;
    let custom_to = custom_to
        .map(|s| {
            s.parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())
        })
        .transpose()?;

    state.pool.with_conn(|conn| {
        let tz_name = crate::commands::lessons::setting_timezone(conn);
        let tz: Tz = tz_name.parse().unwrap_or(chrono_tz::Europe::Moscow);
        finance_report(conn, &period, anchor_dt, custom_from, custom_to, tz)
    })
}

pub(crate) fn finance_report(
    conn: &Connection,
    period: &str,
    anchor_dt: DateTime<Utc>,
    custom_from: Option<DateTime<Utc>>,
    custom_to: Option<DateTime<Utc>>,
    tz: Tz,
) -> Result<FinanceReport, String> {
    let (from, to) = if period == "custom" {
        (
            custom_from.ok_or_else(|| "custom_from required".to_string())?,
            custom_to.ok_or_else(|| "custom_to required".to_string())?,
        )
    } else {
        period_bounds(period, anchor_dt, tz)
    };

    {
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.subject, l.start_at, l.status, l.recurrence_rule,
                        l.recurrence_parent_id, l.recurrence_instance_date,
                        COALESCE(ls.cost, l.cost) AS cost,
                        COALESCE(NULLIF(ls.currency, ''), NULLIF(l.currency, ''), 'USD') AS currency,
                        COALESCE(NULLIF(ls.payment_status, ''), l.payment_status) AS payment_status
                 FROM lessons l
                 INNER JOIN lesson_students ls ON ls.lesson_id = l.id
                 WHERE (l.start_at >= ?1 AND l.start_at <= ?2)
                    OR (l.recurrence_rule IS NOT NULL AND l.recurrence_rule != ''
                        AND (l.recurrence_parent_id IS NULL OR l.recurrence_parent_id = '')
                        AND l.start_at <= ?2)
                    OR (l.recurrence_parent_id IS NOT NULL AND l.recurrence_parent_id != ''
                        AND l.start_at >= ?1 AND l.start_at <= ?2)",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![from.to_rfc3339(), to.to_rfc3339()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<f64>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut lesson_map: BTreeMap<String, LessonFinanceBase> = BTreeMap::new();

        for row in rows {
            let (id, subject, start_at, status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, cost, currency, payment_status) =
                row.map_err(|e| e.to_string())?;
            let cost = cost.unwrap_or(0.0);
            if cost <= 0.0 {
                continue;
            }
            let currency = currency.unwrap_or_else(|| "USD".to_string());
            let start_at: DateTime<Utc> = start_at
                .parse::<DateTime<Utc>>()
                .map_err(|e: chrono::ParseError| e.to_string())?;

            lesson_map
                .entry(id.clone())
                .or_insert_with(|| LessonFinanceBase {
                    id,
                    subject,
                    start_at,
                    status: status.clone(),
                    recurrence_rule,
                    recurrence_parent_id,
                    recurrence_instance_date,
                    students: Vec::new(),
                })
                .students
                .push(StudentCostRow {
                    cost,
                    currency,
                    payment_status,
                });
        }

        let lessons: Vec<LessonFinanceBase> = lesson_map.into_values().collect();
        let entries = build_finance_entries(&lessons, from, to, tz);
        let now = Utc::now();

        let mut earned_map: BTreeMap<String, f64> = BTreeMap::new();
        let mut debt_map: BTreeMap<String, f64> = BTreeMap::new();
        let mut expected_map: BTreeMap<String, f64> = BTreeMap::new();
        let mut subject_map: BTreeMap<(String, String), (f64, f64, f64)> = BTreeMap::new();
        // Key: (time bucket, currency) — never mix different currencies in one bucket.
        let mut timeline: BTreeMap<(String, String), (String, f64, f64, f64)> = BTreeMap::new();

        for entry in &entries {
            let subject_key = if entry.subject.is_empty() {
                "—".to_string()
            } else {
                entry.subject.clone()
            };

            let tk = timeline_key(period, entry.start_at, tz);
            let tl = timeline_label(period, entry.start_at, tz);
            let bucket = timeline
                .entry((tk, entry.currency.clone()))
                .or_insert((tl, 0.0, 0.0, 0.0));

            let sub = subject_map
                .entry((subject_key.clone(), entry.currency.clone()))
                .or_insert((0.0, 0.0, 0.0));

            match classify_finance_amounts(
                &entry.status,
                &entry.payment_status,
                entry.cost,
                &entry.currency,
                entry.start_at,
                now,
                &mut earned_map,
                &mut debt_map,
                &mut expected_map,
            ) {
                Some("earned") => {
                    sub.0 += entry.cost;
                    bucket.1 += entry.cost;
                }
                Some("debt") => {
                    sub.1 += entry.cost;
                    bucket.2 += entry.cost;
                }
                Some("expected") => {
                    sub.2 += entry.cost;
                    bucket.3 += entry.cost;
                }
                _ => {}
            }
        }

        let mut currencies: Vec<String> = earned_map
            .keys()
            .chain(debt_map.keys())
            .chain(expected_map.keys())
            .cloned()
            .collect();
        currencies.sort();
        currencies.dedup();
        fill_timeline_slots(period, from, to, tz, &currencies, &mut timeline);

        let to_vec = |m: BTreeMap<String, f64>| {
            m.into_iter()
                .map(|(currency, amount)| CurrencyAmount { currency, amount })
                .collect()
        };

        let by_subject: Vec<SubjectAmount> = subject_map
            .into_iter()
            .map(|((subject, currency), (earned, debt, expected))| SubjectAmount {
                subject,
                currency,
                earned,
                debt,
                expected,
            })
            .collect();

        let timeline: Vec<TimelinePoint> = timeline
            .into_iter()
            .map(|((_, currency), (label, earned, debt, expected))| TimelinePoint {
                label,
                earned,
                debt,
                expected,
                currency,
            })
            .collect();

        Ok(FinanceReport {
            period: period.to_string(),
            from: from.to_rfc3339(),
            to: to.to_rfc3339(),
            earned: to_vec(earned_map),
            debt: to_vec(debt_map),
            expected: to_vec(expected_map),
            by_subject,
            timeline,
        })
    }
}

#[tauri::command]
pub fn mark_debt_paid(
    state: tauri::State<AppState>,
    lesson_id: String,
    student_id: String,
) -> Result<(), String> {
    state
        .pool
        .with_conn(|conn| mark_debt_paid_conn(conn, &lesson_id, &student_id))
}

pub(crate) fn mark_debt_paid_conn(
    conn: &Connection,
    lesson_id: &str,
    student_id: &str,
) -> Result<(), String> {
    {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let updated = conn
                .execute(
                    "UPDATE lesson_students SET payment_status = 'paid'
                     WHERE lesson_id = ?1 AND student_id = ?2",
                    params![lesson_id, student_id],
                )
                .map_err(|e| e.to_string())?;
            if updated == 0 {
                return Err("Занятие или ученик не найдены".to_string());
            }

            let unpaid_students: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM lesson_students
                     WHERE lesson_id = ?1 AND payment_status != 'paid'",
                    params![lesson_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let payment_status = if unpaid_students == 0 { "paid" } else { "unpaid" };
            conn.execute(
                "UPDATE lessons SET payment_status = ?2, updated_at = ?3 WHERE id = ?1",
                params![lesson_id, payment_status, Utc::now().to_rfc3339()],
            )
            .map_err(|e| e.to_string())?;
            let name: Option<String> = conn
                .query_row(
                    "SELECT s.name FROM students s WHERE s.id = ?1",
                    params![student_id],
                    |r| r.get(0),
                )
                .ok();
            super::lessons::log_activity(
                conn,
                "finance",
                "debt_paid",
                Some(student_id),
                name.as_deref(),
                Some("payment_status"),
                Some("unpaid"),
                Some("paid"),
                Some(lesson_id),
            );
            Ok(())
        })();

        match result {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}

#[tauri::command]
pub fn get_debt_lessons(
    state: tauri::State<AppState>,
) -> Result<Vec<DebtEntry>, String> {
    state.pool.with_conn(debt_lessons)
}

pub(crate) fn debt_lessons(conn: &Connection) -> Result<Vec<DebtEntry>, String> {
    {
        let mut stmt = conn
            .prepare(
                "SELECT l.id, s.id, s.name, l.subject, l.start_at, l.status,
                        COALESCE(ls.cost, l.cost) AS cost,
                        COALESCE(NULLIF(ls.currency, ''), NULLIF(l.currency, ''), 'USD') AS currency
                 FROM lessons l
                 INNER JOIN lesson_students ls ON ls.lesson_id = l.id
                 INNER JOIN students s ON s.id = ls.student_id
                 WHERE l.status IN ('completed', 'no_show')
                   AND COALESCE(NULLIF(ls.payment_status, ''), l.payment_status) != 'paid'
                   AND COALESCE(ls.cost, l.cost) > 0
                 ORDER BY l.start_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(DebtEntry {
                    lesson_id: row.get(0)?,
                    student_id: row.get(1)?,
                    student_name: row.get(2)?,
                    subject: row.get(3)?,
                    start_at: row.get(4)?,
                    status: row.get(5)?,
                    cost: row.get(6)?,
                    currency: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
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

    fn insert_student(conn: &Connection, id: &str, name: &str) {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO students (id, name, notes, archived, created_at, updated_at)
             VALUES (?1, ?2, '', 0, ?3, ?3)",
            params![id, name, now],
        )
        .unwrap();
    }

    fn insert_lesson(
        conn: &Connection,
        id: &str,
        start_at_rfc3339: &str,
        status: &str,
        payment_status: &str,
        cost: Option<f64>,
        currency: &str,
        students: &[(&str, Option<f64>, &str, &str)],
    ) {
        let now = Utc::now().to_rfc3339();
        let student_name = students
            .first()
            .map(|(sid, _, _, _)| {
                conn.query_row(
                    "SELECT name FROM students WHERE id = ?1",
                    params![sid],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_default()
            })
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, status, payment_status, created_at, updated_at)
             VALUES (?1, ?2, 'Math', ?3, 60, ?4, ?5, NULL, '', '', ?6, ?7, ?8, ?8)",
            params![id, student_name, start_at_rfc3339, cost, currency, status, payment_status, now],
        )
        .unwrap();
        for (sid, scost, scurrency, spayment) in students {
            conn.execute(
                "INSERT INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, sid, scost, scurrency, spayment],
            )
            .unwrap();
        }
    }

    fn amount(report: &FinanceReport, currency: &str) -> Option<f64> {
        report
            .earned
            .iter()
            .find(|e| e.currency == currency)
            .map(|e| e.amount)
    }

    #[test]
    fn debt_includes_completed_unpaid() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "completed",
            "unpaid",
            Some(20.0),
            "USD",
            &[("s1", None, "", "unpaid")],
        );
        let debts = debt_lessons(&conn).unwrap();
        assert_eq!(debts.len(), 1);
        assert!((debts[0].cost - 20.0).abs() < 1e-9);
        assert_eq!(debts[0].currency, "USD");
    }

    #[test]
    fn debt_includes_no_show_unpaid() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "no_show",
            "unpaid",
            Some(20.0),
            "USD",
            &[("s1", None, "", "unpaid")],
        );
        assert_eq!(debt_lessons(&conn).unwrap().len(), 1);
    }

    #[test]
    fn debt_excludes_cancelled() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "cancelled",
            "unpaid",
            Some(20.0),
            "USD",
            &[("s1", None, "", "unpaid")],
        );
        assert!(debt_lessons(&conn).unwrap().is_empty());
    }

    #[test]
    fn debt_excludes_zero_or_null_cost() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "completed",
            "unpaid",
            None,
            "USD",
            &[("s1", None, "", "unpaid")],
        );
        insert_lesson(
            &conn,
            "l2",
            "2026-03-11T10:00:00Z",
            "completed",
            "unpaid",
            Some(0.0),
            "USD",
            &[("s1", Some(0.0), "USD", "unpaid")],
        );
        assert!(debt_lessons(&conn).unwrap().is_empty());
    }

    #[test]
    fn debt_excludes_paid() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "completed",
            "paid",
            Some(20.0),
            "USD",
            &[("s1", None, "", "paid")],
        );
        assert!(debt_lessons(&conn).unwrap().is_empty());
    }

    #[test]
    fn mark_debt_paid_single_student() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "completed",
            "unpaid",
            Some(20.0),
            "USD",
            &[("s1", None, "", "unpaid")],
        );
        mark_debt_paid_conn(&conn, "l1", "s1").unwrap();
        assert!(debt_lessons(&conn).unwrap().is_empty());
        let lesson_status: String = conn
            .query_row(
                "SELECT payment_status FROM lessons WHERE id = 'l1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lesson_status, "paid");
        let student_status: String = conn
            .query_row(
                "SELECT payment_status FROM lesson_students WHERE lesson_id = 'l1' AND student_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(student_status, "paid");
    }

    #[test]
    fn mark_debt_paid_group_lesson_partial() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_student(&conn, "s2", "Maria");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "completed",
            "unpaid",
            Some(20.0),
            "USD",
            &[
                ("s1", None, "", "unpaid"),
                ("s2", None, "", "unpaid"),
            ],
        );
        mark_debt_paid_conn(&conn, "l1", "s1").unwrap();
        let debts = debt_lessons(&conn).unwrap();
        assert_eq!(debts.len(), 1);
        assert_eq!(debts[0].student_id, "s2");
        let lesson_status: String = conn
            .query_row(
                "SELECT payment_status FROM lessons WHERE id = 'l1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lesson_status, "unpaid");
        mark_debt_paid_conn(&conn, "l1", "s2").unwrap();
        assert!(debt_lessons(&conn).unwrap().is_empty());
        let lesson_status: String = conn
            .query_row(
                "SELECT payment_status FROM lessons WHERE id = 'l1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lesson_status, "paid");
    }

    #[test]
    fn mark_debt_paid_unknown_returns_err() {
        let conn = test_conn();
        assert!(mark_debt_paid_conn(&conn, "nope", "nope").is_err());
    }

    #[test]
    fn finance_month_uses_local_timezone() {
        let conn = test_conn();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', 'Europe/Minsk')",
            [],
        )
        .unwrap();
        insert_student(&conn, "s1", "Ivan");
        // 2026-03-01T01:00:00+03:00 local Minsk = 2026-02-28T22:00:00Z
        insert_lesson(
            &conn,
            "l1",
            "2026-02-28T22:00:00Z",
            "completed",
            "paid",
            Some(30.0),
            "USD",
            &[("s1", None, "", "paid")],
        );
        let tz: Tz = "Europe/Minsk".parse().unwrap();
        let march = finance_report(
            &conn,
            "month",
            "2026-03-15T12:00:00Z".parse().unwrap(),
            None,
            None,
            tz,
        )
        .unwrap();
        assert!((amount(&march, "USD").unwrap_or(0.0) - 30.0).abs() < 1e-9);
        let feb = finance_report(
            &conn,
            "month",
            "2026-02-15T12:00:00Z".parse().unwrap(),
            None,
            None,
            tz,
        )
        .unwrap();
        assert!(amount(&feb, "USD").unwrap_or(0.0).abs() < 1e-9);
    }

    #[test]
    fn finance_groups_by_currency_without_conversion() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "completed",
            "paid",
            Some(50.0),
            "USD",
            &[("s1", None, "", "paid")],
        );
        insert_lesson(
            &conn,
            "l2",
            "2026-03-12T10:00:00Z",
            "completed",
            "paid",
            Some(100.0),
            "BYN",
            &[("s1", None, "", "paid")],
        );
        let tz: Tz = "Europe/Minsk".parse().unwrap();
        let report = finance_report(
            &conn,
            "month",
            "2026-03-15T12:00:00Z".parse().unwrap(),
            None,
            None,
            tz,
        )
        .unwrap();
        assert_eq!(report.earned.len(), 2);
        assert!((amount(&report, "USD").unwrap_or(0.0) - 50.0).abs() < 1e-9);
        assert!((amount(&report, "BYN").unwrap_or(0.0) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn finance_excludes_cancelled_and_zero_cost() {
        let conn = test_conn();
        insert_student(&conn, "s1", "Ivan");
        insert_lesson(
            &conn,
            "l1",
            "2026-03-10T10:00:00Z",
            "cancelled",
            "paid",
            Some(40.0),
            "USD",
            &[("s1", None, "", "paid")],
        );
        insert_lesson(
            &conn,
            "l2",
            "2026-03-11T10:00:00Z",
            "completed",
            "unpaid",
            None,
            "USD",
            &[("s1", None, "", "unpaid")],
        );
        let tz: Tz = "Europe/Minsk".parse().unwrap();
        let report = finance_report(
            &conn,
            "month",
            "2026-03-15T12:00:00Z".parse().unwrap(),
            None,
            None,
            tz,
        )
        .unwrap();
        assert!(report.earned.is_empty());
        assert!(report.debt.is_empty());
        assert!(report.expected.is_empty());
    }
}
