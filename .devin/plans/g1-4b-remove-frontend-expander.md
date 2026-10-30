# G1-4b: выпилить фронт-развёртку expandLessons

## Статус: выполнено (2026-10-30)

Отступление от плана: `matchesWeekday` оставлен — используется хелпером `countWeeklyOccurrencesFrom`.

Фронт уже читает расписание через `get_expanded_lessons`; `expandLessons` остаётся только как fallback.

## Шаги

1. Удалить из `src/lib/recurrence.ts`: `expandLessons`, `expandWeekly`, `pickException`, `matchesWeekday`, fallback-ветку и флаг `fe.expand` в `loadExpandedLessons` (оставить прямой вызов `api.getExpandedLessons`). Оставить хелперы: `WEEKLY_RULE`, `isWeeklyRecurrence`, `parseUntil`, `parseCount`, `parseByday`, `weekdayCode`, `buildWeeklyRule`, `withUntil`, `parseLocalDateTime`, `countWeeklyOccurrencesFrom`, `defaultRange`, `realLessonId`, `isRecurrenceInstance`, `parentLessonId`.
2. `src/lib/recurrence.test.ts`: оставить только тесты хелперов (parse/build/withUntil/count), удалить тесты экспансии — их роль выполняют cargo-тесты + `parity.test.ts`.
3. Проверить grep'ом, что `expandLessons(` нигде не вызывается (кроме parity.test.ts — там оставить вызов или переписать на заглушку? — решить: parity тест сравнивает старую реализацию; если удаляем — либо сохраняем копию expandLessons внутри parity.test.ts как эталон, либо удаляем и parity-тест. Рекомендация: сохранить эталонную копию в тесте — она единственный регресс-страж для occurrences).
4. `verify` + parity → changelog → commit → push.

## Критерий приёмки

- Все виды (Сегодня/неделя/месяц/ученик/напоминания) работают только на бэкенд-развёртке; grep `expandLessons` пуст вне тестов.
