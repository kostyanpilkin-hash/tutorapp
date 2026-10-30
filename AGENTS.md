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

## Особенности

- Темы: `html.theme-*` классы в `src/index.css`, метаданные `src/lib/themes.ts`, переводы `src/i18n/locales/{ru,en,be}.ts`.
- Журнал действий: таблица `activity_log` + хелпер `log_activity()` в `src-tauri/src/commands/lessons.rs`.
- Телефонное расписание: `src-tauri/src/http_server.rs` (axum :45321, токен `phone_key` в settings, тумблер `phone_server_enabled`).
- SQLite-команды запускать внутри существующих транзакций.
