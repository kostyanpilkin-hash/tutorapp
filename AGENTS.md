# TutorApp — правила проекта

## Рабочая директория

- Проект: `E:\Work\tutor-app` (НЕ `C:\Users\***\Projects\tutor-app` — старый путь, удалён).
- GitHub: `kostyanpilkin-hash/tutorapp`, ветка `main`. Локальная рабочая ветка `cursor/today-prev-next-single-instance` трекает `origin/main`; пуш: `git push origin HEAD:main`.

## CHANGELOG

- После каждой завершённой задачи (фича/фикс) пополнять `CHANGELOG.md` в корне — по-русски, сгруппировано по датам и темам, коммитить и пушить вместе с кодом.

## Автообновление и релизы

- Репозиторий `tutorapp` публичный; установщики и `latest.json` публикуются в его же релизах через `.github/workflows/release.yml`: тег `v*` (или workflow_dispatch) → черновой релиз → Publish. Основной токен — стандартный `GITHUB_TOKEN`.
- `tutorapp_public` — только legacy-зеркало: воркфлоу заливает туда `latest.json` (URL внутри — на tutorapp), чтобы клиенты ≤0.2.2 обновились один раз и перешли на новый endpoint. Когда все клиенты ≥0.2.3 — зеркало и `PUBLIC_RELEASES_TOKEN` можно убрать.
- Апдейтер: `tauri-plugin-updater` + `UpdateNotifier` (проверка через 15 с после запуска и каждые 30 мин) + кнопка «Проверить обновления» в Настройки → «О программе». `latest.json` виден только после Publish — черновики `releases/latest` игнорирует.
- Подпись minisign: pubkey в `tauri.conf.json`; приватный ключ `~/.tauri/tutorapp.key` — его содержимое в секрете `TAURI_SIGNING_PRIVATE_KEY`, пароль в `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Потеря ключа/пароля = нужна новая пара и перевыпуск клиентов.
- Локальная сборка установщика теперь требует ключ: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tutorapp.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=… npx tauri build` — вариант `TAURI_SIGNING_PRIVATE_KEY_PATH` не срабатывает (кириллица в `C:\Users\***\`).
- `PUBLIC_RELEASES_TOKEN` — fine-grained PAT, Contents: Read & Write, только на `tutorapp_public` (нужен лишь для зеркала).
- Версию бампить до тега во всех трёх местах: `tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`.

## Сборка и проверки

- Проверки: `npx tsc --noEmit`, `cargo check` (в `src-tauri`), `npm test` (vitest, Nтестов).
- Установщик: `npm run build:installer` → MSI+NSIS в `installers/<дата>/`.
- Установка: `TutorApp_0.2.0_x64-setup.exe /S` (NSIS, тихая).
- База приложения: `%APPDATA%\TutorApp\tutor.db` (sqlite; читать можно через `node:sqlite` в Node 24+).
- Жёстко не перечитывать одни и те же строки файлов в цикле — если знаешь якорь, правь; для дописки в конец *** — `cat >>`.

## Граф кода (graphify)

- `graphify-out/graph.json` — knowledge graph кодовой базы (tree-sitter AST, детерминированно, без LLM). Автообновляется git-хуками на commit/checkout/merge/rewrite; ручное обновление `graphify update .`, полный пересчёт `graphify extract . --code-only`. Разово отключить хук: `GRAPHIFY_SKIP_HOOK=1`.
- При разведке кодовой базы использовать ПЕРЕД глобальным grep: `graphify explain "X"` (соседи узла с file:line), `graphify path "A" "B"`, `graphify affected "X"` (что затронет изменение), `graphify god-nodes`, `graphify query "..."` (BFS-контекст), `graphify section "X"` (секции markdown).
- Ограничение: мост `invoke() ↔ #[tauri::command]` в графе не моделируется — фронт и бэк не связаны; межъязыковые связи искать grep'ом по имени команды.
- Сообщества без осмысленных имён («Community N») — нет LLM-бэкенда. `graphify-out/` gitignored; отчёт `graphify-out/GRAPH_REPORT.md`, визуализация `graphify-out/graph.html`.

## G1 — единый экспандер серий на бэкенде: статус

Выполнено: фронт читает расписание через `get_expanded_lessons` (id экземпляров `parent::ISO`, поля `Occ.row_id`/`instance_iso`); scheduler и `find_overlaps` — на `occurrences::collect`; `snooze_reminder` нормализует ключи `parent::ISO`. Фронтовый `expandLessons` удалён (G1-4b); замороженная эталонная копия живёт в `src/lib/parity.test.ts` как оракул паритета.

Осталось — планы в `.devin/plans/`: `next-waves`. Выполнены: `g1-4b-remove-frontend-expander`, `finance-expanders` (`recurrence.rs` свёрнут до `is_weekly`+`intervals_overlap`; финансы на `occurrences::expand_weekly_starts_local`).

## Подводные камни

- `nul` — зарезервированное имя Windows: bash-редирект `> nul`/`2> nul` создаёт буквальный файл `nul`, который ломает git. Использовать `2>/dev/null`. Если `nul` появился — удалить `rm -f nul`, если не удаляется — `cmd //c "del nul"`.
- Тихая установка NSIS `/S`: процесс `TutorApp_*_setup` работает до ~60 с и может вернуть код 1 — это не провал. Ждать исчезновения процесса через `tasklist`, сверять результат по размеру/mtime `$LOCALAPPDATA/TutorApp/tutor-app.exe`.
- MSYS path conversion: в git-bash аргумент `/S` превращается в путь `S:/` — установщик запускается НЕ тихо и висит с невидимым окном «TutorApp Setup» навсегда. Запускать `MSYS_NO_PATHCONV=1 "...setup.exe" /S` (или `cmd //c`). Если окно висело — убить setup-процесс и перезапустить правильно.
- Длинные логи (сборка, npm): вывод в файл или `| tail -N` — не втягивать весь лог в контекст.
- Shell — git-bash: `tail`/`head`/`ls`/`tasklist` в bash-форме, не PowerShell-командлеты.

## Скиллы

- Проектные: `.devin/skills/` — `release` (пайплайн релиза), `parity` (паритет развёртки), `verify` (быстрые проверки), `db-inspect` (запросы к реальной БД через node:sqlite).
- Глобальные (доступны в любой сессии этого репо): `~/.agents/skills/` — brainstorming, grill-me/grilling, writing-plans, codebase-design, domain-modeling, systematic-debugging, verification-before-completion, improve-codebase-architecture, handoff, agent-browser, ui-ux-pro-max, frontend-design, design-taste-frontend, impeccable, shadcn, code-review, webapp-testing, find-skills, skill-creator, theme-factory, docx, pdf, xlsx; `%APPDATA%\devin\skills\` — automate, autopilot, canvas, create-hook/rule/skill/subagent, deploy-with-vercel, goal, loop, migrate-to-skills, new-repo, onboard, origin, rename-chat, review, review-bugbot, review-security, sdk, share, shell, split-to-prs, statusline, update-cli-config, update-cursor-settings.
- Если просят вызвать скилл, которого нет в списке доступных — сначала проверить директории `~/.agents/skills/` и `%APPDATA%\devin\skills/` на диске (там могут быть свежеустановленные или только что разблокированные скиллы), а уже потом говорить, что его нет. Установка недостающих: `npx skills add <owner/repo> -g -s <имя> -y --copy`.
- Скилл, ссылающийся на другой скилл (`Call the Skill tool with "X"`): если X отсутствует — это не значит, что первый скилл «пустой»; доустановить зависимость.

## Особенности

- Темы: `html.theme-*` классы в `src/index.css`, метаданные `src/lib/themes.ts`, переводы `src/i18n/locales/{ru,en,be}.ts`.
- Журнал действий: таблица `activity_log` + хелпер `log_activity()` в `src-tauri/src/commands/lessons.rs`.
- Телефонное расписание: `src-tauri/src/http_server.rs` (axum :45321, токен `phone_key` в settings, тумблер `phone_server_enabled`).
- SQLite-команды запускать внутри существующих транзакций.
