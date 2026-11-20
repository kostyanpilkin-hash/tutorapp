//! Shared lesson-occurrence expander: turns rows of `lessons` (singles,
//! recurring parents and exception rows) into concrete dated occurrences.
//! Used by the phone page and the Telegram bot.

use chrono::{DateTime, Datelike, Duration, NaiveDate, SecondsFormat, TimeZone, Utc, Weekday};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Occ {
    /// Row id for singles/exceptions, `<series id>@YYYYMMDD` for generated instances.
    pub id: String,
    pub name: String,
    pub start: String,
    pub duration_minutes: i64,
    pub status: String,
    pub payment_status: String,
    pub color: Option<String>,
    #[serde(skip)]
    pub subject: String,
    #[serde(skip)]
    pub link: Option<String>,
    #[serde(skip)]
    pub notes: Option<String>,
    #[serde(skip)]
    pub cost: f64,
    #[serde(skip)]
    pub currency: String,
    #[serde(skip)]
    pub start_utc: DateTime<Utc>,
    /// Underlying `lessons.id` — the parent row for generated instances.
    #[serde(skip)]
    pub row_id: String,
    /// `toISOString()`-style instant for generated series instances
    /// (used to build frontend `parent::ISO` ids); `None` for real rows.
    #[serde(skip)]
    pub instance_iso: Option<String>,
}

struct Raw {
    id: String,
    name: String,
    start: String,
    dur: i64,
    status: String,
    pay: String,
    color: Option<String>,
    rule: Option<String>,
    parent: Option<String>,
    idate: Option<String>,
    subject: String,
    link: Option<String>,
    notes: Option<String>,
    cost: f64,
    currency: String,
    updated: String,
    created: String,
}

pub fn timezone(conn: &Connection) -> chrono_tz::Tz {
    conn.query_row("SELECT value FROM settings WHERE key = 'timezone'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse::<chrono_tz::Tz>().ok())
        .unwrap_or(chrono_tz::Tz::Europe__Moscow)
}

/// All occurrences whose local date falls in `[from, to]`, sorted by start.
/// Deduped by occurrence id, then by (student, instant): when two rows
/// produce the same card — e.g. a cancelled exception plus a standalone
/// lesson that replaced it — the more informative one wins (non-cancelled
/// first, then real rows over series exceptions).
pub fn collect(conn: &Connection, tz: chrono_tz::Tz, from: NaiveDate, to: NaiveDate) -> Result<Vec<Occ>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, student_name, start_at, duration_minutes, status, payment_status, color,
                    recurrence_rule, recurrence_parent_id, recurrence_instance_date,
                    subject, link, notes, cost, currency, updated_at, created_at
             FROM lessons",
        )
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<Raw> = stmt
        .query_map([], |r| {
            Ok(Raw {
                id: r.get(0)?,
                name: r.get(1)?,
                start: r.get(2)?,
                dur: r.get(3)?,
                status: r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "scheduled".into()),
                pay: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                color: r.get(6)?,
                rule: r.get(7)?,
                parent: r.get(8)?,
                idate: r.get(9)?,
                subject: r.get::<_, Option<String>>(10)?.unwrap_or_default(),
                link: r.get(11)?,
                notes: r.get(12)?,
                cost: r.get::<_, Option<f64>>(13)?.unwrap_or(0.0),
                currency: r.get::<_, Option<String>>(14)?.unwrap_or_default(),
                updated: r.get::<_, Option<String>>(15)?.unwrap_or_default(),
                created: r.get::<_, Option<String>>(16)?.unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Display names resolve through lesson_students → students; orphaned
    // lessons keep their stored `student_name`.
    let display_names = crate::commands::lessons::lesson_display_names(conn)?;
    for r in rows.iter_mut() {
        if let Some(n) = display_names.get(&r.id) {
            n.clone_into(&mut r.name);
        }
    }

    let mut out: Vec<Occ> = Vec::new();
    let mut used_exceptions: HashSet<String> = HashSet::new();
    // Ids of occurrences emitted from exception rows — the (student, instant)
    // dedupe below prefers a real record over a cancelled exception.
    let mut exception_ids: HashSet<String> = HashSet::new();

    // Exceptions grouped by parent id, resolved to their slot's instant.
    let mut exceptions: HashMap<String, Vec<&Raw>> = HashMap::new();
    for r in &rows {
        if let (Some(pid), Some(_)) = (&r.parent, &r.idate) {
            exceptions.entry(pid.clone()).or_default().push(r);
        }
    }

    for r in &rows {
        if r.parent.is_some() {
            continue; // handled after the series pass
        }

        let parsed_rule = r.rule.as_deref().and_then(parse_rule);
        if let Some((mut bydays, interval, until, count)) = parsed_rule {
            if let Ok(start_utc) = r.start.parse::<DateTime<Utc>>() {
                let anchor = start_utc.with_timezone(&tz);
                let anchor_date = anchor.date_naive();
                let time = anchor.time();
                if bydays.is_empty() {
                    bydays = vec![anchor_date.weekday()];
                }
                let monday = anchor_date - Duration::days(anchor_date.weekday().num_days_from_monday() as i64);
                let exs = exceptions.get(&r.id).cloned().unwrap_or_default();

                let mut emitted_total = 0i64;
                let mut week = monday;
                'weeks: while week <= to {
                    for wd in &bydays {
                        let d = week + Duration::days(wd.num_days_from_monday() as i64);
                        if d < anchor_date {
                            continue;
                        }
                        let Some(local_dt) = tz.from_local_datetime(&d.and_time(time)).single() else {
                            continue;
                        };
                        let occ_utc = local_dt.with_timezone(&Utc);
                        emitted_total += 1;
                        if count.map(|c| emitted_total > c).unwrap_or(false) {
                            break 'weeks;
                        }
                        // UNTIL is an exclusive instant (matches the frontend).
                        if until.map(|u| occ_utc >= u).unwrap_or(false) {
                            break 'weeks;
                        }
                        if d < from || d > to {
                            continue;
                        }
                        // Slot overridden by exception row(s)? Pick the best one.
                        let slot_matches: Vec<&Raw> = exs
                            .iter()
                            .copied()
                            .filter(|e| {
                                parse_any_date(e.idate.as_deref().unwrap_or(""), tz) == Some(d)
                            })
                            .collect();
                        for m in &slot_matches {
                            used_exceptions.insert(m.id.clone());
                        }
                        if let Some(best) = pick_exception(&slot_matches) {
                            // Emit even cancelled exceptions: they stay visible
                            // in the schedule (finance/overlaps filter them).
                            if let Ok(dt) = best.start.parse::<DateTime<Utc>>() {
                                let bd = dt.with_timezone(&tz).date_naive();
                                if bd >= from && bd <= to {
                                    exception_ids.insert(best.id.clone());
                                    out.push(mk_occ(best, best.id.clone(), dt, None));
                                }
                            }
                        } else {
                            out.push(mk_occ(
                                r,
                                format!("{}@{}", r.id, d.format("%Y%m%d")),
                                occ_utc,
                                Some(occ_utc.to_rfc3339_opts(SecondsFormat::Millis, true)),
                            ));
                        }
                    }
                    week += Duration::weeks(interval.max(1));
                }
            }
        } else if let Ok(dt) = r.start.parse::<DateTime<Utc>>() {
            let d = dt.with_timezone(&tz).date_naive();
            if d >= from && d <= to {
                out.push(mk_occ(r, r.id.clone(), dt, None));
            }
        }
    }

    // Exception rows not consumed by a series slot (e.g. rescheduled away).
    for r in &rows {
        if r.parent.is_none() || used_exceptions.contains(&r.id) {
            continue;
        }
        if let Ok(dt) = r.start.parse::<DateTime<Utc>>() {
            let d = dt.with_timezone(&tz).date_naive();
            if d >= from && d <= to {
                exception_ids.insert(r.id.clone());
                out.push(mk_occ(r, r.id.clone(), dt, None));
            }
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    out.retain(|o| seen.insert(o.id.clone()));

    // Same student + same instant from several rows (a cancelled exception
    // plus the standalone lesson that replaced it) renders as duplicate
    // cards. Cancelled occurrences never win such a collision: drop them
    // when a live row covers the slot, or keep the real row when all
    // colliding rows are cancelled.
    let mut groups: HashMap<(String, i64), Vec<usize>> = HashMap::new();
    for (i, o) in out.iter().enumerate() {
        groups
            .entry((o.name.clone(), o.start_utc.timestamp()))
            .or_default()
            .push(i);
    }
    let mut keep = vec![true; out.len()];
    for idxs in groups.values() {
        if idxs.len() < 2 {
            continue;
        }
        if idxs.iter().any(|&i| out[i].status != "cancelled") {
            for &i in idxs {
                if out[i].status == "cancelled" {
                    keep[i] = false;
                }
            }
        } else {
            let best = idxs
                .iter()
                .copied()
                .max_by_key(|&i| u8::from(!exception_ids.contains(&out[i].id)))
                .unwrap();
            for &i in idxs {
                if i != best {
                    keep[i] = false;
                }
            }
        }
    }
    let mut idx = 0usize;
    out.retain(|_| {
        let k = keep[idx];
        idx += 1;
        k
    });
    out.sort_by_key(|o| o.start_utc);
    Ok(out)
}

/// UTC instants of weekly series slots in `[from, to]` — the same local-tz
/// expansion `collect` uses internally (BYDAY/INTERVAL/COUNT, exclusive UNTIL),
/// without exception handling. For per-student aggregates (finance) that
/// resolve exceptions themselves.
pub fn expand_weekly_starts_local(
    anchor_utc: DateTime<Utc>,
    rule: &Option<String>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tz: chrono_tz::Tz,
) -> Vec<DateTime<Utc>> {
    let Some((mut bydays, interval, until, count)) = rule.as_deref().and_then(parse_rule) else {
        return Vec::new();
    };
    let anchor = anchor_utc.with_timezone(&tz);
    let anchor_date = anchor.date_naive();
    let time = anchor.time();
    if bydays.is_empty() {
        bydays = vec![anchor_date.weekday()];
    }
    let monday = anchor_date - Duration::days(anchor_date.weekday().num_days_from_monday() as i64);
    let to_d = to.with_timezone(&tz).date_naive();

    let mut out = Vec::new();
    let mut emitted = 0i64;
    let mut week = monday;
    'weeks: while week <= to_d {
        for wd in &bydays {
            let d = week + Duration::days(wd.num_days_from_monday() as i64);
            if d < anchor_date {
                continue;
            }
            let Some(local_dt) = tz.from_local_datetime(&d.and_time(time)).single() else {
                continue;
            };
            let occ_utc = local_dt.with_timezone(&Utc);
            emitted += 1;
            if count.map(|c| emitted > c).unwrap_or(false) {
                break 'weeks;
            }
            if until.map(|u| occ_utc >= u).unwrap_or(false) {
                break 'weeks;
            }
            if occ_utc >= from && occ_utc <= to {
                out.push(occ_utc);
            }
        }
        week += Duration::weeks(interval.max(1));
    }
    out
}

/// Prefer the newest exception when several exist for one slot
/// (completed > no_show > cancelled > other, then latest update).
fn pick_exception<'a>(matches: &[&'a Raw]) -> Option<&'a Raw> {
    matches
        .iter()
        .max_by_key(|m| crate::domain::identity::exception_rank(&m.status, &m.updated, &m.created, &m.id))
        .copied()
}

fn mk_occ(r: &Raw, id: String, utc: DateTime<Utc>, instance_iso: Option<String>) -> Occ {
    Occ {
        id,
        name: r.name.clone(),
        start: utc.to_rfc3339(),
        duration_minutes: r.dur,
        status: r.status.clone(),
        payment_status: r.pay.clone(),
        color: r.color.clone(),
        subject: r.subject.clone(),
        link: r.link.clone(),
        notes: r.notes.clone(),
        cost: r.cost,
        currency: r.currency.clone(),
        start_utc: utc,
        row_id: r.id.clone(),
        instance_iso,
    }
}

pub fn parse_any_date(s: &str, tz: chrono_tz::Tz) -> Option<NaiveDate> {
    if let Ok(dt) = s.parse::<DateTime<Utc>>() {
        return Some(dt.with_timezone(&tz).date_naive());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub type ParsedRule = (Vec<Weekday>, i64, Option<DateTime<Utc>>, Option<i64>);

pub fn parse_rule(rule: &str) -> Option<ParsedRule> {
    let mut freq = String::new();
    let mut bydays: Vec<Weekday> = Vec::new();
    let mut interval: i64 = 1;
    let mut until: Option<DateTime<Utc>> = None;
    let mut count: Option<i64> = None;
    for part in rule.split(';') {
        let mut kv = part.splitn(2, '=');
        let (k, v) = (kv.next()?, kv.next()?);
        match k {
            "FREQ" => freq = v.to_string(),
            "BYDAY" => {
                for d in v.split(',') {
                    let wd = match d {
                        "MO" => Weekday::Mon,
                        "TU" => Weekday::Tue,
                        "WE" => Weekday::Wed,
                        "TH" => Weekday::Thu,
                        "FR" => Weekday::Fri,
                        "SA" => Weekday::Sat,
                        "SU" => Weekday::Sun,
                        _ => continue,
                    };
                    bydays.push(wd);
                }
            }
            "INTERVAL" => interval = v.parse().unwrap_or(1),
            "COUNT" => count = v.parse().ok(),
            "UNTIL" => {
                until = v.parse::<DateTime<Utc>>().ok().or_else(|| {
                    v.get(..10)
                        .and_then(|p| NaiveDate::parse_from_str(p, "%Y-%m-%d").ok())
                        .or_else(|| NaiveDate::parse_from_str(v, "%Y%m%d").ok())
                        .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
                });
            }
            _ => {}
        }
    }
    if freq != "WEEKLY" {
        return None;
    }
    bydays.sort_by_key(|w| w.num_days_from_monday());
    Some((bydays, interval, until, count))
}

/// Resolves an occurrence id back to a concrete row, creating an exception
/// row for generated series instances. Returns the row id to update.
pub fn materialize(conn: &Connection, occ_id: &str, tz: chrono_tz::Tz) -> Result<String, String> {
    let Some((parent_id, ymd)) = occ_id.split_once('@') else {
        return Ok(occ_id.to_string());
    };
    let date = NaiveDate::parse_from_str(ymd, "%Y%m%d").map_err(|e| e.to_string())?;
    let parent_start: String = conn
        .query_row("SELECT start_at FROM lessons WHERE id = ?1", [parent_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let anchor = parent_start.parse::<DateTime<Utc>>().map_err(|e| e.to_string())?.with_timezone(&tz);
    let instance_utc = tz
        .from_local_datetime(&date.and_time(anchor.time()))
        .single()
        .ok_or("ambiguous local time")?
        .with_timezone(&Utc);
    let instance_key = instance_utc.to_rfc3339();

    // Existing exception for this slot?
    let mut stmt = conn
        .prepare("SELECT id, recurrence_instance_date FROM lessons WHERE recurrence_parent_id = ?1")
        .map_err(|e| e.to_string())?;
    let existing = stmt
        .query_map([parent_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .find(|(_, d)| parse_any_date(d, tz) == Some(date))
        .map(|(id, _)| id);
    if let Some(id) = existing {
        return Ok(id);
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO lessons (id, student_name, subject, start_at, duration_minutes, cost, currency, link, notes, materials, materials_link,
                              status, payment_status, recurrence_rule, recurrence_parent_id, recurrence_instance_date, color, created_at, updated_at)
         SELECT ?1, student_name, subject, ?2, duration_minutes, cost, currency, link, notes, materials, materials_link,
                'scheduled', payment_status, NULL, ?3, ?4, color, ?5, ?5
         FROM lessons WHERE id = ?3",
        rusqlite::params![new_id, instance_key, parent_id, instance_key, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
         SELECT ?1, student_id, cost, currency, payment_status FROM lesson_students WHERE lesson_id = ?2",
        rusqlite::params![new_id, parent_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_local_byday_uses_local_weekday() {
        // Anchor: 2026-07-07 00:30 Europe/Moscow = 2026-07-06T21:30Z (UTC date is Monday,
        // local date is Tuesday). BYDAY=TU was written for the LOCAL weekday.
        let tz = chrono_tz::Europe::Moscow;
        let anchor = "2026-07-06T21:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let rule = Some("FREQ=WEEKLY;BYDAY=TU".to_string());
        let from = "2026-07-06T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let to = "2026-07-22T00:00:00Z".parse::<DateTime<Utc>>().unwrap();

        let starts = expand_weekly_starts_local(anchor, &rule, from, to, tz);
        let got: Vec<String> = starts.iter().map(|d| d.to_rfc3339()).collect();
        // Tuesdays 00:30 local: Jul 7, 14, 21 -> UTC 21:30 the day before.
        assert_eq!(
            got,
            vec![
                "2026-07-06T21:30:00+00:00".to_string(),
                "2026-07-13T21:30:00+00:00".to_string(),
                "2026-07-20T21:30:00+00:00".to_string(),
            ]
        );
        for s in &starts {
            assert_eq!(s.with_timezone(&tz).weekday(), Weekday::Tue);
        }
    }

    #[test]
    fn expand_local_keeps_wall_clock_across_dst() {
        // Berlin switches CET->CEST on 2026-03-29. Weekly series at 23:30 local
        // must stay at 23:30 local (shift in UTC), not drift to 00:30 next day.
        let tz = chrono_tz::Europe::Berlin;
        let anchor = "2026-03-28T22:30:00Z".parse::<DateTime<Utc>>().unwrap(); // Sat 23:30 CET
        let rule = Some("FREQ=WEEKLY".to_string());
        let from = "2026-03-28T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let to = "2026-04-12T00:00:00Z".parse::<DateTime<Utc>>().unwrap();

        let starts = expand_weekly_starts_local(anchor, &rule, from, to, tz);
        let local: Vec<String> = starts
            .iter()
            .map(|d| d.with_timezone(&tz).format("%Y-%m-%d %H:%M").to_string())
            .collect();
        assert_eq!(
            local,
            vec![
                "2026-03-28 23:30".to_string(),
                "2026-04-04 23:30".to_string(),
                "2026-04-11 23:30".to_string(),
            ]
        );
    }
}

#[cfg(test)]
mod realdb_tests {
    use super::*;
    use chrono::{Datelike, NaiveTime, Timelike};
    use rusqlite::Connection;

    // ── Legacy UTC-anchored expander (deleted in the finance-expanders wave).
    // Kept here ONLY as the before/after oracle for real-DB diffs.
    fn legacy_weekday(code: &str) -> Option<Weekday> {
        match code.to_uppercase().as_str() {
            "MO" => Some(Weekday::Mon),
            "TU" => Some(Weekday::Tue),
            "WE" => Some(Weekday::Wed),
            "TH" => Some(Weekday::Thu),
            "FR" => Some(Weekday::Fri),
            "SA" => Some(Weekday::Sat),
            "SU" => Some(Weekday::Sun),
            _ => None,
        }
    }

    fn legacy_expand_utc(
        anchor: DateTime<Utc>,
        rule: &Option<String>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Vec<DateTime<Utc>> {
        let mut until = None;
        let mut count = None;
        let mut bydays: Vec<Weekday> = Vec::new();
        if let Some(r) = rule {
            for part in r.split(';') {
                let p = part.trim();
                if let Some(raw) = p.strip_prefix("UNTIL=").or_else(|| p.strip_prefix("until=")) {
                    if let Ok(dt) = raw.parse::<DateTime<Utc>>() {
                        until = Some(dt);
                    }
                } else if let Some(raw) =
                    p.strip_prefix("COUNT=").or_else(|| p.strip_prefix("count="))
                {
                    if let Ok(n) = raw.parse::<u32>() {
                        if n > 0 {
                            count = Some(n);
                        }
                    }
                } else if let Some(raw) =
                    p.strip_prefix("BYDAY=").or_else(|| p.strip_prefix("byday="))
                {
                    bydays = raw.split(',').filter_map(|c| legacy_weekday(c.trim())).collect();
                }
            }
        }
        let anchor_weekday = anchor.weekday();
        let time = NaiveTime::from_hms_opt(anchor.hour(), anchor.minute(), anchor.second())
            .unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());
        let mut result = Vec::new();
        let mut cursor = anchor.date_naive();
        let mut emitted: u32 = 0;
        let hard_limit = anchor + Duration::days(366 * 5);
        while cursor <= to.date_naive() {
            let wd = cursor.weekday();
            let matches = if bydays.is_empty() { wd == anchor_weekday } else { bydays.contains(&wd) };
            if matches {
                let occurrence = cursor.and_time(time).and_utc();
                if occurrence + Duration::seconds(1) < anchor {
                    cursor = cursor.succ_opt().unwrap_or(cursor);
                    continue;
                }
                emitted += 1;
                if let Some(c) = count {
                    if emitted > c {
                        break;
                    }
                }
                if let Some(u) = until {
                    if occurrence >= u {
                        break;
                    }
                }
                if occurrence > hard_limit {
                    break;
                }
                if occurrence >= from && occurrence <= to {
                    result.push(occurrence);
                }
            }
            match cursor.succ_opt() {
                Some(n) => cursor = n,
                None => break,
            }
        }
        result
    }

    /// Before/after diff of finance expansion on a real DB copy.
    /// `PARITY_DB=<copy> cargo test -- --ignored finance_expansion_diff`
    #[test]
    #[ignore]
    fn finance_expansion_diff() {
        let db = std::env::var("PARITY_DB").expect("PARITY_DB");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::migrations::run(&conn).unwrap();
        let tz = timezone(&conn);

        let mut stmt = conn
            .prepare(
                "SELECT id, start_at, recurrence_rule FROM lessons
                 WHERE recurrence_rule LIKE '%WEEKLY%'
                   AND (recurrence_parent_id IS NULL OR recurrence_parent_id = '')",
            )
            .unwrap();
        let parents: Vec<(String, String, Option<String>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let now = Utc::now();
        let from = now - Duration::days(400);
        let to = now + Duration::days(400);

        let mut identical = 0;
        let mut diffs = 0;
        for (id, start_at, rule) in &parents {
            let anchor: DateTime<Utc> = match start_at.parse() {
                Ok(a) => a,
                Err(_) => continue,
            };
            let old = legacy_expand_utc(anchor, rule, from, to);
            let new = expand_weekly_starts_local(anchor, rule, from, to, tz);
            if old == new {
                identical += 1;
                continue;
            }
            diffs += 1;
            let old_set: std::collections::HashSet<String> =
                old.iter().map(|d| d.to_rfc3339()).collect();
            let new_set: std::collections::HashSet<String> =
                new.iter().map(|d| d.to_rfc3339()).collect();
            let only_old: Vec<&String> = old_set.iter().filter(|s| !new_set.contains(*s)).collect();
            let only_new: Vec<&String> = new_set.iter().filter(|s| !old_set.contains(*s)).collect();
            println!(
                "DIFF parent {id} rule={rule:?}\n  only-utc-algo: {only_old:?}\n  only-local-algo: {only_new:?}"
            );
        }
        println!(
            "tz={tz}, parents={}, identical={}, diffs={diffs}",
            parents.len(),
            identical
        );
    }
}
