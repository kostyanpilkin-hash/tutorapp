# Облачный бот: один бот на многих преподавателей (Hetzner VPS + домен)

## Статус: к исполнению (большой проект, серия тредов)

Цель: продуктовый режим — один общий бот, каждый преподаватель подключает своё приложение, бот работает **при выключенном ПК препода** (напоминания, дайджесты, действия через очередь). Локальный бот (`telegram/`) продолжает работать независимо — облачный режим опционален и включается отдельно.

## Архитектура

```
Приложение (local-first, source of truth, SQLite)
   │  push снапшота (students/lessons/lesson_students/settings) каждые ~5 мин + по dirty-флагу
   ▼
VPS (Hetzner, 24/7): axum-сервис + SQLite + Telegram long polling→webhook
   ├── проекция расписания на каждого препода (tutor_id-scoped таблицы)
   ├── бот: команды/действия/напоминания/дайджесты по данным проекции
   └── очередь действий → приложение забирает → применяет → ack → сервер финализирует сообщение
   ▲
   │  pull очереди действий каждые ~2-5 мин + при старте
Приложение
```

**Ключевое решение:** общий код выносим в crate `shared` — `occurrences.rs` (развёртка серий), `telegram/texts.rs` (локализация ru/en/be), `telegram/api.rs` (Bot-клиент), генераторы сообщений (`lesson_card`, `day_message`, `week_message`, `debts_message`, `reminder_text`, `result_text`, разметки кнопок). И приложение, и сервер используют один код — одинаковый UX в обоих ботах, никакого дублирования.

**Почему SQLite и на сервере:** общий код читает `rusqlite::Connection` — серверная БД повторяет схему приложения (плюс колонка `tutor_id`), и все генераторы/SQL работают как есть. Для сотен преподавателей SQLite на VPS достаточно; переезд на Postgres — отдельная история при росте.

## Фаза 0 — инфраструктура и общий crate

### 0.1. Закупка (делает владелец, ~20 минут)

1. Регистрация на **hetzner.com** → Cloud → новый проект → «Add server»: локация **Falkenstein/Nuremberg** (ближе к РБ/РФ), образ **Ubuntu 24.04**, тариф **CX22** (2 vCPU / 4 GB / 40 GB, ~€4.5/мес — 4 GB нужны, чтобы Rust компилировался прямо на сервере; CX11 с 2 GB может упасть на линковке).
2. SSH-ключ: на Windows `ssh-keygen -t ed25519` → публичный ключ вставить в форму Hetzner.
3. Домен: reg.ru / namecheap / porkbun — любой дешёвый (~$10-15/год). В DNS-панели — **A-запись `bot.<домен>` → IP сервера**.
4. Создать бота в @BotFather для продукта: `/newbot` → имя вида «TutorApp» → `@tutorapp_bot` (имя свободное подобрать). Токен — в секреты сервера, НЕ в репозиторий.

### 0.2. Бутстрап сервера (скриптом, один раз)

```bash
# на сервере под root
apt update && apt upgrade -y
apt install -y ufw caddy build-essential pkg-config libssl-dev sqlite3
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
useradd -m -s /bin/bash tutorbot
curl https://sh.rustup.rs -sSf | sudo -u tutorbot sh -s -- -y
```

`/etc/caddy/Caddyfile`:

```
bot.<домен> {
    reverse_proxy 127.0.0.1:8080
}
```

`systemctl reload caddy` — Caddy сам выпустит TLS-сертификат.

`/etc/systemd/system/tutorbot.service`:

```ini
[Unit]
Description=TutorApp cloud bot
After=network.target

[Service]
User=tutorbot
WorkingDirectory=/home/tutorbot
EnvironmentFile=/home/tutorbot/.env
ExecStart=/home/tutorbot/tutorbot-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/home/tutorbot/.env` (chmod 600): `BOT_TOKEN=...`, `DATABASE_PATH=/home/tutorbot/tutorbot.db`, `BIND=127.0.0.1:8080`, `WEBHOOK_SECRET=<random 32>`.

### 0.3. Cargo workspace + crate `shared` (первый кодовый коммит)

- Корневой `Cargo.toml` становится виртуальным workspace: `members = ["src-tauri", "shared", "server"]`. Внимание: `npm run tauri build`/`cargo check` в `src-tauri` должны работать как раньше — проверить, tauri не должен сломаться от workspace (lib crate-type staticlib/cdylib/rlib остаётся).
- `shared/` (crate `tutor_shared`, rlib): переносим из `src-tauri/src/`:
  - `occurrences.rs` — `collect`, `materialize`, `timezone`, `expand_weekly_starts_local`, `Occ`, `intervals_overlap`
  - `telegram/api.rs` — `Bot`, `esc`, модели Update/Message/CallbackQuery
  - `telegram/texts.rs` — `L`, `T`, `lang`
  - `telegram/format.rs` — чистые генераторы: `lesson_card`, `day_message`, `week_message`, `evening_summary`, `debts_message`, `reminder_text`, `result_text`, `settings_markup`, `actions_markup`, `day_actions_markup`, `reply_keyboard`, `parse_callback`, `FIELD_CHOICES`, `offsets`, `field_flags`
  - `models` — структуры строк таблиц, serde для снапшота
- `src-tauri` заменяет своё `mod occurrences`/`telegram` на `use tutor_shared::*` — тонкая обёртка, чтобы внешние пути `crate::occurrences::collect` продолжали работать (re-export).

### 0.4. Изменение сигнатур: tutor-scope (второй коммит)

- `occurrences::collect(conn, tutor_id, tz, from, to)` — `tutor_id` фильтр в SQL. В приложении все таблицы получают колонку `tutor_id TEXT NOT NULL DEFAULT 'local'` (миграция: `lessons`, `students`, `lesson_students`, `activity_log`, `telegram_sent`, `telegram_refs`, `telegram_chats`). Приложение передаёт `'local'`. Это одна кодовая дорожка без форков SQL.
- Все читающие SQL в shared (`debts_message`, `apply_action`-хелперы, `sent_mark`, `telegram_refs`, `field_flags`, `offsets`) принимают `tutor_id` и фильтруют. `activity_log` на сервере существует той же схемой — `log_activity` работает без изменений.
- `/verify` + parity после этой правки обязательны — сигнатура трогает планировщик и phone-сервер.

### 0.5. Серверный скелет `server/` (crate `tutorbot-server`)

- axum на `127.0.0.1:8080`, rusqlite(bundled), tokio, serde, chrono, reqwest, sha2, uuid.
- Таблицы:

```sql
tutors(id TEXT PK, api_key_hash TEXT UNIQUE, chat_id INTEGER UNIQUE,
       display_name TEXT, paired_at TEXT, last_sync_at TEXT, schema_v INTEGER);
pair_codes(code TEXT PK, tutor_id TEXT, expires_at TEXT);
tutor_settings(tutor_id TEXT, key TEXT, value TEXT, PK(tutor_id,key));
lessons(tutor_id TEXT, id TEXT, student_name TEXT, subject TEXT, start_at TEXT,
        duration_minutes INTEGER, cost REAL, currency TEXT, link TEXT, notes TEXT,
        status TEXT, payment_status TEXT, recurrence_rule TEXT,
        recurrence_parent_id TEXT, recurrence_instance_date TEXT, color TEXT,
        created_at TEXT, updated_at TEXT, PK(tutor_id,id));
students(tutor_id TEXT, id TEXT, name TEXT, timezone TEXT, default_cost REAL,
         default_currency TEXT, default_link TEXT, default_duration INTEGER,
         color TEXT, notes TEXT, paid_lessons INTEGER, archived INTEGER,
         created_at TEXT, updated_at TEXT, PK(tutor_id,id));
lesson_students(tutor_id, lesson_id, student_id, cost, currency, payment_status,
                PK(tutor_id,lesson_id,student_id));
actions(id INTEGER PK AUTOINCREMENT, tutor_id TEXT, occ_id TEXT, action TEXT,
        chat_id INTEGER, message_id INTEGER, status TEXT DEFAULT 'pending',
        created_at TEXT, applied_at TEXT, result TEXT);
bot_sent(tutor_id TEXT, key TEXT, sent_at TEXT, PK(tutor_id,key));
bot_refs(tutor_id TEXT, id INTEGER, lesson_key TEXT, created_at TEXT);
activity_log(... как в приложении + tutor_id);
```

- Эндпоинты (все кроме `/health` и `/tg` — с `Authorization: Bearer <api_key>`):
  - `GET /health` → `ok` (мониторинг)
  - `POST /api/pair` — `{api_key}` → `{pair_code, expires}` : создаёт tutor-запись (unpaired), код живёт 10 мин
  - `POST /api/sync` — `{v, timezone, language, settings{tg_*}, students[], lessons[], lesson_students[]}` → транзакционно заменяет строки tutor_id (full snapshot — данных килобайты)
  - `GET /api/actions` → `{pending:[{id, occ_id, action}]}` — забирает и помечает `status='claimed'`
  - `POST /api/actions/ack` — `{id, ok, error?}` → финализирует: `edit_text` финального состояния / пометка failed
  - `POST /tg/<WEBHOOK_SECRET>` — Telegram webhook (верификация по пути + header `X-Telegram-Bot-Api-Secret-Token`)

### 0.6. Клиент синка в приложении (`src-tauri/src/cloud_sync.rs`)

- Настройки: `cloud_enabled`, `cloud_api_key`, `cloud_pair_code` (+exp), `cloud_last_sync`.
- Tokio-таск рядом с `start_bot`/`jobs_loop`: каждые 60 сек проверяет dirty-флаг (`cloud_dirty` в settings — ставится после каждой мутирующей команды; начать с тупого «dirty=true всегда», оптимизация потом) → push `/api/sync` → pull `/api/actions` → каждое действие через существующий `apply_action(conn, occ_id, action)` (он уже shared) → `ack`. Ошибки — в `cloud_last_error`, ретрай с backoff.
- Идемпотентность: action применён → помечен applied локально до ack; повторный pull того же action при падении между apply и ack — защита через `status='claimed'` + проверку текущего статуса занятия (уже completed → ok, без двойного лога). `log_activity` получает источник `telegram-cloud`.
- UI (раздел Интеграции, отдельная карточка «Общий бот (облако)»): кнопка «Подключить» → генерирует api_key (uuid), POST /api/pair → показывает код 6 цифр → пользователь шлёт код боту → статус «Подключён · последний синк HH:MM». Переводы ru/en/be.

## Фаза 1 — бот на сервере (read-only)

- Процесс `bot_loop`: long polling `getUpdates` (старт; webhook — после стабилизации, `setWebhook https://bot.<домен>/tg/<secret>`).
- `/start <code>` или код числом → `pair_codes` → привязка `tutors.chat_id`, ответ `code_ok`.
- Командная модель та же, что в `handlers.rs` (today/tomorrow/week/debts/settings), но чат → tutor_id через `tutors.chat_id`; все вызовы генераторов получают `&conn + tutor_id`. Чужой чат → `not_linked`.
- Reply-клавиатура и тексты — из shared `texts.rs`, язык = `tutor_settings.language`.

## Фаза 2 — действия из бота

- Callback → resolve tutor → enqueue `actions` + оптимистичный `edit_text` «⏳ Синхронизируется с приложением…» (новая строка в texts.rs на 3 языках).
- App pull → `apply_action` → ack → сервер: `edit_text` финалки (`result_text` из shared, но рендер по данным **проекции**: для `parent@YYYYMMDD` берём start/dur/subject из parent-строки + даты инстанса — материализованной строки на сервере нет). Для `k="d"` — перерисовка `day_message`+`day_actions_markup` по проекции.
- Таймаут ожидания: если action pending > 24 ч — `edit_text` «ожидает запуска приложения» (тост/пометка), не терять action.
- Отмена с подтверждением (x/X/b-разметка) — та же логика, очередь только на `X`.

## Фаза 3 — серверные джобы

- `jobs_loop` на сервере по образцу `jobs.rs`: тик 30 с, для каждого paired tutor: напоминания по `tg_offsets` (sent_mark → `bot_sent`), дайджест по `tg_digest_time`+окно 30 мин, `quiet_now` по `tg_quiet_from/to`+timezone. Приложение офлайн — всё работает.
- При включённом облаке локальные tg-напоминания в приложении **выключаются** (иначе дубли) — флаг `cloud_enabled` в `jobs.rs`.

## Фаза 4 — продуктовая упаковка

- Настройки бота (offsets/fields) в облачном режиме: сервер — source of truth (бот редактирует напрямую), приложение синком подтягивает; UI помечает «настраивается в боте».
- Наблюдаемость: `journalctl -u tutorbot -f`, `/health` + бесплатный UptimeRobot-пинг.
- Бэкапы: cron `sqlite3 tutorbot.db ".backup /home/tutorbot/backups/$(date +%F).db"` + ротация 14 дней.
- Деплой-скрипт `scripts/deploy-server.sh`: сборка на сервере (git pull && cargo build --release) или scp бинарника + `systemctl restart`.
- Приватность: в снапшот НЕ включать `notes`/`link`? — решить; в P0 включать (нужны для карточек), политику написать отдельно.
- Rate-limit на /api (tower-http), max размер снапшота, ротация `bot_refs`/`bot_sent` (уже есть TTL-логика в миграциях — перенести).

## Риски и ловушки

- **Workspace + tauri**: проверить `cargo tauri build`, `beforeBuildCommand`, пути к `tauri.conf.json` — ничего не сломать.
- **`collect` сигнатура**: трогает scheduler, http_server, finance — механическая правка, `/verify` + `/parity` после.
- **apply_action/materialize на сервере не нужны**: сервер только ставит в очередь; рендер финалки — по проекции, не по материализованной строке.
- **Дубли напоминаний**: при cloud_enabled локальные tg-джобы off.
- **Часовые пояса**: все метки — UTC RFC3339; локальная дата считается через tutor's timezone (shared `occurrences::timezone` читает `tutor_settings`).
- **Секреты**: токен бота и WEBHOOK_SECRET — только `.env` на сервере (600, user tutorbot), не в git.

## Проверки и приёмка

- `/verify` после каждого коммита; `/parity` после изменения `occurrences`.
- Ручная приёмка P1–P3 на тестовом VPS: второй «преподаватель» (вторая БД приложения, например portable-профиль) подключается, действия применяются, ноут выключен → напоминание всё равно приходит.
- CHANGELOG по AGENTS.md, коммит на каждый логический шаг, пуш в main.
