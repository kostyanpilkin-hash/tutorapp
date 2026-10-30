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
import { addDays, startOfDay } from "date-fns";
import type { Lesson } from "@/types/lesson";

vi.mock("@/lib/api", () => ({ api: {} }));

import { isWeeklyRecurrence, parseByday, parseCount, parseUntil } from "@/lib/recurrence";

// ── Frozen reference: the legacy frontend expander (removed in G1-4b) ──
// Kept ONLY as the parity oracle for `occurrences::collect`.
// Production code must not import or copy this — the backend is the
// single source of truth now.

function sameInstant(a: string, b: Date | string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

function pickException(exceptions: Lesson[], occurrence: Date): Lesson | undefined {
  const matches = exceptions.filter(
    (e) => e.recurrenceInstanceDate && sameInstant(e.recurrenceInstanceDate, occurrence),
  );
  if (matches.length === 0) return undefined;
  const rank = (status: string) => {
    if (status === "completed") return 4;
    if (status === "no_show") return 3;
    if (status === "cancelled") return 2;
    return 1;
  };
  return matches.sort((a, b) => {
    const byStatus = rank(b.status) - rank(a.status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  })[0];
}

function matchesWeekday(day: Date, bydays: number[], anchorWeekday: number): boolean {
  if (bydays.length === 0) return day.getDay() === anchorWeekday;
  return bydays.includes(day.getDay());
}

function expandWeekly(
  lesson: Lesson,
  from: Date,
  to: Date,
  allLessons: Lesson[],
): { items: Lesson[]; usedExceptionIds: Set<string> } {
  const anchor = new Date(lesson.startAt);
  const hours = anchor.getHours();
  const minutes = anchor.getMinutes();
  const until = parseUntil(lesson.recurrenceRule);
  const count = parseCount(lesson.recurrenceRule);
  const bydays = parseByday(lesson.recurrenceRule);
  const anchorWeekday = anchor.getDay();

  const exceptions = allLessons.filter(
    (l) => l.recurrenceParentId === lesson.id && l.recurrenceInstanceDate,
  );

  const items: Lesson[] = [];
  const usedExceptionIds = new Set<string>();
  let cursor = startOfDay(anchor);
  let emitted = 0;
  const hardLimit = addDays(anchor, 366 * 5);

  while (cursor <= to && cursor <= hardLimit) {
    if (matchesWeekday(cursor, bydays, anchorWeekday)) {
      const occurrence = new Date(cursor);
      occurrence.setHours(hours, minutes, 0, 0);
      if (occurrence.getTime() < anchor.getTime() - 1000) {
        cursor = addDays(cursor, 1);
        continue;
      }
      emitted += 1;
      if (count != null && emitted > count) break;
      if (until && occurrence.getTime() >= until.getTime()) break;

      if (occurrence >= from && occurrence <= to) {
        const matches = exceptions.filter(
          (e) => e.recurrenceInstanceDate && sameInstant(e.recurrenceInstanceDate, occurrence),
        );
        for (const m of matches) usedExceptionIds.add(m.id);

        const exception = pickException(exceptions, occurrence);
        const instanceKey = occurrence.toISOString();

        if (exception) {
          if (exception.status !== "cancelled") {
            const exStart = new Date(exception.startAt);
            if (exStart >= from && exStart <= to) items.push(exception);
          }
        } else {
          items.push({
            ...lesson,
            id: `${lesson.id}::${instanceKey}`,
            startAt: instanceKey,
            recurrenceInstanceDate: instanceKey,
          });
        }
      }
    }
    cursor = addDays(cursor, 1);
  }

  return { items, usedExceptionIds };
}

function expandLessons(lessons: Lesson[], from: Date, to: Date): Lesson[] {
  const result: Lesson[] = [];
  const usedExceptionIds = new Set<string>();

  for (const lesson of lessons) {
    if (lesson.recurrenceParentId) continue;

    const start = new Date(lesson.startAt);

    if (!isWeeklyRecurrence(lesson.recurrenceRule)) {
      if (start >= from && start <= to) result.push(lesson);
      continue;
    }

    const expanded = expandWeekly(lesson, from, to, lessons);
    for (const id of expanded.usedExceptionIds) usedExceptionIds.add(id);
    result.push(...expanded.items);
  }

  for (const lesson of lessons) {
    if (!lesson.recurrenceParentId) continue;
    if (usedExceptionIds.has(lesson.id)) continue;
    if (lesson.status === "cancelled") continue;
    const start = new Date(lesson.startAt);
    if (start >= from && start <= to) result.push(lesson);
  }

  return result
    .filter((l) => {
      const start = new Date(l.startAt);
      return start >= from && start <= to;
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

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
