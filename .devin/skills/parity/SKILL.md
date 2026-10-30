---
name: parity
description: Runs the backend/frontend recurrence-expansion parity check against a copy of the real DB. Use after changing occurrences.rs, recurrence.ts, lesson commands, or when the user asks «проверь паритет/развёртку серий».
---

# Parity check: backend vs frontend expansion

Сравнивает `expanded_lessons_in_range` (Rust) с `expandLessons` (TS) на копии реальной базы `%APPDATA%\TutorApp\tutor.db`. Оригинал не трогается — работа идёт с копией в `%TEMP%\tutor-parity`.

## Запуск

```bash
# 1. Копия БД (+ WAL/SHM) и файл диапазонов
node scripts/parity-prepare.mjs
# → печатает пути: db / in / out

# 2. Дамп бэкенда (пишет parity_out.json)
PARITY_DB='<db>' PARITY_IN='<in>' PARITY_OUT='<out>' \
  cargo test --manifest-path src-tauri/Cargo.toml expanded_dump -- --ignored

# 3. Сравнение с фронтовым expandLessons
npx vitest run src/lib/parity.test.ts
```

## Диапазоны

`parity-prepare.mjs` генерирует: today / week (пн–вс) / month / history (−2г … +2мес).

## Результат

- Все тесты зелёные → списки `[id, startAt]` идентичны.
- Мисматч → тест печатает `only frontend` / `only backend` — это и есть расхождение, разбирать причину в `occurrences.rs` (обычно UNTIL, исключения или таймзона).
- Без артефактов `parity.test.ts` пропускается (skipIf) — в обычном `npm test` это норма.

## Известные расхождения по дизайну

- У фронта хард-лимит ~5 лет от якоря серии, у бэкенда нет — на сериях старше 5 лет бэкенд честнее.
- Таймзона: бэкенд разворачивает в tz из настроек (`settings.timezone`), фронт — в ***. Совпадают, пока настройка = ***.
