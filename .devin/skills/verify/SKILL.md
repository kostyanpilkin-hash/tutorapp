---
name: verify
description: Quick verification suite for TutorApp — cargo check/test, tsc, vitest. Use after any code change before committing, or when the user says «проверь», «прогони тесты», «verify».
---

# Verify

Рабочая директория: `E:\Work\tutor-app`. Прогонять всё по букве — не пропускать «неизменённые» части (дешевле прогнать, чем объяснять регресс).

```bash
cd src-tauri && cargo check 2>&1 | tail -5
cargo test 2>&1 | grep -E "test result|FAILED"
cd .. && npx tsc --noEmit
npm test 2>&1 | tail -15
```

Ожидаемо:

- `cargo check` — без ошибок; 3 предсуществующих warning в telegram — норма.
- `cargo test` — все lib-тесты зелёные; 1 ignored (`expanded_dump_real_db`) — норма.
- `tsc` — чисто.
- `npm test` — vitest зелёный; `parity.test.ts` скипается без артефактов — норма.

Если менялись `occurrences.rs` / `recurrence.ts` / команды занятий — дополнительно `/parity`.
