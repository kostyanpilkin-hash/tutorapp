# Следующие волны аудита (после G1-4b и finance-expanders)

Порядок по эффекту/риску. Каждая волна — отдельный коммит и, при желании, отдельный тред.

## 1. Разбивка lessons.rs (~Nстрок)

Выделить: `lessons/repo.rs` (SQL+row_to_lesson+loaders), `lessons/archive.rs` (archive/restore/dedupe), `lessons/overlaps.rs`, `activity_log.rs` (log_activity — сейчас импортируется из students/finance). Чистая перестановка, поведение не меняется. Проверка: cargo check/test.

## 2. Виртуализация длинных списков

HistoryPanel (до Nзаписей), список долгов, история ученика. `@tanstack/react-virtual` или `react-window`. Проверка: визуально + npm test.

## 3. React Query (по компоненту за раз)

Убрать `refreshKey`/ручные reload-пропсы: `useQuery` + инвалидация по ключам (`["lessons", range]`, `["students"]`). Начать с StudentsPanel/FinancePanel. Риск: рефактор каждой панели отдельно.

## 4. Узкие селекторы Zustand + memo

`useSettingsStore()` без селектора ре-рендерит всё. *** по `useXStore(s => s)` → узкие селекторы / `useShallow`.

## 5. Далее (крупное)

- specta/ts-rs — типизация IPC из Rust-моделей.
- Нормализация `student_name` (денормализована в lessons) — с миграцией и бэкапом.
- Command palette (Ctrl+K), drag&drop в неделе, офлайн-режим телефонной страницы.
