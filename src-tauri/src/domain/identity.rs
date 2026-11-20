//! Identity of a series slot: `(parent_id, local date in the tutor timezone)`.
//!
//! One parent produces at most one occurrence per local day, so an exception
//! row overrides the slot whose local date matches its
//! `recurrence_instance_date`. That raw value may be RFC3339 (any offset) or
//! legacy date-only `YYYY-MM-DD`; anything else is reported, never guessed.

use crate::occurrences::parse_any_date;
use chrono::NaiveDate;
use chrono_tz::Tz;
use rusqlite::Connection;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SlotKey {
    pub parent_id: String,
    pub local_date: NaiveDate,
}

/// A row whose instance key cannot be mapped to a slot. Holds ids and a
/// reason only — no names, notes or raw user values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidSlot {
    pub row_id: String,
    pub parent_id: String,
    pub reason: &'static str,
}

pub fn parse_slot_key(parent_id: &str, raw: &str, tz: Tz) -> Result<SlotKey, &'static str> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("empty instance date");
    }
    parse_any_date(raw, tz)
        .map(|local_date| SlotKey { parent_id: parent_id.to_string(), local_date })
        .ok_or("unparseable instance date")
}

/// Which exception wins a slot: finalized status first, then the most
/// recently updated/created row, then id — deterministic everywhere.
pub fn exception_rank<'a>(status: &str, updated_at: &'a str, created_at: &'a str, id: &'a str) -> (u8, &'a str, &'a str, &'a str) {
    let s = match status {
        "completed" => 4,
        "no_show" => 3,
        "cancelled" => 2,
        _ => 1,
    };
    (s, updated_at, created_at, id)
}

#[derive(Debug, Clone)]
pub struct DuplicateGroup {
    pub key: SlotKey,
    pub keep: String,
    pub extra: Vec<String>,
}

#[derive(Debug, Default)]
pub struct SlotScan {
    pub duplicates: Vec<DuplicateGroup>,
    pub invalid: Vec<InvalidSlot>,
}

/// Read-only scan of all exception rows. Never modifies the database.
pub fn scan_exception_slots(conn: &Connection, tz: Tz) -> Result<SlotScan, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, recurrence_parent_id, recurrence_instance_date, status,
                    COALESCE(updated_at, ''), COALESCE(created_at, '')
             FROM lessons
             WHERE recurrence_parent_id IS NOT NULL AND recurrence_parent_id != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut scan = SlotScan::default();
    let mut groups: BTreeMap<SlotKey, Vec<(String, String, String, String)>> = BTreeMap::new();
    for row in rows {
        let (id, parent_id, raw, status, updated, created) = row.map_err(|e| e.to_string())?;
        match parse_slot_key(&parent_id, raw.as_deref().unwrap_or(""), tz) {
            Ok(key) => groups.entry(key).or_default().push((id, status, updated, created)),
            Err(reason) => scan.invalid.push(InvalidSlot { row_id: id, parent_id, reason }),
        }
    }
    for (key, mut items) in groups {
        if items.len() < 2 {
            continue;
        }
        items.sort_by(|a, b| exception_rank(&b.1, &b.2, &b.3, &b.0).cmp(&exception_rank(&a.1, &a.2, &a.3, &a.0)));
        let keep = items[0].0.clone();
        let extra = items.into_iter().skip(1).map(|i| i.0).collect();
        scan.duplicates.push(DuplicateGroup { key, keep, extra });
    }
    Ok(scan)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn equivalent_offsets_resolve_same_slot() {
        let tz: Tz = "Europe/Moscow".parse().unwrap();
        let a = parse_slot_key("p", "2026-11-09T10:00:00Z", tz).unwrap();
        let b = parse_slot_key("p", "2026-11-09T13:00:00+03:00", tz).unwrap();
        let c = parse_slot_key("p", "2026-11-09T10:00:00.000Z", tz).unwrap();
        let legacy = parse_slot_key("p", "2026-11-09", tz).unwrap();
        assert_eq!(a, b);
        assert_eq!(a, c);
        assert_eq!(a, legacy);
        assert_eq!(a.local_date, d("2026-11-09"));
    }

    #[test]
    fn local_date_uses_tutor_timezone() {
        // 22:30Z on the 8th is already the 9th in Moscow.
        let tz: Tz = "Europe/Moscow".parse().unwrap();
        assert_eq!(parse_slot_key("p", "2026-11-08T22:30:00Z", tz).unwrap().local_date, d("2026-11-09"));
    }

    #[test]
    fn date_only_keys_on_different_days_differ() {
        let tz = chrono_tz::UTC;
        assert_ne!(parse_slot_key("p", "2026-11-09", tz), parse_slot_key("p", "2026-11-16", tz));
    }

    #[test]
    fn invalid_slot_is_reported_not_guessed() {
        let tz = chrono_tz::UTC;
        assert_eq!(parse_slot_key("p", "not-a-date", tz), Err("unparseable instance date"));
        assert_eq!(parse_slot_key("p", "  ", tz), Err("empty instance date"));
    }

    #[test]
    fn rank_prefers_finalized_then_newest_then_id() {
        assert!(exception_rank("completed", "1", "1", "a") > exception_rank("scheduled", "9", "9", "z"));
        assert!(exception_rank("no_show", "1", "1", "a") > exception_rank("cancelled", "9", "9", "z"));
        assert!(exception_rank("scheduled", "2", "1", "a") > exception_rank("scheduled", "1", "9", "z"));
        assert!(exception_rank("scheduled", "1", "1", "b") > exception_rank("scheduled", "1", "1", "a"));
    }
}
