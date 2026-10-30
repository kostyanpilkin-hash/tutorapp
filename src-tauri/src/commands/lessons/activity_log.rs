use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

pub(crate) fn log_lesson_diff(
    conn: &Connection,
    id: &str,
    name: &str,
    old: (&str, &str, &str),
    new: (&str, &str, &str),
    instance_date: Option<&str>,
) -> bool {
    let mut logged = false;
    if old.0 != new.0 {
        log_activity(conn, "lesson", "status_changed", Some(id), Some(name), Some("status"), Some(old.0), Some(new.0), instance_date);
        logged = true;
    }
    if old.1 != new.1 {
        log_activity(conn, "lesson", "payment_changed", Some(id), Some(name), Some("payment_status"), Some(old.1), Some(new.1), instance_date);
        logged = true;
    }
    let same_start = match (old.2.parse::<DateTime<Utc>>(), new.2.parse::<DateTime<Utc>>()) {
        (Ok(a), Ok(b)) => a.timestamp() == b.timestamp(),
        _ => old.2 == new.2,
    };
    if !same_start {
        log_activity(conn, "lesson", "rescheduled", Some(id), Some(name), Some("start_at"), Some(old.2), Some(new.2), instance_date);
        logged = true;
    }
    logged
}

/// Collects a lesson id plus all its exception rows (for archiving before delete).
pub(crate) fn lesson_with_children(conn: &Connection, id: &str) -> Vec<String> {
    let mut ids = vec![id.to_string()];
    if let Ok(mut st) = conn.prepare("SELECT id FROM lessons WHERE recurrence_parent_id = ?1") {
        if let Ok(rows) = st.query_map(params![id], |r| r.get::<_, String>(0)) {
            ids.extend(rows.filter_map(|r| r.ok()));
        }
    }
    ids
}

pub(crate) fn log_activity(
    conn: &Connection,
    category: &str,
    action: &str,
    entity_id: Option<&str>,
    entity_name: Option<&str>,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    details: Option<&str>,
) {
    let _ = conn.execute(
        "INSERT INTO activity_log (id, category, action, entity_id, entity_name, field, old_value, new_value, details, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            category,
            action,
            entity_id,
            entity_name,
            field,
            old_value,
            new_value,
            details,
            Utc::now().to_rfc3339()
        ],
    );
}

