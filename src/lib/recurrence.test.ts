import { describe, expect, it } from "vitest";
import {
  parseLocalDateTime,
  realLessonId,
  defaultRange,
  isWeeklyRecurrence,
  buildWeeklyRule,
  countWeeklyOccurrencesFrom,
} from "./recurrence";

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
