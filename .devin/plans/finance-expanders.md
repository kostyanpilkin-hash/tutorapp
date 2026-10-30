# finance-expanders: миграция финансовых агрегатов на occurrences::collect

## Статус: выполнено (2026-10-30), вариант B

- `occurrences::expand_weekly_starts_local` — копия слот-генерации `collect` (local-tz якорь, BYDAY/INTERVAL/COUNT, эксклюзивный UNTIL); финансы и `get_student_finance` переведены, per-student пайплайн не тронут.
- `recurrence.rs` свёрнут до `is_weekly` + `intervals_overlap`.
- Дифф на копии реальной БД: Nсерия, 0 расхождений (полуночных/DST-якорей в данных нет) — игнорируемый тест `occurrences::realdb_tests::finance_expansion_diff`.
- Известная оставшаяся проблема (не чинилась, поведение сохранено): исключение со слотом внутри периода и переносом наружу учитывается в отчёте исходного периода по времени переноса — сумма попадает в два периода (двойной учёт на стыке).

Последние потребители старого UTC-экспандера `expand_weekly_starts` (`src-tauri/src/recurrence.rs`):

1. `commands/finance.rs` — `expand_weekly_instances` в финансовом отчёте (earned/debt/expected по валютам, исключения по instant-match через `find_exception`).
2. `commands/students.rs` — `get_student_finance` (то же посдентно: `lesson_students` JOIN + исключения) и `count_student_lessons_for_link_update` / `update_student_lessons_link` (подсчёт будущих занятий ученика).

## Подход

- Общий хелпер на `occurrences::collect(conn, tz, from_d, to_d)` + фильтр по `occ.row_id`/`occ.start_utc` и джойн `lesson_students` для стоимости конкретного ученика (collect возвращает агрегат занятия, не per-student — нужен отдельный запрос либо расширение Occ).
- Вариант B (минимальный риск): оставить per-parent развёртку, но заменить `expand_weekly_starts` на локальную обёртку над `parse_rule` + та же local-tz логика что collect — убрать UTC-анкоринг, не ломая per-student pipeline.
- Тесты: finance-тесты уже есть в `commands/finance.rs` (10+). Добавить кейс: серия с якорем около полуночи местного времени (UTC-дата ≠ местная) — счёт ожидаемых занятий по правильным дням.

## Критерий приёмки

- `expand_weekly_starts` больше нигде не вызывается; `recurrence.rs` свёрнут до `intervals_overlap` (или удалён, хелпер переехав).
- Финансовые цифры на реальной базе до/после совпадают (кроме исправленных полуночных кейсов — показать дифф).
