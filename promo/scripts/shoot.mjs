// Captures real screenshots of the installed TutorApp via WebView2 CDP.
// Usage: node scripts/shoot.mjs
import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import WebSocket from "ws";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "shots");
mkdirSync(OUT, { recursive: true });

const EXE = `${process.env.LOCALAPPDATA}\\TutorApp\\tutor-app.exe`;
const PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// kill any running instance, then launch with CDP enabled
try {
  execSync("taskkill /F /IM tutor-app.exe 2>nul");
} catch {}
const child = spawn(EXE, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  },
  detached: true,
  stdio: "ignore",
});
child.unref();

const getJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });

// wait for CDP endpoint
let targets = null;
for (let i = 0; i < 30; i++) {
  try {
    targets = await getJson(`http://localhost:${PORT}/json`);
    if (targets && targets.length) break;
  } catch {}
  await sleep(1000);
}
if (!targets || !targets.length) {
  console.error("CDP endpoint never came up");
  process.exit(1);
}
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.error("No page target found");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => {
  ws.on("open", res);
  ws.on("error", rej);
});

let msgId = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const evalJs = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result;

await send("Page.enable");
await sleep(6000); // let the app boot and load data

const clickByText = async (texts) => {
  const list = texts.map((t) => JSON.stringify(t)).join(",");
  return evalJs(
    `(() => { const t = [${list}]; const b = [...document.querySelectorAll('button')].find(x => t.some(s => x.textContent.trim().includes(s))); if (b) { b.click(); return true } return false })()`,
  );
};

const shots = [
  { file: "today", texts: ["Сегодня", "Today"] },
  { file: "calendar", texts: ["Календарь", "Calendar"] },
  { file: "students", texts: ["Ученики", "Students"] },
  { file: "finance", texts: ["Финансы", "Finance"] },
  { file: "settings", texts: ["Настройки", "Settings"] },
];

// first shot: whatever the app opened on (usually Today)
{
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, "today.png"), Buffer.from(r.result.data, "base64"));
  console.log("today.png");
}

for (const s of shots.slice(1)) {
  const clicked = await clickByText(s.texts);
  await sleep(1800);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${s.file}.png`), Buffer.from(r.result.data, "base64"));
  console.log(`${s.file}.png (clicked=${clicked?.result?.value})`);
}

try {
  ws.close();
} catch {}
try {
  execSync("taskkill /F /IM tutor-app.exe 2>nul");
} catch {}
console.log("done");
process.exit(0);
