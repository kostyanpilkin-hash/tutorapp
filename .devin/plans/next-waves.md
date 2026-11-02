# Следующие волны аудита (после G1-4b и finance-expanders)

Порядок по эффекту/риску. Каждая волна — отдельный коммит и, при желании, отдельный тред.

## 1. Разбивка lessons.rs (~Nстрок) — ✅ выполнено (2026-10-30)

`commands/lessons.rs` (команды + тесты, ~Nстрок) + подмодули `commands/lessons/`: `repo.rs` (SQL+row_to_lesson+loaders), `archive.rs` (archive/restore/dedupe + delete_series_from_instance), `overlaps.rs`, `activity_log.rs` (log_activity). Внешние пути сохранены ре-экспортами — потребители не тронуты.

## 2. Виртуализация длинных списков — ✅ выполнено (2026-10-30)

`@tanstack/react-virtual@3.14`: HistoryPanel (карточки, measureElement для раскрытия) и DebtsList (таблица, spacer-`<tr>`, scroll-область `max-h-[70vh]` + sticky thead). История ученика уже инкрементальна (HISTORY_STEP) — не тронута.

## 3. React Query (по компоненту за раз)

Детальный план: `.devin/plans/react-query.md` — фабрика ключей, порядок панелей (lessonStore → StudentsPanel → FinancePanel → остальные), ловушки, критерии приёмки.

## 4. Узкие селекторы Zustand + memo — ✅ выполнено (2026-10-30)

Все `useXStore()` без селектора сужены: App (settings+lessons через `useShallow`), SettingsPanel, LessonFormDialog, CalendarViews/StudentsPanel (`s => s.timezone`), toast в 3 панелях (`useShallow` методов). Reschedule-диалоги не тронуты — используют все поля.

## 5. Далее (крупное) — планы готовы, порядок: 1→2→3

- `student-name-normalization.md` — имя ученика резолвить через JOIN (переименование видно везде), без миграции данных.
- `ux-features.md` — Ctrl+K палитра, dnd-полировка, офлайн телефонной страницы (каждая своим коммитом).
- `specta-ipc-types.md` — генерация TS-типов из Rust-моделей (ts-rs), низший приоритет.
- `telegram-polish.md` — красивые HTML-сообщения/меню бота (esc-хелпер, карточки, inline-настройки).
- `settings-redesign.md` — страница настроек: под-навигация по разделам, строки+свитчи, вынос tg_fields/tg_offsets/дайджеста/тихих часов в UI.
- `cloud-bot.md` — облачный бот: один бот на многих преподавателей (Hetzner VPS + домен, общий crate, синк-проекция, очередь действий). Большой проект, фазы 0–4.
