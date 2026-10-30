//! Shared lesson-occurrence expander: turns rows of `lessons` (singles,
//! recurring parents and exception rows) into concrete dated occurrences.
//! Used by the phone page and the Telegram bot.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};
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
}

pub fn timezone(conn: &Connection) -> chrono_tz::Tz {
    conn.query_row("SELECT value FROM settings WHERE key = 'timezone'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse::<chrono_tz::Tz>().ok())
        .unwrap_or(chrono_tz::Tz::Europe__Moscow)
}

/// All occurrences whose local date falls in `[from, to]`, sorted by start.
/// Cancelled exceptions are skipped. Deduped by occurrence id.
pub fn collect(conn: &Connection, tz: chrono_tz::Tz, from: NaiveDate, to: NaiveDate) -> Result<Vec<Occ>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, student_name, start_at, duration_minutes, status, payment_status, color,
                    recurrence_rule, recurrence_parent_id, recurrence_instance_date,
                    subject, link, notes, cost, currency
             FROM lessons",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Raw> = stmt
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
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut out: Vec<Occ> = Vec::new();

    let mut exceptions: HashMap<String, HashSet<NaiveDate>> = HashMap::new();
    for r in &rows {
        if let (Some(pid), Some(idate)) = (&r.parent, &r.idate) {
            if let Some(d) = parse_any_date(idate, tz) {
                exceptions.entry(pid.clone()).or_default().insert(d);
            }
        }
    }

    for r in &rows {
        if r.parent.is_some() {
            if r.status != "cancelled" {
                if let Ok(dt) = r.start.parse::<DateTime<Utc>>() {
                    let d = dt.with_timezone(&tz).date_naive();
                    if d >= from && d <= to {
                        out.push(mk_occ(r, r.id.clone(), dt));
                    }
                }
            }
            continue;
        }

        if let Some(rule) = &r.rule {
            if let Some((mut bydays, interval, until, count)) = parse_rule(rule) {
                if let Ok(start_utc) = r.start.parse::<DateTime<Utc>>() {
                    let anchor = start_utc.with_timezone(&tz);
                    let anchor_date = anchor.date_naive();
                    let time = anchor.time();
                    if bydays.is_empty() {
                        bydays = vec![anchor_date.weekday()];
                    }
                    let monday = anchor_date - Duration::days(anchor_date.weekday().num_days_from_monday() as i64);
                    let last = until.map(|u| u.min(to)).unwrap_or(to);
                    let exs = exceptions.get(&r.id).cloned().unwrap_or_default();

                    let mut emitted_total = 0i64;
                    let mut week = monday;
                    while week <= last && count.map(|c| emitted_total < c).unwrap_or(true) {
                        for wd in &bydays {
                            let d = week + Duration::days(wd.num_days_from_monday() as i64);
                            if d < anchor_date || d > last {
                                continue;
                            }
                            emitted_total += 1;
                            if count.map(|c| emitted_total > c).unwrap_or(false) {
                                break;
                            }
                            if exs.contains(&d) || d < from || d > to {
                                continue;
                            }
                            if let Some(local_dt) = tz.from_local_datetime(&d.and_time(time)).single() {
                                let utc = local_dt.with_timezone(&Utc);
                                out.push(mk_occ(r, format!("{}@{}", r.id, d.format("%Y%m%d")), utc));
                            }
                        }
                        week += Duration::weeks(interval.max(1));
                    }
                }
            } else if let Ok(dt) = r.start.parse::<DateTime<Utc>>() {
                let d = dt.with_timezone(&tz).date_naive();
                if d >= from && d <= to {
                    out.push(mk_occ(r, r.id.clone(), dt));
                }
            }
        } else if let Ok(dt) = r.start.parse::<DateTime<Utc>>() {
            let d = dt.with_timezone(&tz).date_naive();
            if d >= from && d <= to {
                out.push(mk_occ(r, r.id.clone(), dt));
            }
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    out.retain(|o| seen.insert(o.id.clone()));
    out.sort_by(|a, b| a.start_utc.cmp(&b.start_utc));
    Ok(out)
}

fn mk_occ(r: &Raw, id: String, utc: DateTime<Utc>) -> Occ {
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
    }
}

pub fn parse_any_date(s: &str, tz: chrono_tz::Tz) -> Option<NaiveDate> {
    if let Ok(dt) = s.parse::<DateTime<Utc>>() {
        return Some(dt.with_timezone(&tz).date_naive());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub fn parse_rule(rule: &str) -> Option<(Vec<Weekday>, i64, Option<NaiveDate>, Option<i64>)> {
    let mut freq = String::new();
    let mut bydays: Vec<Weekday> = Vec::new();
    let mut interval: i64 = 1;
    let mut until: Option<NaiveDate> = None;
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
                until = v
                    .get(..10)
                    .and_then(|p| NaiveDate::parse_from_str(p, "%Y-%m-%d").ok())
                    .or_else(|| NaiveDate::parse_from_str(v, "%Y%m%d").ok());
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
