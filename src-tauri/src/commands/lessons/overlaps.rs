use crate::db::AppState;
use crate::models::OverlapInfo;
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;

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

pub(crate) fn overlap_error(overlaps: &[OverlapInfo]) -> Option<String> {
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

/// Row ids of materialized exception rows that claim `parent_id`'s slot on the
/// local date of `instance_date`. Used to exclude a slot's existing row when
/// re-creating/rescheduling it (a second move would otherwise collide with
/// the row it replaces).
pub(crate) fn exception_row_ids(
    conn: &Connection,
    parent_id: &str,
    instance_date: &str,
    tz: chrono_tz::Tz,
) -> Result<Vec<String>, String> {
    let slot_date = crate::occurrences::parse_any_date(instance_date, tz);
    let mut stmt = conn
        .prepare("SELECT id, recurrence_instance_date FROM lessons WHERE recurrence_parent_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([parent_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(|r| r.ok())
        .filter(|(_, d)| crate::occurrences::parse_any_date(d, tz) == slot_date)
        .map(|(id, _)| id)
        .collect())
}

pub(crate) fn find_overlaps(
    conn: &Connection,
    start: DateTime<Utc>,
    duration_minutes: i64,
    exclude_id: Option<&str>,
) -> Result<Vec<OverlapInfo>, String> {
    find_overlaps_excluding_rows(conn, start, duration_minutes, exclude_id, &[])
}

pub(crate) fn find_overlaps_excluding_rows(
    conn: &Connection,
    start: DateTime<Utc>,
    duration_minutes: i64,
    exclude_id: Option<&str>,
    extra_exclude_rows: &[String],
) -> Result<Vec<OverlapInfo>, String> {
    use crate::recurrence::intervals_overlap;

    let end = start + Duration::minutes(duration_minutes);
    let range_from = start - Duration::days(1);
    let range_to = end + Duration::days(8);

    // `parent::ISO` excludes a single series slot; a bare id excludes that row
    // (a parent id excludes the whole series, matching the old behaviour).
    let exclude_row = exclude_id.filter(|ex| !ex.contains("::"));
    let exclude_slot = exclude_id
        .and_then(|ex| ex.split_once("::"))
        .map(|(pid, inst)| (pid.to_string(), inst.parse::<DateTime<Utc>>().ok()));

    let tz = crate::occurrences::timezone(conn);
    let occs = crate::occurrences::collect(
        conn,
        tz,
        range_from.with_timezone(&tz).date_naive(),
        range_to.with_timezone(&tz).date_naive(),
    )?;

    let mut overlaps = Vec::new();
    for occ in occs {
        if occ.status == "cancelled" || occ.start_utc < range_from || occ.start_utc > range_to {
            continue;
        }
        if exclude_row == Some(occ.row_id.as_str()) {
            continue;
        }
        if extra_exclude_rows.iter().any(|x| x == &occ.row_id) {
            continue;
        }
        if let Some((pid, inst)) = &exclude_slot {
            if &occ.row_id == pid && inst == &Some(occ.start_utc) {
                continue;
            }
        }
        let other_end = occ.start_utc + Duration::minutes(occ.duration_minutes);
        if intervals_overlap(start, end, occ.start_utc, other_end) {
            overlaps.push(OverlapInfo {
                id: match &occ.instance_iso {
                    Some(iso) => format!("{}::{}", occ.row_id, iso),
                    None => occ.id.clone(),
                },
                student_name: occ.name.clone(),
                start_at: occ.start_utc.to_rfc3339(),
                duration_minutes: occ.duration_minutes,
            });
        }
    }
    Ok(overlaps)
}

