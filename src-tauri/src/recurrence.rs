use chrono::{DateTime, Datelike, Duration, NaiveTime, Timelike, Utc, Weekday};

pub fn is_weekly(rule: &Option<String>) -> bool {
    rule.as_ref().is_some_and(|r| r.to_uppercase().contains("WEEKLY"))
}

/// Parse optional UNTIL from rule like `FREQ=WEEKLY;UNTIL=2026-07-13T12:00:00.000Z`
pub fn parse_until(rule: &Option<String>) -> Option<DateTime<Utc>> {
    let rule = rule.as_ref()?;
    for part in rule.split(';') {
        let part = part.trim();
        if let Some(raw) = part
            .strip_prefix("UNTIL=")
            .or_else(|| part.strip_prefix("until="))
        {
            if let Ok(dt) = raw.parse::<DateTime<Utc>>() {
                return Some(dt);
            }
            // Compact RRULE: 20260713T120000Z
            if raw.len() >= 15 {
                let compact = raw.trim_end_matches('Z');
                if compact.len() >= 15 {
                    let formatted = format!(
                        "{}-{}-{}T{}:{}:{}Z",
                        &compact[0..4],
                        &compact[4..6],
                        &compact[6..8],
                        &compact[9..11],
                        &compact[11..13],
                        &compact[13..15]
                    );
                    if let Ok(dt) = formatted.parse::<DateTime<Utc>>() {
                        return Some(dt);
                    }
                }
            }
        }
    }
    None
}

pub fn parse_count(rule: &Option<String>) -> Option<u32> {
    let rule = rule.as_ref()?;
    for part in rule.split(';') {
        let part = part.trim();
        if let Some(raw) = part
            .strip_prefix("COUNT=")
            .or_else(|| part.strip_prefix("count="))
        {
            if let Ok(n) = raw.parse::<u32>() {
                if n > 0 {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn weekday_from_code(code: &str) -> Option<Weekday> {
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

/// Empty vec means "only anchor weekday".
pub fn parse_byday(rule: &Option<String>) -> Vec<Weekday> {
    let Some(rule) = rule.as_ref() else {
        return Vec::new();
    };
    for part in rule.split(';') {
        let part = part.trim();
        let raw = part
            .strip_prefix("BYDAY=")
            .or_else(|| part.strip_prefix("byday="));
        let Some(raw) = raw else { continue };
        return raw
            .split(',')
            .filter_map(|c| weekday_from_code(c.trim()))
            .collect();
    }
    Vec::new()
}

#[allow(dead_code)]
pub fn with_until(rule: &str, until: DateTime<Utc>) -> String {
    let base = rule
        .split(';')
        .filter(|p| {
            let u = p.to_uppercase();
            !u.starts_with("UNTIL=") && !u.starts_with("COUNT=")
        })
        .collect::<Vec<_>>()
        .join(";");
    format!("{base};UNTIL={}", until.to_rfc3339())
}

fn matches_weekday(day: Weekday, bydays: &[Weekday], anchor_weekday: Weekday) -> bool {
    if bydays.is_empty() {
        day == anchor_weekday
    } else {
        bydays.contains(&day)
    }
}

/// Weekly occurrences from anchor inclusive, honouring BYDAY/UNTIL/COUNT, within [from, to].
pub fn expand_weekly_starts(
    anchor: DateTime<Utc>,
    rule: &Option<String>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<DateTime<Utc>> {
    let until = parse_until(rule);
    let count = parse_count(rule);
    let bydays = parse_byday(rule);
    let anchor_weekday = anchor.weekday();
    let time = NaiveTime::from_hms_opt(anchor.hour(), anchor.minute(), anchor.second())
        .unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());

    let mut result = Vec::new();
    let mut cursor_date = anchor.date_naive();
    let mut emitted: u32 = 0;
    let hard_limit = anchor + Duration::days(366 * 5);

    while cursor_date <= to.date_naive() {
        let weekday = cursor_date.weekday();
        if matches_weekday(weekday, &bydays, anchor_weekday) {
            let occurrence = cursor_date
                .and_time(time)
                .and_utc();
            if occurrence + Duration::seconds(1) < anchor {
                cursor_date = cursor_date.succ_opt().unwrap_or(cursor_date);
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
        match cursor_date.succ_opt() {
            Some(next) => cursor_date = next,
            None => break,
        }
    }
    result
}

pub fn intervals_overlap(
    a_start: DateTime<Utc>,
    a_end: DateTime<Utc>,
    b_start: DateTime<Utc>,
    b_end: DateTime<Utc>,
) -> bool {
    a_start < b_end && a_end > b_start
}
