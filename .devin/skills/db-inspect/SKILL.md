---
name: db-inspect
description: Read-only queries against the real TutorApp SQLite DB via node:sqlite (Node 24+, no external deps). Use when the user asks to inspect actual lessons/series/exceptions/finances/journal data, or for debugging on real data («посмотри в базе», «db inspect»).
---

# DB inspect — реальная база `%APPDATA%\TutorApp\tutor.db`

Всегда **readonly** и **на копии**: приложение может держать базу открытой (WAL). Копия через `scripts/parity-prepare.mjs` или вручную (файлы `tutor.db`, `tutor.db-wal`, `tutor.db-shm` → `%TEMP%\tutor-db\`).

```js
// универсальный сниппет — node -e или временный .mjs
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.TEMP + "/tutor-db/tutor.db", { readOnly: true });
const rows = db.prepare(SQL).all(...params);
console.log(JSON.stringify(rows, null, 2));
db.close();
```

Готовые запросы:

```sql
-- Серия и её исключения
SELECT id, status, start_at, recurrence_parent_id, recurrence_instance_date
FROM lessons WHERE id = ? OR recurrence_parent_id = ?;

-- Занятия ученика (со стоимостью/оплатой)
SELECT l.id, l.start_at, l.status, ls.cost, ls.currency, ls.payment_status
FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
WHERE ls.student_id = ? ORDER BY l.start_at DESC;

-- Последние записи журнала
SELECT action, entity_name, field, old_value, new_value, created_at
FROM activity_log ORDER BY created_at DESC LIMIT 20;

-- Дубликаты исключений на один слот
SELECT recurrence_parent_id, recurrence_instance_date, COUNT(*) c
FROM lessons WHERE recurrence_parent_id IS NOT NULL
GROUP BY 1,2 HAVING c > 1;

-- Напоминания и снузы
SELECT * FROM reminders WHERE lesson_id = ?;
SELECT * FROM reminder_snoozes;
```

Правила: только SELECT; не печатать персональные данные в ответ пользователю без необходимости; писать в копию, не в живую базу.
