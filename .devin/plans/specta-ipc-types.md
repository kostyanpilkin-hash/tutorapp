# specta/ts-rs — типизация IPC из Rust-моделей

## Статус: к исполнению (третья задача нового треда, низший приоритет)

Цель: генерировать TS-типы из Rust-моделей — убрать ручную синхронизацию `src/types/*` с `src-tauri/src/models`, ловить дрифт на этапе сборки.

## Подход

1. Оценить `specta` + `tauri-specta` (заточено под tauri::command — генерит и типы, и invoke-биндинги) vs `ts-rs` (только типы, проще). Рекомендация: начать с `ts-rs` — меньше магии, типы экспортируются тестом в файл.
2. Покрыть `#[derive(TS)]` модели в `src-tauri/src/models`: Lesson, LessonInput, LessonStudent(s), Reminder, Student(s), StudentFinance, DebtEntry, FinanceReport (+CurrencyAmount/SubjectAmount/TimelinePoint), ActivityLogEntry, OverlapInfo, TelegramStatus и пр.
3. `#[ts(export)]` → `src/types/generated.ts`; тест `export_bindings` регенерирует файл.
4. Ручные `src/types/*.ts` перевести на re-export/extends от сгенерированных — фронтовые импорты не ломать. Расхождения ручных типов сгенерированными — зафиксировать и обсудить (могли быть поля, которых нет в Rust-модели).
5. Сгенерированный файл в gitignore или коммитить — решить (коммитить: diff типов виден в git).

## Ловушки

- serde-атрибуты должны соответствовать фронтовым именам полей (camelCase rename уже есть на моделях — проверить каждую).
- `DateTime<Utc>` → `string`; Option<T> → `T | null`.
- Не тащить specta-runtime в продакшен-бандл, если не нужен.

## Критерий приёмки

- `tsc` чисто на сгенерированных типах; `npm test` зелёный.
- Изменение Rust-модели → `cargo test` перегенерирует TS → фронт ломается на несоответствии (проверить на тестовом поле, откатить).
- `/verify` → changelog → коммит → пуш.
