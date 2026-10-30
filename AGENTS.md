# TutorApp — правила проекта

## Рабочая директория

- Проект: `E:\Work\tutor-app` (НЕ `C:\Users\***\Projects\tutor-app` — старый путь, удалён).
- GitHub: `kostyanpilkin-hash/tutorapp`, ветка `main`. Локальная рабочая ветка `cursor/today-prev-next-single-instance` трекает `origin/main`; пуш: `git push origin HEAD:main`.

## CHANGELOG

- После каждой завершённой задачи (фича/фикс) пополнять `CHANGELOG.md` в корне — по-русски, сгруппировано по датам и темам, коммитить и пушить вместе с кодом.

## Сборка и проверки

- Проверки: `npx tsc --noEmit`, `cargo check` (в `src-tauri`), `npm test` (vitest, Nтестов).
- Установщик: `npm run build:installer` → MSI+NSIS в `installers/<дата>/`.
- Установка: `TutorApp_0.2.0_x64-setup.exe /S` (NSIS, тихая).
- База приложения: `%APPDATA%\TutorApp\tutor.db` (sqlite; читать можно через `node:sqlite` в Node 24+).
- Жёстко не перечитывать одни и те же строки файлов в цикле — если знаешь якорь, правь; для дописки в конец *** — `cat >>`.

## G1 — единый экспандер серий на бэкенде: статус

Выполнено: фронт читает расписание через `get_expanded_lessons` (id экземпляров `parent::ISO`, поля `Occ.row_id`/`instance_iso`); scheduler и `find_overlaps` — на `occurrences::collect`; `snooze_reminder` нормализует ключи `parent::ISO`. Фронтовый `expandLessons` удалён (G1-4b); замороженная эталонная копия живёт в `src/lib/parity.test.ts` как оракул паритета.

Осталось — планы в `.devin/plans/`: `g1-4b-remove-frontend-expander`, `finance-expanders` (`finance.rs`/`get_student_finance` на `expand_weekly_starts` — последний старый экспандер), `next-waves`.

## Подводные камни

- `nul` — зарезервированное имя Windows: bash-редирект `> nul`/`2> nul` создаёт буквальный файл `nul`, который ломает git. Использовать `2>/dev/null`. Если `nul` появился — удалить `rm -f nul`, если не удаляется — `cmd //c "del nul"`.
- Тихая установка NSIS `/S`: процесс `TutorApp_*_setup` работает до ~60 с и может вернуть код 1 — это не провал. Ждать исчезновения процесса через `tasklist`, сверять результат по размеру/mtime `$LOCALAPPDATA/TutorApp/tutor-app.exe`.
- Длинные логи (сборка, npm): вывод в файл или `| tail -N` — не втягивать весь лог в контекст.
- Shell — git-bash: `tail`/`head`/`ls`/`tasklist` в bash-форме, не PowerShell-командлеты.
- Скиллы: `.devin/skills/` — `release` (пайплайн релиза), `parity` (паритет развёртки), `verify` (быстрые проверки), `db-inspect` (запросы к реальной БД через node:sqlite).

## Особенности

- Темы: `html.theme-*` классы в `src/index.css`, метаданные `src/lib/themes.ts`, переводы `src/i18n/locales/{ru,en,be}.ts`.
- Журнал действий: таблица `activity_log` + хелпер `log_activity()` в `src-tauri/src/commands/lessons.rs`.
- Телефонное расписание: `src-tauri/src/http_server.rs` (axum :45321, токен `phone_key` в settings, тумблер `phone_server_enabled`).
- SQLite-команды запускать внутри существующих транзакций.
