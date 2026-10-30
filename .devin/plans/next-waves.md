# Следующие волны аудита (после G1-4b и finance-expanders)

Порядок по эффекту/риску. Каждая волна — отдельный коммит и, при желании, отдельный тред.

## 1. Разбивка lessons.rs (~Nстрок) — ✅ выполнено (2026-10-30)

`commands/lessons.rs` (команды + тесты, ~Nстрок) + подмодули `commands/lessons/`: `repo.rs` (SQL+row_to_lesson+loaders), `archive.rs` (archive/restore/dedupe + delete_series_from_instance), `overlaps.rs`, `activity_log.rs` (log_activity). Внешние пути сохранены ре-экспортами — потребители не тронуты.

## 2. Виртуализация длинных списков — ✅ выполнено (2026-10-30)

`@tanstack/react-virtual@3.14`: HistoryPanel (карточки, measureElement для раскрытия) и DebtsList (таблица, spacer-`<tr>`, scroll-область `max-h-[70vh]` + sticky thead). История ученика уже инкрементальна (HISTORY_STEP) — не тронута.

## 3. React Query (по компоненту за раз)

Убрать `refreshKey`/ручные reload-пропсы: `useQuery` + инвалидация по ключам (`["lessons", range]`, `["students"]`). Начать с StudentsPanel/FinancePanel. Риск: рефактор каждой панели отдельно.

## 4. Узкие селекторы Zustand + memo

`useSettingsStore()` без селектора ре-рендерит всё. *** по `useXStore(s => s)` → узкие селекторы / `useShallow`.

## 5. Далее (крупное)

- specta/ts-rs — типизация IPC из Rust-моделей.
- Нормализация `student_name` (денормализована в lessons) — с миграцией и бэкапом.
- Command palette (Ctrl+K), drag&drop в неделе, офлайн-режим телефонной страницы.
