//! Scheduled Telegram jobs: lesson reminders (+ catch-up) and the morning digest.

use super::api::Bot;
use super::handlers::{actions_markup, day_message, field_flags, offsets, reply_keyboard, reminder_text};
use super::{is_running, lang, open_db, owner_chat, quiet_now, sent_mark, setting};
use crate::occurrences;
use chrono::{Duration, Timelike, Utc};

pub async fn jobs_loop(bot: Bot, run_id: u64) {
    // Small initial delay so the app finishes startup.
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    loop {
        if !is_running(run_id) { return; }
        if let Err(e) = tick(&bot).await {
            eprintln!("tg jobs error: {e}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
    }
}

async fn tick(bot: &Bot) -> Result<(), String> {
    let conn = open_db()?;
    let Some(chat) = owner_chat(&conn) else { return Ok(()) };
    let t = lang(&conn);
    let tz = occurrences::timezone(&conn);
    let fields = field_flags(&conn);
    let offs = offsets(&conn);

    // ---------- reminders ----------
    let now = Utc::now();
    let from = now.with_timezone(&tz).date_naive();
    let to = from + Duration::days(2);
    let occs = occurrences::collect(&conn, tz, from, to)?;
    for o in &occs {
        if o.status != "scheduled" { continue; }
        for m in &offs {
            let remind_at = o.start_utc - Duration::minutes(*m);
            if now < remind_at { continue; }
            // Send at the due moment, or catch up if the app was off and the
            // lesson is still >5 minutes away.
            if o.start_utc - now < Duration::minutes(5) { continue; }
            let key = format!("rem:{}:{}:{}", o.id, o.start, m);
            if !sent_mark(&conn, &key)? { continue; }
            let markup = Some(actions_markup(&t, &conn, &o.id));
            let text = reminder_text(&t, o, tz, &fields, *m);
            let _ = bot.send(chat, &text, markup, false).await;
        }
    }

    // ---------- morning digest (tg_digest_time "HH:MM", "" = off; quiet hours apply) ----------
    let local = now.with_timezone(&tz);
    let digest_cfg = setting(&conn, "tg_digest_time").unwrap_or_else(|| "09:00".into());
    let digest_start = digest_cfg
        .split_once(':')
        .and_then(|(h, m)| h.parse::<i64>().ok().zip(m.parse::<i64>().ok()))
        .map(|(h, m)| h * 60 + m);
    if let Some(start) = digest_start {
        // Minutes elapsed since the configured time — a 30-min window that
        // also wraps correctly across midnight.
        let elapsed = ((local.hour() as i64 * 60 + local.minute() as i64) - start).rem_euclid(1440);
        if elapsed < 30 && !quiet_now(&conn, tz) {
            let key = format!("digest:{}:{}", local.date_naive().format("%Y%m%d"), digest_cfg);
            if sent_mark(&conn, &key)? {
                let today = local.date_naive();
                let occs = occurrences::collect(&conn, tz, today, today)?;
                let msg = if occs.is_empty() {
                    t.free_day().to_string()
                } else {
                    day_message(&t, today, &occs, tz, &fields, t.morning_digest())
                };
                let _ = bot.send(chat, &msg, Some(reply_keyboard(&t)), true).await;
            }
        }
    }
    Ok(())
}
