use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Html,
    routing::get,
    Json, Router,
};
use chrono::{Duration, NaiveDate, Utc};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::db::{self, AppState};
use crate::occurrences::{self, Occ};

pub const PHONE_PORT: u16 = 45321;
static SHUTDOWN: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

#[derive(Clone)]
struct SrvState {
    key: String,
}

fn open_db() -> Result<Connection, String> {
    let conn = Connection::open(db::db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}

fn ensure_key(conn: &Connection) -> Result<String, String> {
    if let Some(k) = setting(conn, "phone_key") {
        return Ok(k);
    }
    let k = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('phone_key', ?1)",
        params![k],
    )
    .map_err(|e| e.to_string())?;
    Ok(k)
}

/// The local IPv4 chosen by the OS for the default route (may be a VPN address).
fn default_route_ip() -> Option<std::net::Ipv4Addr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(v4) => Some(v4),
        _ => None,
    }
}

/// All candidate LAN IPv4 addresses, best first. Skips VPN/tunnel/virtual
/// adapters; prefers the interface that carries the default route, then
/// 192.168.x.x, 172.16-31.x.x, 10.x.x.x.
fn local_ips() -> Vec<String> {
    static CACHE: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(local_ips_uncached).clone()
}

fn local_ips_uncached() -> Vec<String> {
    const TUNNEL_HINTS: &[&str] = &[
        "vpn", "tun", "tap", "xray", "wireguard", "wg", "openvpn", "tailscale",
        "wsl", "hyper-v", "virtualbox", "vmware", "loopback", "bluetooth",
    ];
    let route = default_route_ip();
    let mut lan: Vec<std::net::Ipv4Addr> = Vec::new();
    if let Ok(ifs) = if_addrs::get_if_addrs() {
        for i in ifs {
            let name = i.name.to_lowercase();
            if TUNNEL_HINTS.iter().any(|h| name.contains(h)) || i.ip().is_loopback() {
                continue;
            }
            if let std::net::IpAddr::V4(v4) = i.ip() {
                if v4.is_private() && !lan.contains(&v4) {
                    lan.push(v4);
                }
            }
        }
    }
    lan.sort_by_key(|a| {
        let class = match a.octets()[0] {
            192 => 1u8,
            172 => 2,
            10 => 3,
            _ => 4,
        };
        (if Some(*a) == route { 0 } else { 1 }, class)
    });
    if lan.is_empty() {
        if let Some(r) = route {
            lan.push(r);
        }
    }
    lan.into_iter().map(|a| a.to_string()).collect()
}

fn local_ip() -> String {
    local_ips().into_iter().next().unwrap_or_else(|| "localhost".to_string())
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn get_phone_link(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    state.pool.with_conn(|conn| {
        if setting(conn, "phone_server_enabled").as_deref() != Some("1") {
            return Ok(None);
        }
        let key = ensure_key(conn)?;
        Ok(Some(format!(
            "http://{}:{}/?key={}",
            local_ip(),
            PHONE_PORT,
            key
        )))
    })
}

/// All reachable links (one per LAN interface), best first.
#[tauri::command]
pub fn get_phone_links(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    state.pool.with_conn(|conn| {
        if setting(conn, "phone_server_enabled").as_deref() != Some("1") {
            return Ok(Vec::new());
        }
        let key = ensure_key(conn)?;
        Ok(local_ips()
            .into_iter()
            .map(|ip| format!("http://{ip}:{PHONE_PORT}/?key={key}"))
            .collect())
    })
}

/// Regenerates the access token; old links stop working. Restarts the server
/// so the new key takes effect immediately.
#[tauri::command]
pub fn reset_phone_key(state: tauri::State<AppState>) -> Result<(), String> {
    let enabled = state.pool.with_conn(|conn| {
        conn.execute("DELETE FROM settings WHERE key = 'phone_key'", [])
            .map_err(|e| e.to_string())?;
        ensure_key(conn)?;
        Ok(setting(conn, "phone_server_enabled").as_deref() == Some("1"))
    })?;
    if enabled {
        start_server();
    }
    Ok(())
}

#[tauri::command]
pub fn set_phone_server(
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.pool.with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('phone_server_enabled', ?1)",
            params![if enabled { "1" } else { "0" }],
        )
        .map_err(|e| e.to_string())?;
        ensure_key(conn).map(|_| ())
    })?;
    if enabled {
        start_server();
    } else {
        stop_server();
    }
    Ok(())
}

pub fn maybe_start() {
    if let Ok(conn) = open_db() {
        if setting(&conn, "phone_server_enabled").as_deref() == Some("1") {
            start_server();
        }
    }
}

fn start_server() {
    stop_server();
    let key = match open_db().and_then(|c| ensure_key(&c)) {
        Ok(k) => k,
        Err(_) => return,
    };
    let (tx, rx) = oneshot::channel::<()>();
    if let Ok(mut guard) = SHUTDOWN.lock() {
        *guard = Some(tx);
    }
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/", get(index))
            .route("/api/lessons", get(lessons))
            .with_state(SrvState { key });
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", PHONE_PORT)).await {
            Ok(l) => l,
            Err(_) => return,
        };
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });
}

fn stop_server() {
    if let Ok(mut guard) = SHUTDOWN.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
}

// ---------- HTTP handlers ----------

async fn index() -> Html<&'static str> {
    Html(PAGE)
}

async fn lessons(
    State(s): State<SrvState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Vec<Occ>>, StatusCode> {
    if q.get("key").map(|v| v.as_str()) != Some(s.key.as_str()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let conn = open_db().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tz = occurrences::timezone(&conn);
    let today = Utc::now().with_timezone(&tz).date_naive();
    let from = q
        .get("from")
        .and_then(|v| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok())
        .unwrap_or(today);
    let to = q
        .get("to")
        .and_then(|v| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok())
        .unwrap_or(from + Duration::days(7));
    occurrences::collect(&conn, tz, from, to)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

// ---------- Phone page ----------

const PAGE: &str = r##"<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0b0b0f">
<title>TutorApp — расписание</title>
<style>
*{box-sizing:border-box;margin:0}
body{background:#0b0b0f;color:#f0f0f3;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;padding:16px 14px calc(24px + env(safe-area-inset-bottom))}
h1{font-size:20px;margin-bottom:4px}
.sub{color:#8b8b96;font-size:13px;margin-bottom:18px}
.day{margin:18px 0 8px;font-size:14px;font-weight:600;color:#9ea0aa;text-transform:capitalize}
.day .accent{color:#6aa5ff}
.card{background:#17171d;border:1px solid #26262e;border-radius:14px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.time{min-width:56px;font-variant-numeric:tabular-nums}
.time .t{font-size:16px;font-weight:600}
.time .d{font-size:11px;color:#8b8b96}
.info{flex:1;min-width:0}
.name{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chips{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.chip{font-size:11px;padding:2px 8px;border-radius:99px;background:#23232b;color:#a5a5af}
.chip.green{background:rgba(50,205,50,.15);color:#7ee08c}
.chip.red{background:rgba(255,80,80,.15);color:#ff9a9a}
.chip.amber{background:rgba(255,190,60,.15);color:#ffd48a}
.btn{position:fixed;right:16px;bottom:calc(20px + env(safe-area-inset-bottom));background:#0a84ff;color:#fff;border:0;border-radius:99px;padding:12px 18px;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(10,132,255,.4)}
.err{color:#ff9a9a;padding:20px 0}
</style>
</head>
<body>
<h1>Расписание</h1>
<div class="sub" id="sub">Загрузка…</div>
<div id="list"></div>
<button class="btn" onclick="load()">Обновить</button>
<script>
const params = new URLSearchParams(location.search);
let key = params.get('key') || localStorage.getItem('pk') || '';
if (params.get('key')) localStorage.setItem('pk', key);
const STATUS = {completed:['Проведено','green'],no_show:['Не состоялось','amber'],cancelled:['Отменено','red']};
const PAY = {paid:['Оплачено','green'],unpaid:['Не оплачено','red'],prepaid:['Предоплата','']};
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){
  const sub = document.getElementById('sub');
  try{
    const r = await fetch('api/lessons?key='+encodeURIComponent(key));
    if(r.status===401){sub.innerHTML='<span class="err">Неверный ключ. Откройте ссылку с QR-кода заново.</span>';return}
    const rows = await r.json();
    sub.textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    const days = {};
    for(const l of rows){
      const d = new Date(l.start);
      const k = d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
      (days[k]=days[k]||[]).push(l);
    }
    const todayK = (()=>{const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()})();
    const tomorrowK = (()=>{const d=new Date(Date.now()+864e5);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()})();
    const names = {[todayK]:'Сегодня',[tomorrowK]:'Завтра'};
    let html = '';
    for(const k of Object.keys(days)){
      const d = days[k][0] && new Date(days[k][0].start);
      const lbl = names[k] || d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
      html += '<div class="day'+(names[k]?' accent':'')+'">'+lbl+'</div>';
      for(const l of days[k]){
        const t = new Date(l.start);
        const hh = String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
        let chips = '';
        const st = STATUS[l.status]; if(st) chips += '<span class="chip '+st[1]+'">'+st[0]+'</span>';
        const p = PAY[l.paymentStatus]; if(p) chips += '<span class="chip '+p[1]+'">'+p[0]+'</span>';
        if(!st && !p) chips = '<span class="chip">По расписанию</span>';
        html += '<div class="card"><div class="dot" style="background:'+(l.color||'#0a84ff')+'"></div>'+
          '<div class="time"><div class="t">'+hh+'</div><div class="d">'+l.durationMinutes+' мин</div></div>'+
          '<div class="info"><div class="name">'+esc(l.name)+'</div><div class="chips">'+chips+'</div></div></div>';
      }
    }
    document.getElementById('list').innerHTML = html || '<div class="sub">Ближайших занятий нет</div>';
  }catch(e){sub.innerHTML='<span class="err">Нет соединения с компьютером. Проверьте Wi-Fi и что приложение запущено.</span>'}
}
load(); setInterval(load, 60000);
</script>
</body>
</html>"##;
