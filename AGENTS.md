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

## G1 — единый экспандер серий на бэкенде: ВЫПОЛНЕНО (ожидает ручной приёмки)

Сделано: `get_expanded_lessons(from, to)` (команда + `expanded_lessons_in_range` в `commands/lessons.rs`) отдаёт `Vec<Lesson>`; сгенерированные экземпляры — id `parent::ISO` (toISOString-формат, поля `Occ.row_id`/`instance_iso` в `occurrences.rs`). Фронт: `loadExpandedLessons()` в `src/lib/recurrence.ts` — бэкенд по умолчанию, `expandLessons` как fallback (localStorage `fe.expand=local` или при ошибке). Потребители: `lessonStore`, `RemindersPanel`, `StudentsPanel`.

Паритет: `scripts/parity-prepare.mjs` (копия БД + диапазоны) → `cargo test -- --ignored expanded_dump` → `src/lib/parity.test.ts` сравнивает `[id,startAt]` с `expandLessons`. На реальной БД — идентично.

Побочный фикс: `snooze_reminder` нормализует ключи (`parent::ISO` → parent id, время → rfc3339) — иначе снуз повторяющихся не совпадал с ключами планировщика.

Осталось после приёмки: выпилить `expandLessons` и `fe.expand` fallback, перевести `scheduler/expand_weekly_starts` на `occurrences::collect`.

## Подводные камни

- `nul` — зарезервированное имя Windows: bash-редирект `> nul`/`2> nul` создаёт буквальный файл `nul`, который ломает git. Использовать `2>/dev/null`. Если `nul` появился — удалить `rm -f nul`, если не удаляется — `cmd //c "del nul"`.
- Тихая установка NSIS `/S`: процесс `TutorApp_*_setup` работает до ~60 с и может вернуть код 1 — это не провал. Ждать исчезновения процесса через `tasklist`, сверять результат по размеру/mtime `$LOCALAPPDATA/TutorApp/tutor-app.exe`.
- Shell — git-bash: `tail`/`head`/`ls`/`tasklist` в bash-форме, не PowerShell-командлеты.
- Скиллы: `.devin/skills/release` (полный пайплайн релиза) и `.devin/skills/parity` (проверка паритета развёртки серий на копии реальной БД).

## Особенности

- Темы: `html.theme-*` классы в `src/index.css`, метаданные `src/lib/themes.ts`, переводы `src/i18n/locales/{ru,en,be}.ts`.
- Журнал действий: таблица `activity_log` + хелпер `log_activity()` в `src-tauri/src/commands/lessons.rs`.
- Телефонное расписание: `src-tauri/src/http_server.rs` (axum :45321, токен `phone_key` в settings, тумблер `phone_server_enabled`).
- SQLite-команды запускать внутри существующих транзакций.
