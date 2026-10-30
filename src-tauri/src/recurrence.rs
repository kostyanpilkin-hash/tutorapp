use chrono::{DateTime, Utc};

pub fn is_weekly(rule: &Option<String>) -> bool {
    rule.as_ref().is_some_and(|r| r.to_uppercase().contains("WEEKLY"))
}

pub fn intervals_overlap(
    a_start: DateTime<Utc>,
    a_end: DateTime<Utc>,
    b_start: DateTime<Utc>,
    b_end: DateTime<Utc>,
) -> bool {
    a_start < b_end && a_end > b_start
}
