//! Minimal Telegram Bot API client (only what the bot needs).

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone)]
pub struct Bot {
    token: String,
    http: reqwest::Client,
}

#[derive(Deserialize, Debug, Clone)]
pub struct User {
    pub id: i64,
    pub first_name: Option<String>,
    pub username: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Chat {
    pub id: i64,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Message {
    pub message_id: i64,
    pub chat: Chat,
    pub from: Option<User>,
    pub text: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct CallbackQuery {
    pub id: String,
    pub from: User,
    pub message: Option<Message>,
    pub data: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Update {
    pub update_id: i64,
    pub message: Option<Message>,
    pub callback_query: Option<CallbackQuery>,
}

#[derive(Deserialize)]
struct Resp<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

impl Bot {
    pub fn new(token: &str) -> Self {
        Self {
            token: token.to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(40))
                .build()
                .expect("reqwest client"),
        }
    }

    async fn call<T: for<'de> Deserialize<'de>>(&self, method: &str, body: Value) -> Result<T, String> {
        let url = format!("https://api.telegram.org/bot{}/{}", self.token, method);
        let resp = self.http.post(url).json(&body).send().await.map_err(|e| e.to_string())?;
        let parsed: Resp<T> = resp.json().await.map_err(|e| e.to_string())?;
        if parsed.ok {
            parsed.result.ok_or_else(|| "empty result".to_string())
        } else {
            Err(parsed.description.unwrap_or_else(|| "telegram error".into()))
        }
    }

    pub async fn get_me(&self) -> Result<User, String> {
        self.call("getMe", json!({})).await
    }

    pub async fn get_updates(&self, offset: i64, timeout_s: u64) -> Result<Vec<Update>, String> {
        self.call(
            "getUpdates",
            json!({ "offset": offset, "timeout": timeout_s, "allowed_updates": ["message", "callback_query"] }),
        )
        .await
    }

    /// Sends HTML-formatted text. `reply_markup` may be a reply keyboard or inline keyboard.
    pub async fn send(&self, chat_id: i64, text: &str, reply_markup: Option<Value>, silent: bool) -> Result<Message, String> {
        let mut body = json!({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": true,
            "disable_notification": silent,
        });
        if let Some(m) = reply_markup {
            body["reply_markup"] = m;
        }
        self.call("sendMessage", body).await
    }

    pub async fn edit_text(&self, chat_id: i64, message_id: i64, text: &str, reply_markup: Option<Value>) -> Result<Value, String> {
        let mut body = json!({
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": true,
        });
        if let Some(m) = reply_markup {
            body["reply_markup"] = m;
        }
        self.call("editMessageText", body).await
    }

    pub async fn edit_markup(&self, chat_id: i64, message_id: i64, reply_markup: Option<Value>) -> Result<Value, String> {
        let mut body = json!({ "chat_id": chat_id, "message_id": message_id });
        body["reply_markup"] = reply_markup.unwrap_or_else(|| json!({ "inline_keyboard": [] }));
        self.call("editMessageReplyMarkup", body).await
    }

    pub async fn answer_callback(&self, id: &str, text: Option<&str>) -> Result<bool, String> {
        let mut body = json!({ "callback_query_id": id });
        if let Some(t) = text {
            body["text"] = json!(t);
        }
        self.call("answerCallbackQuery", body).await
    }

    pub async fn set_commands(&self, commands: &[(&str, &str)]) -> Result<bool, String> {
        let list: Vec<Value> = commands.iter().map(|(c, d)| json!({ "command": c, "description": d })).collect();
        self.call("setMyCommands", json!({ "commands": list })).await
    }
}

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
