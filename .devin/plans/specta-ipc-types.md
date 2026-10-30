# specta/ts-rs — типизация IPC из Rust-моделей

## Статус: выполнено (2026-10-30)

- Выбран `ts-rs` 12 (без specta-runtime): 19 структур с `#[derive(TS)]` + `#[ts(export, export_to = "../../src/types/bindings/")]`; генерация тестом при `cargo test`.
- `i64`/`Option<i64>`/`Vec<i64>` → `number`/`number | null`/`Array<number>` через `#[ts(type)]` (иначе bigint ломал бы JSON).
- `serde(default)` не делает поле опциональным в ts-rs — `force` стал обязательным в `LessonInput`, фронтовые литералы дополнены явными значениями.
- Ручные `types/*.ts` — re-export из `generated.ts` + доменные юнионы; расхождения `Option<T>` (`| null` vs `?:`) устранены расширением сигнатур.
- Биндинги закоммичены (diff виден в git).

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
