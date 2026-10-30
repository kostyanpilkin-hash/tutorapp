import { addDays, endOfDay, startOfDay, startOfWeek } from "date-fns";
import type { Lesson } from "@/types/lesson";
import { api } from "@/lib/api";

export const WEEKLY_RULE = "FREQ=WEEKLY";

const BYDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export function isWeeklyRecurrence(rule: string | null | undefined): boolean {
  return !!rule && rule.includes("WEEKLY");
}

export function parseUntil(rule: string | null | undefined): Date | null {
  if (!rule) return null;
  for (const part of rule.split(";")) {
    const p = part.trim();
    if (!p.toUpperCase().startsWith("UNTIL=")) continue;
    const raw = p.slice(6);
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

export function parseCount(rule: string | null | undefined): number | null {
  if (!rule) return null;
  for (const part of rule.split(";")) {
    const p = part.trim();
    if (!p.toUpperCase().startsWith("COUNT=")) continue;
    const n = Number(p.slice(6));
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/** JS getDay() values (0=Sun … 6=Sat). Empty = only anchor weekday. */
export function parseByday(rule: string | null | undefined): number[] {
  if (!rule) return [];
  for (const part of rule.split(";")) {
    const p = part.trim();
    if (!p.toUpperCase().startsWith("BYDAY=")) continue;
    const codes = p.slice(6).split(",").map((c) => c.trim().toUpperCase());
    const days: number[] = [];
    for (const code of codes) {
      const idx = BYDAY_CODES.indexOf(code as (typeof BYDAY_CODES)[number]);
      if (idx >= 0) days.push(idx);
    }
    return days;
  }
  return [];
}

export function weekdayCode(day: number): string {
  return BYDAY_CODES[((day % 7) + 7) % 7];
}

export function buildWeeklyRule(options: {
  bydays?: number[];
  until?: Date | null;
  count?: number | null;
} = {}): string {
  const parts = ["FREQ=WEEKLY"];
  const bydays = options.bydays?.filter((d) => d >= 0 && d <= 6) ?? [];
  if (bydays.length > 0) {
    const unique = [...new Set(bydays)].sort((a, b) => a - b);
    parts.push(`BYDAY=${unique.map(weekdayCode).join(",")}`);
  }
  if (options.count && options.count > 0) {
    parts.push(`COUNT=${Math.floor(options.count)}`);
  } else if (options.until) {
    parts.push(`UNTIL=${options.until.toISOString()}`);
  }
  return parts.join(";");
}

export function withUntil(rule: string, until: Date): string {
  const base = rule
    .split(";")
    .filter((p) => {
      const u = p.toUpperCase();
      return !u.startsWith("UNTIL=") && !u.startsWith("COUNT=");
    })
    .join(";");
  return `${base};UNTIL=${until.toISOString()}`;
}

/** Локальная дата/время без сдвига UTC при вводе в форме */
export function parseLocalDateTime(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm ?? 0, 0, 0);
}

function matchesWeekday(day: Date, bydays: number[], anchorWeekday: number): boolean {
  if (bydays.length === 0) return day.getDay() === anchorWeekday;
  return bydays.includes(day.getDay());
}

/** Count occurrences of a weekly rule at or after fromDate (inclusive), honoring COUNT/UNTIL. */
export function countWeeklyOccurrencesFrom(
  rule: string,
  anchorStart: Date,
  fromDate: Date,
): number {
  const hours = anchorStart.getHours();
  const minutes = anchorStart.getMinutes();
  const until = parseUntil(rule);
  const count = parseCount(rule);
  const bydays = parseByday(rule);
  const anchorWeekday = anchorStart.getDay();
  const fromT = fromDate.getTime();

  let emitted = 0;
  let remaining = 0;
  let cursor = startOfDay(anchorStart);
  const hardLimit = addDays(anchorStart, 366 * 5);

  while (cursor <= hardLimit) {
    if (matchesWeekday(cursor, bydays, anchorWeekday)) {
      const occurrence = new Date(cursor);
      occurrence.setHours(hours, minutes, 0, 0);
      if (occurrence.getTime() < anchorStart.getTime() - 1000) {
        cursor = addDays(cursor, 1);
        continue;
      }
      emitted += 1;
      if (count != null && emitted > count) break;
      if (until && occurrence.getTime() >= until.getTime()) break;
      if (occurrence.getTime() >= fromT) remaining += 1;
    }
    cursor = addDays(cursor, 1);
  }
  return remaining;
}

export function defaultRange(view: string, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case "day":
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    case "week": {
      const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
      return { from: startOfDay(weekStart), to: endOfDay(addDays(weekStart, 6)) };
    }
    case "month": {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
      return { from: start, to: end };
    }
    default:
      return { from: startOfDay(anchor), to: endOfDay(addDays(anchor, 30)) };
  }
}

/**
 * Expanded occurrences for `[from, to]` — expanded on the backend
 * (single source of truth with the bot/phone page).
 */
export async function loadExpandedLessons(from: Date, to: Date): Promise<Lesson[]> {
  return api.getExpandedLessons(from.toISOString(), to.toISOString());
}

export function realLessonId(id: string): string {
  return id.includes("::") ? id.split("::")[0] : id;
}

export function isRecurrenceInstance(lesson: Pick<Lesson, "id" | "recurrenceParentId" | "recurrenceInstanceDate">): boolean {
  return lesson.id.includes("::") || !!lesson.recurrenceParentId;
}

export function parentLessonId(lesson: Pick<Lesson, "id" | "recurrenceParentId">): string {
  return lesson.recurrenceParentId || realLessonId(lesson.id);
}
