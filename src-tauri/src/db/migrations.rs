use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

const STUDENT_COLORS: &[&str] = &[
    "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

pub fn run(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lessons (
            id TEXT PRIMARY KEY,
            student_name TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            start_at TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            cost REAL,
            currency TEXT,
            link TEXT,
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'scheduled',
            payment_status TEXT NOT NULL DEFAULT 'unpaid',
            recurrence_rule TEXT,
            recurrence_parent_id TEXT,
            recurrence_instance_date TEXT,
            color TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (recurrence_parent_id) REFERENCES lessons(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            lesson_id TEXT NOT NULL,
            minutes_before INTEGER NOT NULL,
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reminder_snoozes (
            lesson_id TEXT NOT NULL,
            instance_start TEXT NOT NULL,
            minutes_before INTEGER NOT NULL,
            snooze_until TEXT NOT NULL,
            PRIMARY KEY (lesson_id, instance_start, minutes_before)
        );

        CREATE TABLE IF NOT EXISTS fired_reminders (
            lesson_id TEXT NOT NULL,
            instance_start TEXT NOT NULL,
            minutes_before INTEGER NOT NULL,
            fired_at TEXT,
            PRIMARY KEY (lesson_id, instance_start, minutes_before)
        );

        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            messenger TEXT,
            parents TEXT,
            birth_date TEXT,
            notes TEXT NOT NULL DEFAULT '',
            timezone TEXT,
            default_cost REAL,
            default_currency TEXT,
            default_link TEXT,
            default_duration INTEGER,
            color TEXT,
            photo_path TEXT,
            paid_lessons INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lesson_students (
            lesson_id TEXT NOT NULL,
            student_id TEXT NOT NULL,
            cost REAL,
            currency TEXT,
            payment_status TEXT NOT NULL DEFAULT 'unpaid',
            PRIMARY KEY (lesson_id, student_id),
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id)
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'ru');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'light');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Europe/Moscow');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('default_duration', '60');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('default_reminders', '[1440,15,0]');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('default_calendar_view', 'week');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('v3_migrated', '0');
        ",
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "ALTER TABLE lessons ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE lessons ADD COLUMN materials TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE lessons ADD COLUMN materials_link TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE fired_reminders ADD COLUMN fired_at TEXT",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE students ADD COLUMN lesson_note TEXT NOT NULL DEFAULT ''",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE students ADD COLUMN paid_lessons INTEGER NOT NULL DEFAULT 0",
        [],
    );

    migrate_reminder_snoozes(conn)?;

    migrate_v3_students(conn)?;
    migrate_v4_parent_fields(conn)?;
    ensure_indexes(conn)?;

    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_calendar_view', 'week')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_done', '0')",
        [],
    );

    // Add student settings log table for currency/cost change tracking
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS student_settings_log (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL,
            field TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_at TEXT NOT NULL,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
        )",
        [],
    );

    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_student_settings_log_student_id ON student_settings_log(student_id)",
        [],
    );

    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_student_settings_log_changed_at ON student_settings_log(changed_at)",
        [],
    );

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lesson_archive (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS archived_lessons (
            archive_id TEXT NOT NULL,
            id TEXT, student_name TEXT, subject TEXT, start_at TEXT, duration_minutes INTEGER,
            cost REAL, currency TEXT, link TEXT, notes TEXT, status TEXT, payment_status TEXT,
            recurrence_rule TEXT, recurrence_parent_id TEXT, recurrence_instance_date TEXT,
            color TEXT, created_at TEXT, updated_at TEXT, materials TEXT, materials_link TEXT
        );
        CREATE TABLE IF NOT EXISTS archived_lesson_students (
            archive_id TEXT NOT NULL,
            lesson_id TEXT, student_id TEXT, cost REAL, currency TEXT, payment_status TEXT
        );
        CREATE TABLE IF NOT EXISTS archived_reminders (
            archive_id TEXT NOT NULL,
            id TEXT, lesson_id TEXT, minutes_before INTEGER
        );",
    );

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_log (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_id TEXT,
            entity_name TEXT,
            field TEXT,
            old_value TEXT,
            new_value TEXT,
            details TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);",
    );

    migrate_activity_log(conn)?;

    // Telegram bot: linked chats (owner now; students later) and sent-message
    // dedupe keys (reminders, digests).
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS telegram_chats (
            chat_id INTEGER PRIMARY KEY,
            role TEXT NOT NULL DEFAULT 'owner',
            student_id TEXT,
            title TEXT,
            linked_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS telegram_sent (
            key TEXT PRIMARY KEY,
            sent_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS telegram_refs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_key TEXT NOT NULL,
            created_at TEXT NOT NULL
        );",
    );
    let _ = conn.execute(
        "DELETE FROM telegram_sent WHERE sent_at < datetime('now', '-14 days')",
        [],
    );
    let _ = conn.execute(
        "DELETE FROM telegram_refs WHERE created_at < datetime('now', '-30 days')",
        [],
    );

    // Indexes for common lookups.
    let _ = conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_lessons_start ON lessons(start_at);
         CREATE INDEX IF NOT EXISTS idx_lessons_parent ON lessons(recurrence_parent_id);
         CREATE INDEX IF NOT EXISTS idx_lesson_students_lesson ON lesson_students(lesson_id);
         CREATE INDEX IF NOT EXISTS idx_lesson_students_student ON lesson_students(student_id);
         CREATE INDEX IF NOT EXISTS idx_reminders_lesson ON reminders(lesson_id);",
    );

    // Retention: keep the newest 5000 journal entries.
    let _ = conn.execute(
        "DELETE FROM activity_log WHERE id IN (
            SELECT id FROM activity_log ORDER BY created_at DESC LIMIT -1 OFFSET 5000
        )",
        [],
    );

    Ok(())
}

fn migrate_activity_log(conn: &Connection) -> Result<(), String> {
    let migrated: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'activity_log_migrated'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());
    if migrated == "1" {
        return Ok(());
    }
    let _ = conn.execute(
        "INSERT INTO activity_log (id, category, action, entity_id, entity_name, field, old_value, new_value, details, created_at)
         SELECT l.id, 'student', 'settings_changed', l.student_id, s.name, l.field, l.old_value, l.new_value, NULL, l.changed_at
         FROM student_settings_log l LEFT JOIN students s ON s.id = l.student_id",
        [],
    );
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('activity_log_migrated', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_indexes(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_lessons_start_at ON lessons(start_at);
        CREATE INDEX IF NOT EXISTS idx_lessons_recurrence_parent ON lessons(recurrence_parent_id);
        CREATE INDEX IF NOT EXISTS idx_lesson_students_student ON lesson_students(student_id);
        CREATE INDEX IF NOT EXISTS idx_reminders_lesson ON reminders(lesson_id);
        CREATE INDEX IF NOT EXISTS idx_lesson_students_lesson_payment ON lesson_students(lesson_id, payment_status);
        CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
        CREATE INDEX IF NOT EXISTS idx_lessons_payment_status ON lessons(payment_status);
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn migrate_reminder_snoozes(conn: &Connection) -> Result<(), String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'reminder_snooze'",
            [],
            |r| r.get(0),
        )
        .ok();

    if let Some(raw) = raw {
        let map: std::collections::HashMap<String, String> =
            serde_json::from_str(&raw).unwrap_or_default();
        for (key, snooze_until) in map {
            let parts: Vec<&str> = key.split('|').collect();
            if parts.len() != 3 {
                continue;
            }
            let Ok(minutes_before) = parts[2].parse::<i64>() else {
                continue;
            };
            conn.execute(
                "INSERT OR IGNORE INTO reminder_snoozes (lesson_id, instance_start, minutes_before, snooze_until)
                 VALUES (?1, ?2, ?3, ?4)",
                params![parts[0], parts[1], minutes_before, snooze_until],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute("DELETE FROM settings WHERE key = 'reminder_snooze'", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[allow(clippy::type_complexity)]
fn migrate_v3_students(conn: &Connection) -> Result<(), String> {
    let migrated: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'v3_migrated'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());

    if migrated == "1" {
        return Ok(());
    }

    let mut stmt = conn
        .prepare("SELECT DISTINCT student_name FROM lessons WHERE student_name != ''")
        .map_err(|e| e.to_string())?;

    let names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let now = Utc::now().to_rfc3339();
    for (i, name) in names.iter().enumerate() {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM students WHERE name = ?1",
                params![name],
                |r| r.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if exists {
            continue;
        }

        let id = Uuid::new_v4().to_string();
        let color = STUDENT_COLORS[i % STUDENT_COLORS.len()];
        conn.execute(
            "INSERT INTO students (id, name, notes, color, archived, created_at, updated_at)
             VALUES (?1, ?2, '', ?3, 0, ?4, ?4)",
            params![id, name, color, now],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut lesson_stmt = conn
        .prepare("SELECT id, student_name, cost, currency, payment_status FROM lessons")
        .map_err(|e| e.to_string())?;

    let lessons: Vec<(String, String, Option<f64>, Option<String>, String)> = lesson_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (lesson_id, student_name, cost, currency, payment_status) in lessons {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lesson_students WHERE lesson_id = ?1",
                params![lesson_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if count > 0 {
            continue;
        }

        if let Ok(student_id) = conn.query_row(
            "SELECT id FROM students WHERE name = ?1 LIMIT 1",
            params![student_name],
            |r| r.get::<_, String>(0),
        ) {
            conn.execute(
                "INSERT OR IGNORE INTO lesson_students (lesson_id, student_id, cost, currency, payment_status)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![lesson_id, student_id, cost, currency, payment_status],
            )
            .map_err(|e| e.to_string())?;

            if let Ok(Some(c)) = conn.query_row(
                "SELECT color FROM students WHERE id = ?1",
                params![student_id],
                |r| r.get::<_, Option<String>>(0),
            ) {
                let _ = conn.execute(
                    "UPDATE lessons SET color = ?2 WHERE id = ?1 AND (color IS NULL OR color = '')",
                    params![lesson_id, c],
                );
            }
        }
    }

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('v3_migrated', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn parse_legacy_parents(raw: &str) -> (Option<String>, Option<String>, Option<String>) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (None, None, None);
    }

    let mut messenger: Option<String> = None;
    let mut phone: Option<String> = None;
    let mut name = trimmed.to_string();

    if let Some(at) = trimmed.find('@') {
        let handle: String = trimmed[at..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '@' || *c == '_' || *c == '.')
            .collect();
        if handle.len() > 1 {
            messenger = Some(handle.clone());
            name = name.replace(&handle, "");
        }
    }

    for token in trimmed.split_whitespace() {
        let digits: String = token.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 7 {
            let normalized = if token.starts_with('+') {
                format!("+{}", digits)
            } else {
                digits
            };
            phone = Some(normalized);
            name = name.replace(token, "");
        }
    }

    if messenger.is_none() {
        let lower = trimmed.to_lowercase();
        for prefix in ["t.me/", "telegram:", "wa.me/", "viber:"] {
            if let Some(idx) = lower.find(prefix) {
                let slice = &trimmed[idx..];
                let handle = slice.split_whitespace().next().unwrap_or("").to_string();
                if !handle.is_empty() {
                    messenger = Some(handle.clone());
                    name = name.replace(&handle, "");
                }
                break;
            }
        }
    }

    let name = name
        .replace(['(', ')', ',', ';', '-'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    (
        if name.is_empty() { None } else { Some(name) },
        phone,
        messenger,
    )
}

fn migrate_v4_parent_fields(conn: &Connection) -> Result<(), String> {
    let _ = conn.execute("ALTER TABLE students ADD COLUMN parent_name TEXT", []);
    let _ = conn.execute("ALTER TABLE students ADD COLUMN parent_phone TEXT", []);
    let _ = conn.execute("ALTER TABLE students ADD COLUMN parent_messenger TEXT", []);

    let migrated: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'v4_parent_fields_migrated'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());

    if migrated == "1" {
        return Ok(());
    }

    let mut stmt = conn
        .prepare("SELECT id, parents, parent_name FROM students WHERE parents IS NOT NULL AND parents != ''")
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (id, parents, existing_name) in rows {
        if existing_name.is_some() {
            continue;
        }
        let (name, phone, messenger) = parse_legacy_parents(&parents);
        conn.execute(
            "UPDATE students SET parent_name = ?2, parent_phone = ?3, parent_messenger = ?4 WHERE id = ?1",
            params![id, name, phone, messenger],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('v4_parent_fields_migrated', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
