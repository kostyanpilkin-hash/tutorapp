//! "This and following" change of a weekly series as ONE transaction.
//!
//! Policy (approved 2026-11-20):
//! - the old series is cut at the ORIGINAL selected slot, never at the new
//!   date: everything before that slot keeps its history even if the new
//!   start is earlier (an overlap with that history needs confirmation);
//! - future scheduled/cancelled exceptions move with the series by the same
//!   day offset, keeping payments, prices, notes and reminders;
//! - completed/no-show rows at or after the slot are history: the operation
//!   is refused instead of moving or dropping them;
//! - any failure leaves the database exactly as it was.

use crate::commands::lessons::{
    archive_rows, insert_reminders, log_activity, overlap_error, resolve_lesson_color, save_lesson_students,
    student_names,
};
use crate::domain::identity::parse_slot_key;
use crate::models::{LessonInput, OverlapInfo};
use crate::occurrences::{collect, expand_weekly_starts_local, parse_rule};
use chrono::{DateTime, Datelike, Duration, NaiveDate, SecondsFormat, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use rusqlite::{params, Connection};
use std::collections::HashSet;

/// Overlaps of the resulting series are checked this far ahead.
pub const PREVIEW_HORIZON_DAYS: i64 = 366;

pub struct SplitRequest<'a> {
    pub parent_id: &'a str,
    /// Original slot of the selected occurrence (its identity, not its actual start).
    pub instance_date: &'a str,
    /// The new series; `start_at` is the new start of the selected occurrence.
    pub template: &'a LessonInput,
    /// Explicit new rule when the user edited recurrence; otherwise derived
    /// from the old rule (same weekdays shifted, remaining COUNT / same UNTIL).
    pub rule_override: Option<&'a str>,
}

/// Id of the new series parent; the pre-change rows are in the
/// `series_split` archive referenced by the activity log entry.
#[derive(Debug)]
pub struct SplitReceipt {
    pub new_parent_id: String,
}

fn iso(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn local_instant(tz: Tz, date: NaiveDate, time: chrono::NaiveTime) -> Result<DateTime<Utc>, String> {
    tz.from_local_datetime(&date.and_time(time))
        .single()
        .map(|d| d.with_timezone(&Utc))
        .ok_or_else(|| format!("Время {} {} не существует или неоднозначно в поясе {}", date, time.format("%H:%M"), tz))
}

fn weekday_code(w: Weekday) -> &'static str {
    ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][w.num_days_from_monday() as usize]
}

fn shift(w: Weekday, days: i64) -> Weekday {
    let n = (w.num_days_from_monday() as i64 + days).rem_euclid(7);
    Weekday::try_from(n as u8).unwrap_or(w)
}

fn rule_without_end(rule: &str) -> Vec<String> {
    rule.split(';')
        .filter(|p| {
            let u = p.to_uppercase();
            !p.is_empty() && !u.starts_with("UNTIL=") && !u.starts_with("COUNT=")
        })
        .map(String::from)
        .collect()
}

pub fn split_series(conn: &Connection, req: &SplitRequest) -> Result<SplitReceipt, String> {
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    match split_series_tx(conn, req) {
        Ok(r) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(r)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

struct Move {
    id: String,
    new_instance: DateTime<Utc>,
    new_start: Option<DateTime<Utc>>,
    selected: bool,
}

fn split_series_tx(conn: &Connection, req: &SplitRequest) -> Result<SplitReceipt, String> {
    let tz = crate::occurrences::timezone(conn);
    let (parent_start, old_rule, parent_payment): (String, Option<String>, String) = conn
        .query_row(
            "SELECT start_at, recurrence_rule, payment_status FROM lessons WHERE id = ?1",
            params![req.parent_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Серия не найдена".to_string())?;
    let old_rule = old_rule.filter(|r| !r.is_empty()).ok_or("Занятие не является серией")?;
    let (bydays, _interval, old_until, old_count) = parse_rule(&old_rule).ok_or("Неподдерживаемое правило повторения")?;
    let anchor: DateTime<Utc> = parent_start.parse().map_err(|e: chrono::ParseError| e.to_string())?;
    let anchor_local = anchor.with_timezone(&tz);
    let new_start: DateTime<Utc> = req.template.start_at.parse().map_err(|e: chrono::ParseError| e.to_string())?;
    let new_local = new_start.with_timezone(&tz);

    let cutoff = parse_slot_key(req.parent_id, req.instance_date, tz)?.local_date;
    let cutoff_start = local_instant(tz, cutoff, chrono::NaiveTime::MIN)
        .or_else(|_| local_instant(tz, cutoff, chrono::NaiveTime::from_hms_opt(1, 0, 0).unwrap()))?;
    let rule_opt = Some(old_rule.clone());
    let day_end = cutoff_start + Duration::days(1) - Duration::seconds(1);
    if expand_weekly_starts_local(anchor, &rule_opt, cutoff_start, day_end, tz).is_empty() {
        return Err("Выбранное занятие не входит в серию".into());
    }
    let kept = expand_weekly_starts_local(anchor, &rule_opt, anchor - Duration::days(1), cutoff_start - Duration::seconds(1), tz).len() as i64;
    let delta = (new_local.date_naive() - cutoff).num_days();

    // Old series keeps only slots before the selected one.
    let mut old_parts = rule_without_end(&old_rule);
    match old_count {
        Some(_) => old_parts.push(format!("COUNT={kept}")),
        None => {
            let until = old_until.map_or(cutoff_start, |u| u.min(cutoff_start));
            old_parts.push(format!("UNTIL={}", iso(until)));
        }
    }
    let truncated_rule = old_parts.join(";");

    let new_rule = match req.rule_override.filter(|r| !r.is_empty()) {
        Some(r) => r.to_string(),
        None => {
            let base = if bydays.is_empty() { vec![anchor_local.weekday()] } else { bydays.clone() };
            let mut days: Vec<Weekday> = base.into_iter().map(|w| shift(w, delta)).collect();
            days.sort_by_key(|w| w.num_days_from_monday());
            days.dedup();
            let mut parts: Vec<String> = rule_without_end(&old_rule)
                .into_iter()
                .filter(|p| !p.to_uppercase().starts_with("BYDAY="))
                .collect();
            parts.push(format!("BYDAY={}", days.iter().map(|w| weekday_code(*w)).collect::<Vec<_>>().join(",")));
            if let Some(c) = old_count {
                parts.push(format!("COUNT={}", (c - kept).max(1)));
            } else if let Some(u) = old_until {
                parts.push(format!("UNTIL={}", iso(u)));
            }
            parts.join(";")
        }
    };

    // Future exceptions of the old series.
    let mut stmt = conn
        .prepare("SELECT id, recurrence_instance_date, status, start_at FROM lessons WHERE recurrence_parent_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, Option<String>, String, String)> = stmt
        .query_map(params![req.parent_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let mut moves: Vec<Move> = Vec::new();
    let mut finalized: Vec<NaiveDate> = Vec::new();
    let mut taken: HashSet<NaiveDate> = HashSet::new();
    for (id, raw, status, start) in rows {
        let Ok(key) = parse_slot_key(req.parent_id, raw.as_deref().unwrap_or(""), tz) else {
            continue; // unparseable key: never guessed, never touched
        };
        if key.local_date < cutoff {
            continue;
        }
        if status == "completed" || status == "no_show" {
            finalized.push(key.local_date);
            continue;
        }
        let new_date = key.local_date + Duration::days(delta);
        if !taken.insert(new_date) {
            return Err(format!("Два занятия серии попадают на {new_date} после переноса — перенос отменён"));
        }
        let new_instance = local_instant(tz, new_date, new_local.time())?;
        let old_slot = local_instant(tz, key.local_date, anchor_local.time()).ok();
        let in_slot = start.parse::<DateTime<Utc>>().ok().zip(old_slot).is_some_and(|(s, o)| s == o);
        let selected = key.local_date == cutoff;
        moves.push(Move { id, new_instance, new_start: (in_slot || selected).then_some(new_instance), selected });
    }
    if !finalized.is_empty() {
        finalized.sort();
        let dates: Vec<String> = finalized.iter().map(|d| d.format("%d.%m.%Y").to_string()).collect();
        return Err(format!(
            "В переносимой части серии есть проведённые занятия ({}). Они остаются в истории; перенесите серию с более позднего занятия или отметьте их отдельно.",
            dates.join(", ")
        ));
    }

    // Writes.
    let mut archived = vec![req.parent_id.to_string()];
    archived.extend(moves.iter().map(|m| m.id.clone()));
    let archive_id = archive_rows(conn, "series_split", &archived)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE lessons SET recurrence_rule = ?2, updated_at = ?3 WHERE id = ?1",
        params![req.parent_id, truncated_rule, now],
    )
    .map_err(|e| e.to_string())?;

    let t = req.template;
    let new_id = uuid::Uuid::new_v4().to_string();
    let student_name = student_names(conn, &t.students)?;
    let color = resolve_lesson_color(conn, &t.students, &t.color);
    conn.execute(
        "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, materials_link,
                              status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, color, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'scheduled',?12,?13,NULL,NULL,?14,?15,?15)",
        params![
            new_id, student_name, t.subject, iso(new_start), t.duration_minutes, t.cost, t.currency, t.link, t.notes,
            t.materials, t.materials_link, parent_payment, new_rule, color, now
        ],
    )
    .map_err(|e| e.to_string())?;
    save_lesson_students(conn, &new_id, &t.students, t.cost, t.currency.clone(), &parent_payment)?;
    insert_reminders(conn, &new_id, &t.reminders)?;

    for m in &moves {
        conn.execute(
            "UPDATE lessons SET recurrence_parent_id = ?2, recurrence_instance_date = ?3,
                    start_at = COALESCE(?4, start_at), updated_at = ?5 WHERE id = ?1",
            params![m.id, new_id, iso(m.new_instance), m.new_start.map(iso), now],
        )
        .map_err(|e| e.to_string())?;
        if m.selected {
            // The edited occurrence takes the form's details; its status,
            // price and payments stay its own.
            conn.execute(
                "UPDATE lessons SET subject = ?2, duration_minutes = ?3, link = ?4, notes = ?5, materials = ?6,
                        materials_link = ?7 WHERE id = ?1",
                params![m.id, t.subject, t.duration_minutes, t.link, t.notes, t.materials, t.materials_link],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if !t.force {
        let moved: HashSet<&str> = moves.iter().map(|m| m.id.as_str()).collect();
        let overlaps = resulting_overlaps(conn, tz, new_start, &new_id, &moved)?;
        if let Some(err) = overlap_error(&overlaps) {
            return Err(err);
        }
    }

    log_activity(
        conn,
        "lesson",
        "series_split",
        Some(&new_id),
        Some(&student_name),
        Some("start_at"),
        Some(req.instance_date),
        Some(&iso(new_start)),
        Some(&archive_id),
    );
    Ok(SplitReceipt { new_parent_id: new_id })
}

/// Overlaps of every occurrence of the new series (within the horizon) with
/// everything else — including the kept history of the old series.
fn resulting_overlaps(
    conn: &Connection,
    tz: Tz,
    from: DateTime<Utc>,
    new_id: &str,
    moved: &HashSet<&str>,
) -> Result<Vec<OverlapInfo>, String> {
    use crate::recurrence::intervals_overlap;
    let to = from + Duration::days(PREVIEW_HORIZON_DAYS);
    let occs = collect(
        conn,
        tz,
        (from - Duration::days(1)).with_timezone(&tz).date_naive(),
        (to + Duration::days(1)).with_timezone(&tz).date_naive(),
    )?;
    let (mine, others): (Vec<_>, Vec<_>) = occs
        .into_iter()
        .filter(|o| o.status != "cancelled")
        .partition(|o| o.row_id == new_id || moved.contains(o.row_id.as_str()));
    let mut out: Vec<OverlapInfo> = Vec::new();
    for m in &mine {
        let m_end = m.start_utc + Duration::minutes(m.duration_minutes);
        for o in &others {
            let o_end = o.start_utc + Duration::minutes(o.duration_minutes);
            if intervals_overlap(m.start_utc, m_end, o.start_utc, o_end) {
                out.push(OverlapInfo {
                    id: o.id.clone(),
                    student_name: o.name.clone(),
                    start_at: o.start_utc.to_rfc3339(),
                    duration_minutes: o.duration_minutes,
                });
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
