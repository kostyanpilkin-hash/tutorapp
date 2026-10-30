pub mod api;
mod handlers;
mod jobs;
pub mod texts;

use crate::db::{self, AppState};
use crate::occurrences;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use chrono::Timelike;

/// Bumping this id stops all running bot loops (polling + jobs).
static RUN: AtomicU64 = AtomicU64::new(0);

pub fn open_db() -> Result<Connection, String> {
    Connection::open(db::db_path()).map_err(|e| e.to_string())
}

pub fn setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)).ok()
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", params![key, value])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn bot_and_chat(conn: &Connection) -> Option<(api::Bot, i64)> {
    let token = setting(conn, "tg_token")?;
    let chat: i64 = conn
        .query_row("SELECT chat_id FROM telegram_chats WHERE role = 'owner' LIMIT 1", [], |r| r.get(0))
        .ok()?;
    Some((api::Bot::new(&token), chat))
}

pub fn lang(conn: &Connection) -> texts::T {
    texts::T(texts::lang(&setting(conn, "language").unwrap_or_else(|| "ru".into())))
}

fn quiet_now(tz: chrono_tz::Tz) -> bool {
    let h = Utc::now().with_timezone(&tz).time().hour();
    h >= 23 || h < 7
}

// ---------- Tauri commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStatus {
    token_set: bool,
    linked: bool,
    chat_id: Option<i64>,
    pairing_code: Option<String>,
}

#[tauri::command]
pub fn tg_status(state: tauri::State<AppState>) -> Result<TgStatus, String> {
    state.pool.with_conn(|conn| {
        let linked: Option<i64> = conn
            .query_row("SELECT chat_id FROM telegram_chats WHERE role = 'owner' LIMIT 1", [], |r| r.get(0))
            .ok();
        Ok(TgStatus {
            token_set: setting(conn, "tg_token").is_some(),
            linked: linked.is_some(),
            chat_id: linked,
            pairing_code: None,
        })
    })
}

/// Saves the bot token, validates it against Telegram, (re)starts the bot and
/// returns a pairing code for /start.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgConnectResult {
    username: String,
    code: String,
}

#[tauri::command]
pub async fn tg_connect(state: tauri::State<'_, AppState>, token: String) -> Result<TgConnectResult, String> {
    let token = token.trim().to_string();
    if token.len() < 20 {
        return Err("invalid token".into());
    }
    let bot = api::Bot::new(&token);
    let me = bot.get_me().await.map_err(|e| format!("Telegram: {e}"))?;
    let username = me.username.unwrap_or_default();
    let code = format!("{:06}", (rand_code() % 900000) + 100000);
    state.pool.with_conn(|conn| {
        set_setting(conn, "tg_token", &token)?;
        set_setting(conn, "tg_bot_username", &username)?;
        // Fresh pairing code valid 10 minutes.
        set_setting(conn, "tg_pair_code", &code)?;
        let exp = (Utc::now() + chrono::Duration::minutes(10)).to_rfc3339();
        set_setting(conn, "tg_pair_exp", &exp)
    })?;
    start_bot().await;
    Ok(TgConnectResult { username, code })
}

fn rand_code() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    (nanos ^ (nanos >> 64)) as u64
}

#[tauri::command]
pub async fn tg_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    RUN.fetch_add(1, Ordering::SeqCst);
    state.pool.with_conn(|conn| {
        conn.execute("DELETE FROM settings WHERE key IN ('tg_token', 'tg_bot_username', 'tg_pair_code', 'tg_pair_exp')", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM telegram_chats", []).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn tg_test() -> Result<(), String> {
    let conn = open_db()?;
    let (bot, chat) = bot_and_chat(&conn).ok_or("not linked")?;
    let t = lang(&conn);
    bot.send(chat, t.test_ok(), Some(handlers::reply_keyboard(&t)), true)
        .await
        .map(|_| ())
}

/// Current bot settings exposed to the UI (read-only; edited in the bot itself).
#[tauri::command]
pub fn tg_preferences(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    state.pool.with_conn(|conn| {
        Ok(serde_json::json!({
            "offsets": handlers::offsets(conn),
            "fields": handlers::field_flags(conn),
        }))
    })
}

/// Starts the bot (called on app start and after tg_connect).
pub async fn start_bot() {
    let run_id = RUN.fetch_add(1, Ordering::SeqCst) + 1;
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    if bot_and_chat(&conn).is_none() { return }
    let token = setting(&conn, "tg_token").unwrap();
    let bot = api::Bot::new(&token);
    let t = lang(&conn);
    let _ = bot
        .set_commands(&[
            ("today", t.today()),
            ("tomorrow", t.tomorrow()),
            ("week", t.week()),
            ("morning", t.morning_digest()),
            ("evening", t.evening_digest()),
            ("debts", t.debts()),
            ("settings", t.settings()),
        ])
        .await;

    let bot_poll = bot.clone();
    tauri::async_runtime::spawn(async move {
        handlers::poll_loop(bot_poll, run_id).await;
    });
    let bot_jobs = bot.clone();
    tauri::async_runtime::spawn(async move {
        jobs::jobs_loop(bot_jobs, run_id).await;
    });
}

pub fn is_running(run_id: u64) -> bool {
    RUN.load(Ordering::SeqCst) == run_id
}

// ---------- shared helpers for handlers/jobs ----------

pub fn owner_chat(conn: &Connection) -> Option<i64> {
    conn.query_row("SELECT chat_id FROM telegram_chats WHERE role = 'owner' LIMIT 1", [], |r| r.get(0)).ok()
}

pub fn sent_mark(conn: &Connection, key: &str) -> Result<bool, String> {
    let n = conn
        .execute(
            "INSERT OR IGNORE INTO telegram_sent (key, sent_at) VALUES (?1, ?2)",
            params![key, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn day_occurrences(conn: &Connection, date: chrono::NaiveDate) -> Result<Vec<occurrences::Occ>, String> {
    let tz = occurrences::timezone(conn);
    occurrences::collect(conn, tz, date, date)
}

#[derive(Deserialize)]
pub struct CallbackData {
    pub a: String,
    pub r: Option<i64>,
    pub v: Option<String>,
}

pub fn parse_callback(data: &str) -> Option<CallbackData> {
    serde_json::from_str(data).ok()
}
