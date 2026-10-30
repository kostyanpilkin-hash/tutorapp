//! Update handling: reply keyboard, commands, settings toggles, action callbacks.

use super::api::{Bot, CallbackQuery, Message, Update, esc};
use super::texts::T;
use super::{
    day_occurrences, is_running, lang, open_db, owner_chat, parse_callback,
    set_setting, setting,
};
use crate::occurrences::{self, Occ};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

// ---------- reply keyboard ----------

pub fn reply_keyboard(t: &T) -> Value {
    json!({
        "keyboard": [
            [{ "text": t.today() }, { "text": t.tomorrow() }, { "text": t.week() }],
            [{ "text": t.morning_digest() }, { "text": t.evening_digest() }],
            [{ "text": t.debts() }, { "text": t.settings() }],
        ],
        "resize_keyboard": true,
        "is_persistent": true,
    })
}

// ---------- settings ----------

pub fn offsets(conn: &Connection) -> Vec<i64> {
    setting(conn, "tg_offsets")
        .map(|v| v.split(',').filter_map(|s| s.parse().ok()).collect())
        .unwrap_or_else(|| vec![60])
}

pub fn field_flags(conn: &Connection) -> Vec<String> {
    setting(conn, "tg_fields")
        .map(|v| v.split(',').map(|s| s.to_string()).collect())
        .unwrap_or_else(|| vec!["student".into(), "time".into(), "link".into(), "subject".into()])
}

const OFFSET_CHOICES: [i64; 5] = [15, 30, 60, 120, 1440];
const FIELD_CHOICES: [&str; 8] = ["student", "time", "link", "subject", "duration", "notes", "payment", "cost"];

fn field_label(t: &T, f: &str) -> &'static str {
    match f {
        "student" => t.field_student(),
        "time" => t.field_time(),
        "link" => t.field_link(),
        "subject" => t.field_subject(),
        "duration" => t.field_duration(),
        "notes" => t.field_notes(),
        "payment" => t.field_payment(),
        _ => t.field_cost(),
    }
}

fn offset_label(min: i64) -> String {
    match min {
        1440 => "1 д / 1d".into(),
        m if m >= 60 => format!("{} ч / {}h", m / 60, m / 60),
        m => format!("{m} мин / {m}m"),
    }
}

pub fn settings_markup(t: &T, offsets: &[i64], fields: &[String]) -> Value {
    let mut rows: Vec<Value> = Vec::new();
    rows.push(json!([{ "text": t.notify_offsets(), "callback_data": "noop" }]));
    let mut row = Vec::new();
    for m in OFFSET_CHOICES {
        let on = offsets.contains(&m);
        row.push(json!({ "text": format!("{}{}", if on { "✔ " } else { "" }, offset_label(m)), "callback_data": format!(r#"{{"a":"o","v":{m}}}"#) }));
    }
    rows.push(json!(row));
    rows.push(json!([{ "text": t.msg_fields(), "callback_data": "noop" }]));
    for chunk in FIELD_CHOICES.chunks(4) {
        let mut row = Vec::new();
        for f in chunk {
            let on = fields.iter().any(|x| x == f);
            row.push(json!({ "text": format!("{}{}", if on { "✔ " } else { "" }, field_label(t, f)), "callback_data": format!(r#"{{"a":"f","v":"{f}"}}"#) }));
        }
        rows.push(json!(row));
    }
    rows.push(json!([{ "text": t.back(), "callback_data": r#"{"a":"m"}"# }]));
    json!({ "inline_keyboard": rows })
}

/// Stores a short numeric handle for a lesson occurrence so callback_data
/// stays under Telegram's 64-byte limit.
fn create_ref(conn: &Connection, occ_id: &str) -> i64 {
    if let Ok(r) = conn.query_row(
        "SELECT id FROM telegram_refs WHERE lesson_key = ?1 LIMIT 1",
        params![occ_id],
        |r| r.get::<_, i64>(0),
    ) {
        return r;
    }
    let _ = conn.execute(
        "INSERT INTO telegram_refs (lesson_key, created_at) VALUES (?1, ?2)",
        params![occ_id, Utc::now().to_rfc3339()],
    );
    conn.last_insert_rowid()
}

fn resolve_ref(conn: &Connection, ref_id: i64) -> Option<String> {
    conn.query_row("SELECT lesson_key FROM telegram_refs WHERE id = ?1", params![ref_id], |r| r.get(0)).ok()
}

pub fn actions_markup(t: &T, conn: &Connection, occ_id: &str) -> Value {
    let r = create_ref(conn, occ_id);
    let cb = |a: &str| format!(r#"{{"a":"{a}","r":{r}}}"#);
    json!({ "inline_keyboard": [
        [{ "text": t.done(), "callback_data": cb("c") },
         { "text": t.no_show(), "callback_data": cb("n") }],
        [{ "text": t.paid(), "callback_data": cb("p") },
         { "text": t.cancel(), "callback_data": cb("x") }],
    ]})
}

/// Per-lesson action rows for day lists: each scheduled lesson gets
/// `✅HH:MM` `❌` `💰` `🚫` matching the lesson order top-to-bottom.
pub fn day_actions_markup(_t: &T, conn: &Connection, occs: &[Occ], tz: chrono_tz::Tz) -> Option<Value> {
    let mut rows: Vec<Value> = Vec::new();
    for o in occs.iter().filter(|o| o.status == "scheduled").take(8) {
        let r = create_ref(conn, &o.id);
        let cb = |a: &str| format!(r#"{{"a":"{a}","r":{r}}}"#);
        let hhmm = o.start_utc.with_timezone(&tz).format("%H:%M");
        rows.push(json!([
            { "text": format!("{hhmm} ✅"), "callback_data": cb("c") },
            { "text": "❌", "callback_data": cb("n") },
            { "text": "💰", "callback_data": cb("p") },
            { "text": "🚫", "callback_data": cb("x") },
        ]));
    }
    if rows.is_empty() {
        None
    } else {
        Some(json!({ "inline_keyboard": rows }))
    }
}

// ---------- formatting ----------

fn status_icon(status: &str, _pay: &str) -> &'static str {
    match status {
        "completed" => "✅",
        "no_show" => "❌",
        "cancelled" => "🚫",
        _ => "🕓",
    }
}

/// Two-line lesson entry: icon + bold time + name, then indented details.
pub fn fmt_lesson_line(t: &T, o: &Occ, tz: chrono_tz::Tz, fields: &[String]) -> String {
    let s = o.start_utc.with_timezone(&tz);
    let e = s + Duration::minutes(o.duration_minutes);
    let mut line = format!(
        "{} <b>{}–{}</b> · {}",
        status_icon(&o.status, &o.payment_status),
        s.format("%H:%M"),
        e.format("%H:%M"),
        esc(&o.name),
    );
    if o.status == "completed" && o.payment_status == "paid" {
        line.push_str(&format!(" · {}", t.paid_label()));
    }
    let mut details: Vec<String> = Vec::new();
    if fields.iter().any(|f| f == "subject") && !o.subject.is_empty() {
        details.push(esc(&o.subject));
    }
    if fields.iter().any(|f| f == "duration") {
        details.push(format!("{} мин", o.duration_minutes));
    }
    if fields.iter().any(|f| f == "cost") && o.cost > 0.0 {
        details.push(format!("{} {}", o.cost, esc(&o.currency)));
    }
    if fields.iter().any(|f| f == "link") {
        if let Some(l) = &o.link {
            details.push(format!("<a href=\"{}\">🔗</a>", esc(l)));
        }
    }
    if !details.is_empty() {
        line.push_str(&format!("\n    {}", details.join(" · ")));
    }
    line
}

fn day_stats(t: &T, occs: &[Occ]) -> String {
    let done = occs.iter().filter(|o| o.status == "completed").count();
    let left = occs.iter().filter(|o| o.status == "scheduled").count();
    let noshow = occs.iter().filter(|o| o.status == "no_show").count();
    let cancelled = occs.iter().filter(|o| o.status == "cancelled").count();
    let mut parts = vec![format!("{} · {}", t.stats_lessons(occs.len()), t.stats_done(done))];
    if left > 0 { parts.push(t.stats_left(left)); }
    if noshow > 0 { parts.push(format!("{} ❌", noshow)); }
    if cancelled > 0 { parts.push(format!("{} 🚫", cancelled)); }
    parts.join(" · ")
}

pub fn day_message(t: &T, date: NaiveDate, occs: &[Occ], tz: chrono_tz::Tz, fields: &[String], title: &str) -> String {
    if occs.is_empty() {
        return format!("<b>{} · {} {}</b>\n{}", title, weekday_name(t, date), date.format("%d.%m"), t.no_lessons());
    }
    let mut s = format!(
        "<b>{} · {} {}</b>\n<blockquote>{}</blockquote>\n",
        title,
        weekday_name(t, date),
        date.format("%d.%m"),
        day_stats(t, occs),
    );
    for o in occs {
        s.push_str(&fmt_lesson_line(t, o, tz, fields));
        s.push_str("\n\n");
    }
    s.trim_end().to_string()
}

fn weekday_name(t: &T, d: NaiveDate) -> &'static str {
    let (ru, en, be) = match d.weekday() {
        chrono::Weekday::Mon => ("Пн", "Mon", "Пн"),
        chrono::Weekday::Tue => ("Вт", "Tue", "Аў"),
        chrono::Weekday::Wed => ("Ср", "Wed", "Ср"),
        chrono::Weekday::Thu => ("Чт", "Thu", "Чц"),
        chrono::Weekday::Fri => ("Пт", "Fri", "Пт"),
        chrono::Weekday::Sat => ("Сб", "Sat", "Сб"),
        chrono::Weekday::Sun => ("Вс", "Sun", "Нд"),
    };
    match t { T(super::texts::L::Ru) => ru, T(super::texts::L::En) => en, T(super::texts::L::Be) => be }
}

pub fn week_message(t: &T, start: NaiveDate, occs: &[Occ], tz: chrono_tz::Tz, fields: &[String]) -> String {
    let mut s = String::from("<b>🗓 ");
    s.push_str(t.week());
    s.push_str("</b>\n<blockquote>");
    s.push_str(&day_stats(t, occs));
    s.push_str("</blockquote>\n");
    for i in 0..7 {
        let d = start + Duration::days(i);
        let day: Vec<&Occ> = occs.iter().filter(|o| o.start_utc.with_timezone(&tz).date_naive() == d).collect();
        if day.is_empty() { continue; }
        s.push_str(&format!("\n<b>▸ {} {}</b>\n\n", weekday_name(t, d), d.format("%d.%m")));
        for o in day {
            s.push_str(&fmt_lesson_line(t, o, tz, fields));
            s.push_str("\n\n");
        }
    }
    s.trim_end().to_string()
}

// ---------- poll loop ----------

pub async fn poll_loop(bot: Bot, run_id: u64) {
    let mut offset: i64 = open_db()
        .ok()
        .and_then(|c| setting(&c, "tg_offset").and_then(|v| v.parse().ok()))
        .unwrap_or(0);
    loop {
        if !is_running(run_id) { return; }
        match bot.get_updates(offset, 25).await {
            Ok(updates) => {
                for u in updates {
                    offset = u.update_id + 1;
                    if let Err(e) = handle_update(&bot, u).await {
                        eprintln!("tg update error: {e}");
                    }
                }
                if let Ok(conn) = open_db() {
                    let _ = set_setting(&conn, "tg_offset", &offset.to_string());
                }
            }
            Err(e) => {
                eprintln!("tg poll error: {e}");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn handle_update(bot: &Bot, u: Update) -> Result<(), String> {
    if let Some(m) = u.message {
        handle_message(bot, m).await
    } else if let Some(cb) = u.callback_query {
        handle_callback(bot, cb).await
    } else {
        Ok(())
    }
}

async fn handle_message(bot: &Bot, m: Message) -> Result<(), String> {
    let conn = open_db()?;
    let t = lang(&conn);
    let text = m.text.clone().unwrap_or_default();
    let chat_id = m.chat.id;

    // Pairing: owner not yet linked and message is the pairing code.
    if owner_chat(&conn).is_none() {
        let code = setting(&conn, "tg_pair_code");
        let exp = setting(&conn, "tg_pair_exp")
            .and_then(|v| v.parse::<chrono::DateTime<Utc>>().ok());
        let valid = code.as_deref() == Some(text.trim())
            && exp.map(|e| e > Utc::now()).unwrap_or(false);
        if valid {
            conn.execute(
                "INSERT OR REPLACE INTO telegram_chats (chat_id, role, student_id, title, linked_at) VALUES (?1, 'owner', NULL, ?2, ?3)",
                params![chat_id, m.from.and_then(|u| u.username).unwrap_or_default(), Utc::now().to_rfc3339()],
            ).map_err(|e| e.to_string())?;
            let _ = conn.execute("DELETE FROM settings WHERE key IN ('tg_pair_code','tg_pair_exp')", []);
            bot.send(chat_id, t.code_ok(), Some(reply_keyboard(&t)), false).await?;
        } else {
            bot.send(chat_id, if text.trim() == "/start" { t.welcome() } else { t.code_bad() }, None, false).await?;
        }
        return Ok(());
    }

    let Some(owner) = owner_chat(&conn) else { return Ok(()) };
    if chat_id != owner {
        return Ok(()); // ignore strangers
    }

    let fields = field_flags(&conn);
    let tz = occurrences::timezone(&conn);
    let today = Utc::now().with_timezone(&tz).date_naive();
    let body = text.trim();
    let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();

    let kind = if normalized == "/start" || normalized == t.today().to_lowercase() || normalized == "/today" {
        "today"
    } else if normalized == t.tomorrow().to_lowercase() || normalized == "/tomorrow" {
        "tomorrow"
    } else if normalized == t.week().to_lowercase() || normalized == "/week" {
        "week"
    } else if normalized == t.morning_digest().to_lowercase() || normalized == "/morning" {
        "morning"
    } else if normalized == t.evening_digest().to_lowercase() || normalized == "/evening" {
        "evening"
    } else if normalized == t.debts().to_lowercase() || normalized == "/debts" {
        "debts"
    } else if normalized == t.settings().to_lowercase() || normalized == "/settings" {
        "settings"
    } else {
        "unknown"
    };

    match kind {
        "today" => {
            let occs = day_occurrences(&conn, today)?;
            let mut markup = reply_keyboard(&t);
            if let Some(inline) = day_actions_markup(&t, &conn, &occs, tz) {
                markup = inline;
            }
            bot.send(chat_id, &day_message(&t, today, &occs, tz, &fields, t.today()), Some(markup), true).await?;
        }
        "tomorrow" => {
            let d = today + Duration::days(1);
            let occs = day_occurrences(&conn, d)?;
            let markup = day_actions_markup(&t, &conn, &occs, tz).unwrap_or(Value::Null);
            bot.send(chat_id, &day_message(&t, d, &occs, tz, &fields, t.tomorrow()), if markup.is_null() { None } else { Some(markup) }, true).await?;
        }
        "week" => {
            // Same range as the app's week view: Monday–Sunday.
            let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
            let occs = occurrences::collect(&conn, tz, monday, monday + Duration::days(6))?;
            bot.send(chat_id, &week_message(&t, monday, &occs, tz, &fields), None, true).await?;
        }
        "morning" => {
            let occs = day_occurrences(&conn, today)?;
            let msg = if occs.is_empty() { t.free_day().to_string() } else { day_message(&t, today, &occs, tz, &fields, t.morning_digest()) };
            bot.send(chat_id, &msg, day_actions_markup(&t, &conn, &occs, tz), true).await?;
        }
        "evening" => {
            let occs = day_occurrences(&conn, today)?;
            bot.send(chat_id, &evening_summary(&t, &occs, tz, &fields), None, true).await?;
        }
        "debts" => {
            bot.send(chat_id, &debts_message(&t, &conn)?, None, true).await?;
        }
        "settings" => {
            let offs = offsets(&conn);
            bot.send(chat_id, t.settings(), Some(settings_markup(&t, &offs, &fields)), true).await?;
        }
        _ => {
            if normalized.starts_with('/') {
                bot.send(chat_id, t.not_linked(), Some(reply_keyboard(&t)), true).await?;
            } else {
                bot.send(chat_id, t.not_linked(), Some(reply_keyboard(&t)), true).await?;
            }
        }
    }
    Ok(())
}

fn evening_summary(t: &T, occs: &[Occ], _tz: chrono_tz::Tz, fields: &[String]) -> String {
    let done = occs.iter().filter(|o| o.status == "completed").count();
    let noshow = occs.iter().filter(|o| o.status == "no_show").count();
    let cancelled = occs.iter().filter(|o| o.status == "cancelled").count();
    let unpaid: Vec<&Occ> = occs.iter().filter(|o| (o.status == "completed" || o.status == "no_show") && o.payment_status == "unpaid" && o.cost > 0.0).collect();
    let mut s = format!(
        "<b>{}</b>\n<blockquote>✅ {} · ❌ {} · 🚫 {}</blockquote>\n",
        t.evening_digest(), done, noshow, cancelled,
    );
    if !unpaid.is_empty() {
        s.push_str(&format!("\n<b>{}</b>\n", t.unpaid_label()));
        for o in unpaid {
            s.push_str(&format!("• {}{}\n", esc(&o.name), if fields.iter().any(|f| f == "cost") && o.cost > 0.0 { format!(" — {} {}", o.cost, esc(&o.currency)) } else { String::new() }));
        }
    }
    s
}

fn debts_message(t: &T, conn: &Connection) -> Result<String, String> {
    // Same logic as Finance → debts: completed or no-show, effective payment
    // status not 'paid', effective cost > 0; grouped per student and currency.
    let mut stmt = conn
        .prepare(
            "SELECT s.name, COUNT(*), SUM(COALESCE(ls.cost, l.cost)) AS total,
                    COALESCE(NULLIF(ls.currency,''), NULLIF(l.currency,''), 'USD') AS cur
             FROM lessons l
             INNER JOIN lesson_students ls ON ls.lesson_id = l.id
             INNER JOIN students s ON s.id = ls.student_id
             WHERE l.status IN ('completed','no_show')
               AND COALESCE(NULLIF(ls.payment_status,''), l.payment_status) != 'paid'
               AND COALESCE(ls.cost, l.cost) > 0
             GROUP BY s.name, cur ORDER BY s.name",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64, f64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if rows.is_empty() {
        return Ok(t.no_debts().to_string());
    }
    let mut s = format!("<b>{}</b>\n", t.debts());
    for (name, n, sum, cur) in rows {
        s.push_str(&format!("💸 <b>{}</b>\n    {} × · {} {}\n", esc(&name), n, sum, esc(&cur)));
    }
    Ok(s)
}

// ---------- callbacks ----------

async fn handle_callback(bot: &Bot, cb: CallbackQuery) -> Result<(), String> {
    let conn = open_db()?;
    let t = lang(&conn);
    let chat_id = cb.message.as_ref().map(|m| m.chat.id).unwrap_or(0);
    let msg_id = cb.message.as_ref().map(|m| m.message_id).unwrap_or(0);
    if Some(chat_id) != owner_chat(&conn) {
        return bot.answer_callback(&cb.id, Some(t.no_access())).await.map(|_| ());
    }
    let data = cb.data.clone().unwrap_or_default();
    if data == "noop" {
        return bot.answer_callback(&cb.id, None).await.map(|_| ());
    }
    let Some(d) = parse_callback(&data) else {
        return bot.answer_callback(&cb.id, None).await.map(|_| ());
    };

    match d.a.as_str() {
        "o" => {
            let v: i64 = d.v.as_deref().unwrap_or("0").parse().unwrap_or(0);
            let mut list = offsets(&conn);
            if list.contains(&v) { list.retain(|x| *x != v) } else { list.push(v); list.sort_unstable(); }
            if list.is_empty() { list.push(60); }
            set_setting(&conn, "tg_offsets", &list.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","))?;
            bot.answer_callback(&cb.id, None).await?;
            let fields = field_flags(&conn);
            bot.edit_markup(chat_id, msg_id, Some(settings_markup(&t, &offsets(&conn), &fields))).await?;
        }
        "f" => {
            let v = d.v.clone().unwrap_or_default();
            let mut list = field_flags(&conn);
            if list.iter().any(|x| *x == v) { list.retain(|x| *x != v) } else { list.push(v); }
            if list.is_empty() { list.push("student".into()); }
            set_setting(&conn, "tg_fields", &list.join(","))?;
            bot.answer_callback(&cb.id, None).await?;
            bot.edit_markup(chat_id, msg_id, Some(settings_markup(&t, &offsets(&conn), &field_flags(&conn)))).await?;
        }
        "m" => {
            bot.answer_callback(&cb.id, None).await?;
            bot.send(chat_id, t.settings(), None, true).await?;
        }
        "x" => {
            // Cancel confirmation prompt.
            bot.answer_callback(&cb.id, None).await?;
            let r = d.r.unwrap_or_default();
            let markup = json!({ "inline_keyboard": [[
                { "text": t.yes(), "callback_data": format!(r#"{{"a":"X","r":{r}}}"#) },
                { "text": t.back(), "callback_data": format!(r#"{{"a":"b","r":{r}}}"#) },
            ]]});
            bot.edit_text(chat_id, msg_id, t.confirm_cancel(), Some(markup)).await?;
        }
        "b" => {
            bot.answer_callback(&cb.id, None).await?;
            if let Some(occ_id) = resolve_ref(&conn, d.r.unwrap_or_default()) {
                bot.edit_markup(chat_id, msg_id, Some(actions_markup(&t, &conn, &occ_id))).await?;
            }
        }
        "X" | "c" | "n" | "p" => {
            let action = match d.a.as_str() {
                "c" => "completed",
                "n" => "no_show",
                "p" => "paid",
                _ => "cancelled",
            };
            let applied = match resolve_ref(&conn, d.r.unwrap_or_default()) {
                Some(occ) => apply_action(&conn, &occ, action)?,
                None => None,
            };
            match applied {
                Some((_, name)) => {
                    let toast = match action {
                        "completed" => t.done_marked(),
                        "no_show" => t.no_show_marked(),
                        "paid" => t.paid_marked(),
                        _ => t.cancelled_marked(),
                    };
                    bot.answer_callback(&cb.id, Some(toast)).await?;
                    let prev = cb.message.and_then(|m| m.text).unwrap_or_default();
                    bot.edit_text(chat_id, msg_id, &format!("{}\n\n{} — {}", prev, name, toast), None).await.ok();
                }
                None => {
                    bot.answer_callback(&cb.id, Some("?")).await?;
                }
            }
        }
        _ => {
            bot.answer_callback(&cb.id, None).await?;
        }
    }
    Ok(())
}

/// Applies a button action to a lesson (materializing series instances).
/// Returns (row id, student name) on success.
fn apply_action(conn: &Connection, occ_id: &str, action: &str) -> Result<Option<(String, String)>, String> {
    let tz = occurrences::timezone(conn);
    let row_id = occurrences::materialize(conn, occ_id, tz)?;
    let meta: Option<(String, String)> = conn
        .query_row("SELECT student_name, payment_status FROM lessons WHERE id = ?1", params![row_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok();
    let Some((name, old_pay)) = meta else { return Ok(None) };
    let now = Utc::now().to_rfc3339();
    match action {
        "completed" | "no_show" | "cancelled" => {
            conn.execute(
                "UPDATE lessons SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![row_id, action, now],
            ).map_err(|e| e.to_string())?;
            crate::commands::lessons::log_activity(
                conn, "lesson", "status_changed", Some(&row_id), Some(&name),
                Some("status"), Some("scheduled"), Some(action), Some("telegram"),
            );
        }
        "paid" => {
            conn.execute(
                "UPDATE lessons SET payment_status = 'paid', updated_at = ?2 WHERE id = ?1",
                params![row_id, now],
            ).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE lesson_students SET payment_status = 'paid' WHERE lesson_id = ?1",
                params![row_id],
            ).map_err(|e| e.to_string())?;
            crate::commands::lessons::log_activity(
                conn, "lesson", "payment_changed", Some(&row_id), Some(&name),
                Some("payment_status"), Some(&old_pay), Some("paid"), Some("telegram"),
            );
        }
        _ => return Ok(None),
    }
    Ok(Some((row_id, name)))
}

pub fn reminder_text(t: &T, o: &Occ, tz: chrono_tz::Tz, fields: &[String], minutes_before: i64) -> String {
    let mut s = format!("<b>🔔 {} — {}</b>\n", t.lesson_soon(), t.remind_in(minutes_before / 60, minutes_before % 60));
    s.push_str(&fmt_lesson_line(t, o, tz, fields));
    if fields.iter().any(|f| f == "link") {
        if let Some(l) = &o.link {
            s.push_str(&format!("\n🔗 <a href=\"{}\">{}</a>", esc(l), t.link_text()));
        }
    }
    if fields.iter().any(|f| f == "notes") {
        if let Some(n) = &o.notes {
            if !n.is_empty() {
                s.push_str(&format!("\n📝 {}", esc(n)));
            }
        }
    }
    s
}
