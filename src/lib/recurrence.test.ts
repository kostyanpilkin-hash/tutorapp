import { describe, expect, it } from "vitest";
import { addDays, startOfDay, endOfDay } from "date-fns";
import {
  WEEKLY_RULE,
  expandLessons,
  parseLocalDateTime,
  realLessonId,
  defaultRange,
  isWeeklyRecurrence,
  buildWeeklyRule,
  countWeeklyOccurrencesFrom,
} from "./recurrence";
import type { Lesson } from "@/types/lesson";

function baseLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "parent-1",
    studentName: "Иван",
    subject: "Математика",
    startAt: parseLocalDateTime("2026-07-06", "15:00").toISOString(),
    durationMinutes: 60,
    notes: "",
    materials: "",
    status: "scheduled",
    paymentStatus: "unpaid",
    recurrenceRule: WEEKLY_RULE,
    students: [],
    reminders: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("parseLocalDateTime", () => {
  it("keeps local wall clock", () => {
    const d = parseLocalDateTime("2026-07-08", "10:00");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("expandLessons weekly", () => {
  it("expands weekly occurrences inside range", () => {
    const lesson = baseLesson();
    const from = startOfDay(new Date(2026, 6, 1));
    const to = endOfDay(new Date(2026, 6, 31));
    const expanded = expandLessons([lesson], from, to);
    expect(expanded.length).toBeGreaterThanOrEqual(3);
    expect(expanded.every((l) => new Date(l.startAt) >= from && new Date(l.startAt) <= to)).toBe(true);
    expect(expanded[0].id).toContain("::");
  });

  it("skips cancelled exception instances", () => {
    const parent = baseLesson();
    const first = parseLocalDateTime("2026-07-06", "15:00");
    const exception: Lesson = {
      ...parent,
      id: "exc-1",
      recurrenceRule: null,
      recurrenceParentId: parent.id,
      recurrenceInstanceDate: first.toISOString(),
      startAt: first.toISOString(),
      status: "cancelled",
    };
    const from = startOfDay(first);
    const to = endOfDay(addDays(first, 1));
    const expanded = expandLessons([parent, exception], from, to);
    expect(expanded.find((l) => l.startAt === first.toISOString())).toBeUndefined();
  });

  it("keeps a single exception when duplicates exist for one slot", () => {
    const parent = baseLesson();
    const first = parseLocalDateTime("2026-07-06", "15:00");
    const older: Lesson = {
      ...parent,
      id: "exc-old",
      recurrenceRule: null,
      recurrenceParentId: parent.id,
      recurrenceInstanceDate: first.toISOString(),
      startAt: first.toISOString(),
      status: "scheduled",
      updatedAt: "2026-07-06T10:00:00.000Z",
    };
    const newer: Lesson = {
      ...older,
      id: "exc-new",
      status: "completed",
      updatedAt: "2026-07-06T12:00:00.000Z",
    };
    const from = startOfDay(first);
    const to = endOfDay(first);
    const expanded = expandLessons([parent, older, newer], from, to);
    const atFirst = expanded.filter((l) => new Date(l.startAt).getTime() === first.getTime());
    expect(atFirst).toHaveLength(1);
    expect(atFirst[0].id).toBe("exc-new");
    expect(atFirst[0].status).toBe("completed");
  });

  it("hides original day when exception was moved to another day", () => {
    const parent = baseLesson({
      startAt: parseLocalDateTime("2026-08-13", "16:00").toISOString(),
      recurrenceRule: WEEKLY_RULE,
    });
    const original = parseLocalDateTime("2026-08-13", "16:00");
    const moved = parseLocalDateTime("2026-08-14", "16:00");
    const exception: Lesson = {
      ...parent,
      id: "exc-moved",
      recurrenceRule: null,
      recurrenceParentId: parent.id,
      recurrenceInstanceDate: original.toISOString(),
      startAt: moved.toISOString(),
      status: "scheduled",
    };

    const dayFrom = startOfDay(original);
    const dayTo = endOfDay(original);
    const onOriginalDay = expandLessons([parent, exception], dayFrom, dayTo);
    expect(onOriginalDay).toHaveLength(0);

    const nextFrom = startOfDay(moved);
    const nextTo = endOfDay(moved);
    const onMovedDay = expandLessons([parent, exception], nextFrom, nextTo);
    expect(onMovedDay).toHaveLength(1);
    expect(onMovedDay[0].id).toBe("exc-moved");
    expect(new Date(onMovedDay[0].startAt).getTime()).toBe(moved.getTime());
  });
});

describe("helpers", () => {
  it("detects weekly rule", () => {
    expect(isWeeklyRecurrence("FREQ=WEEKLY")).toBe(true);
    expect(isWeeklyRecurrence(null)).toBe(false);
  });

  it("extracts real lesson id", () => {
    expect(realLessonId("abc::2026-07-01T00:00:00.000Z")).toBe("abc");
    expect(realLessonId("abc")).toBe("abc");
  });

  it("builds week range from Monday", () => {
    const wednesday = new Date(2026, 6, 8, 12, 0, 0);
    const { from, to } = defaultRange("week", wednesday);
    expect(from.getDay()).toBe(1);
    expect(to.getDay()).toBe(0);
  });
});

describe("BYDAY UNTIL COUNT", () => {
  it("honours BYDAY for multiple weekdays", () => {
    const lesson = baseLesson({
      startAt: parseLocalDateTime("2026-07-06", "15:00").toISOString(),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE",
    });
    const from = startOfDay(new Date(2026, 6, 6));
    const to = endOfDay(new Date(2026, 6, 10));
    const expanded = expandLessons([lesson], from, to);
    const days = expanded.map((l) => new Date(l.startAt).getDay());
    expect(days).toEqual([1, 3]);
  });

  it("stops after COUNT occurrences", () => {
    const lesson = baseLesson({
      startAt: parseLocalDateTime("2026-07-06", "15:00").toISOString(),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3",
    });
    const from = startOfDay(new Date(2026, 6, 1));
    const to = endOfDay(new Date(2026, 7, 31));
    const expanded = expandLessons([lesson], from, to);
    expect(expanded).toHaveLength(3);
  });

  it("stops before UNTIL", () => {
    const until = parseLocalDateTime("2026-07-09", "00:00").toISOString();
    const lesson = baseLesson({
      startAt: parseLocalDateTime("2026-07-06", "15:00").toISOString(),
      recurrenceRule: `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=${until}`,
    });
    const from = startOfDay(new Date(2026, 6, 1));
    const to = endOfDay(new Date(2026, 7, 31));
    const expanded = expandLessons([lesson], from, to);
    expect(expanded).toHaveLength(2);
  });
});

describe("buildWeeklyRule", () => {
  it("builds BYDAY and COUNT", () => {
    expect(buildWeeklyRule({ bydays: [1, 3], count: 5 })).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5",
    );
  });
});

describe("countWeeklyOccurrencesFrom", () => {
  const anchor = parseLocalDateTime("2026-07-06", "15:00"); // Monday

  it("counts remaining occurrences under COUNT", () => {
    const rule = "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4";
    // occurrences: Jul 6, 8, 13, 15
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-06", "15:00"))).toBe(4);
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-08", "15:00"))).toBe(3);
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-13", "15:00"))).toBe(2);
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-15", "15:00"))).toBe(1);
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-20", "15:00"))).toBe(0);
  });

  it("honours UNTIL boundary", () => {
    const until = parseLocalDateTime("2026-07-13", "00:00").toISOString();
    const rule = `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=${until}`;
    // occurrences before until: Jul 6, 8 only
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-06", "00:00"))).toBe(2);
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-08", "15:00"))).toBe(1);
  });

  it("falls back to anchor weekday without BYDAY", () => {
    const rule = "FREQ=WEEKLY;COUNT=3";
    expect(countWeeklyOccurrencesFrom(rule, anchor, parseLocalDateTime("2026-07-13", "15:00"))).toBe(2);
  });
});
