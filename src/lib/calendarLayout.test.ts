import { describe, expect, it } from "vitest";
import {
  buildCalendarLayout,
  deltaYToMinutes,
  yOffsetToDate,
  lessonHeight,
  lessonTop,
  assignOverlapColumns,
  FULL_HOUR_HEIGHT,
} from "./calendarLayout";
import type { Lesson } from "@/types/lesson";

function lessonAt(hours: number, minutes = 0): Lesson {
  const d = new Date(2026, 6, 8, hours, minutes, 0, 0);
  return {
    id: `l-${hours}`,
    studentName: "A",
    subject: "",
    startAt: d.toISOString(),
    durationMinutes: 60,
    cost: null,
    currency: null,
    link: null,
    materialsLink: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    recurrenceInstanceDate: null,
    color: null,
    notes: "",
    materials: "",
    status: "scheduled",
    paymentStatus: "unpaid",
    students: [],
    reminders: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("calendarLayout", () => {
  it("expands hours around lessons", () => {
    const layout = buildCalendarLayout([lessonAt(10)], new Date(2026, 6, 8));
    expect(layout.slots[10].expanded).toBe(true);
    expect(layout.slots[10].height).toBe(FULL_HOUR_HEIGHT);
  });

  it("snaps deltaY to 15 minutes", () => {
    expect(deltaYToMinutes(FULL_HOUR_HEIGHT)).toBe(60);
    expect(deltaYToMinutes(FULL_HOUR_HEIGHT / 4)).toBe(15);
  });

  it("maps y offset back to time", () => {
    const day = new Date(2026, 6, 8);
    const layout = buildCalendarLayout([lessonAt(10)], day);
    const atTen = yOffsetToDate(day, layout, layout.hourOffsets[10] + 1);
    expect(atTen.getHours()).toBe(10);
  });

  it("keeps late-evening lesson height inside the day", () => {
    const day = new Date(2026, 6, 8);
    const late = lessonAt(23);
    late.durationMinutes = 90;
    const layout = buildCalendarLayout([late], day);
    const height = lessonHeight(90, layout, new Date(late.startAt));
    expect(height).toBeGreaterThan(44);
    expect(height).toBeLessThanOrEqual(FULL_HOUR_HEIGHT);
  });

  it("does not inflate mid-hour short lessons past the next hour line", () => {
    const day = new Date(2026, 6, 8);
    const short = lessonAt(15, 45);
    short.durationMinutes = 15;
    const layout = buildCalendarLayout([short], day);
    const start = new Date(short.startAt);
    const top = layout.hourOffsets[15] + (45 / 60) * FULL_HOUR_HEIGHT;
    const height = lessonHeight(15, layout, start);
    expect(top + height).toBeLessThanOrEqual(layout.hourOffsets[16] + 0.5);
  });

  it("places a :30 start halfway through the hour cell", () => {
    const day = new Date(2026, 6, 8);
    const mid = lessonAt(15, 30);
    const layout = buildCalendarLayout([mid], day);
    const start = new Date(mid.startAt);
    const top = lessonTop(start, layout);
    expect(top).toBe(layout.hourOffsets[15] + FULL_HOUR_HEIGHT / 2);
  });

  it("assigns side-by-side columns for overlapping lessons", () => {
    const a = lessonAt(10, 0);
    const b = lessonAt(10, 30);
    b.id = "l-overlap";
    const cols = assignOverlapColumns([a, b]);
    expect(cols.get(a.id)?.columns).toBe(2);
    expect(cols.get(b.id)?.columns).toBe(2);
    expect(cols.get(a.id)?.column).not.toBe(cols.get(b.id)?.column);
  });
});
