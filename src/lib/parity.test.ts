/**
 * Parity check: backend `expanded_lessons_in_range` vs frontend `expandLessons`
 * on a copy of the real database.
 *
 * Prepare + dump:
 *   node scripts/parity-prepare.mjs
 *   PARITY_DB=<dir>/tutor.db PARITY_IN=<dir>/parity_in.json \
 *   PARITY_OUT=<dir>/parity_out.json cargo test --manifest-path src-tauri/Cargo.toml -- --ignored expanded_dump
 *
 * Then `npx vitest run src/lib/parity.test.ts` compares `[id, startAt]` lists.
 * Skips silently when the dump artifacts are absent.
 */
import { describe, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Lesson } from "@/types/lesson";

vi.mock("@/lib/api", () => ({ api: {} }));

import { expandLessons } from "@/lib/recurrence";

interface DumpRange {
  name: string;
  from: string;
  to: string;
  lessons: { id: string; start: string }[];
}

const dir = join(tmpdir(), "tutor-parity");
const dbPath = join(dir, "tutor.db");
const outPath = join(dir, "parity_out.json");
const ready = existsSync(dbPath) && existsSync(outPath);

function loadRows(): Lesson[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, student_name, subject, start_at, duration_minutes, cost, currency, link,
              notes, materials, materials_link, status, payment_status,
              recurrence_rule, recurrence_parent_id, recurrence_instance_date,
              color, created_at, updated_at
       FROM lessons`,
    )
    .all() as Record<string, unknown>[];
  db.close();
  return rows.map((r) => ({
    id: String(r.id),
    studentName: String(r.student_name ?? ""),
    subject: String(r.subject ?? ""),
    startAt: String(r.start_at),
    durationMinutes: Number(r.duration_minutes ?? 60),
    cost: r.cost as number | null,
    currency: r.currency as Lesson["currency"],
    link: r.link as string | null,
    notes: String(r.notes ?? ""),
    materials: String(r.materials ?? ""),
    materialsLink: r.materials_link as string | null,
    status: String(r.status ?? "scheduled") as Lesson["status"],
    paymentStatus: String(r.payment_status ?? "unpaid") as Lesson["paymentStatus"],
    recurrenceRule: r.recurrence_rule as string | null,
    recurrenceParentId: r.recurrence_parent_id as string | null,
    recurrenceInstanceDate: r.recurrence_instance_date as string | null,
    color: r.color as string | null,
    students: [],
    reminders: [],
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  }));
}

describe.skipIf(!ready)("backend/frontend expansion parity (real DB copy)", () => {
  const dump = JSON.parse(readFileSync(outPath, "utf8")) as DumpRange[];
  const lessons = loadRows();

  for (const range of dump) {
    it(`matches for range "${range.name}"`, () => {
      const fe = expandLessons(lessons, new Date(range.from), new Date(range.to)).map((l) => [
        l.id,
        l.startAt,
      ]);
      const be = range.lessons.map((l) => [l.id, l.start]);
      if (JSON.stringify(fe) !== JSON.stringify(be)) {
        const feSet = new Set(fe.map((x) => x.join("|")));
        const beSet = new Set(be.map((x) => x.join("|")));
        const onlyFe = fe.filter((x) => !beSet.has(x.join("|")));
        const onlyBe = be.filter((x) => !feSet.has(x.join("|")));
        throw new Error(
          `parity mismatch for "${range.name}":\n` +
            `  only frontend: ${JSON.stringify(onlyFe)}\n` +
            `  only backend:  ${JSON.stringify(onlyBe)}`,
        );
      }
    });
  }
});
