import type { Lesson } from "@/types/lesson";
import { isSameDay } from "date-fns";

export const FULL_HOUR_HEIGHT = 72;
export const COMPACT_HOUR_HEIGHT = 10;

export interface HourSlot {
  hour: number;
  height: number;
  expanded: boolean;
}

export interface CalendarLayout {
  slots: HourSlot[];
  hourOffsets: number[];
  totalHeight: number;
}

export interface LessonColumnLayout {
  column: number;
  columns: number;
}

export function buildCalendarLayout(lessons: Lesson[], dayFilter?: Date): CalendarLayout {
  const activeHours = new Set<number>();

  const relevant = dayFilter
    ? lessons.filter((l) => isSameDay(new Date(l.startAt), dayFilter))
    : lessons;

  for (const lesson of relevant) {
    const start = new Date(lesson.startAt);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    // Keep overnight lessons inside the same day grid (up to 24:00).
    const endMinutes = Math.min(24 * 60, startMinutes + lesson.durationMinutes);
    const startHour = start.getHours();
    const endHour = Math.min(23, Math.floor((endMinutes - 1) / 60));
    for (let h = Math.max(0, startHour - 1); h <= Math.min(23, endHour + 1); h++) {
      activeHours.add(h);
    }
  }

  if (activeHours.size === 0) {
    for (let h = 8; h <= 20; h++) activeHours.add(h);
  }

  const slots: HourSlot[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    height: activeHours.has(hour) ? FULL_HOUR_HEIGHT : COMPACT_HOUR_HEIGHT,
    expanded: activeHours.has(hour),
  }));

  const hourOffsets: number[] = [];
  let y = 0;
  for (const slot of slots) {
    hourOffsets[slot.hour] = y;
    y += slot.height;
  }

  return { slots, hourOffsets, totalHeight: y };
}

export function buildWeekLayout(lessons: Lesson[], days: Date[]): CalendarLayout {
  const weekLessons = lessons.filter((l) => {
    const d = new Date(l.startAt);
    return days.some((day) => isSameDay(d, day));
  });
  return buildCalendarLayout(weekLessons);
}

export function lessonTop(start: Date, layout: CalendarLayout): number {
  const hour = Math.min(23, Math.max(0, start.getHours()));
  const slot = layout.slots[hour];
  const minuteFraction = (start.getMinutes() + start.getSeconds() / 60) / 60;
  return layout.hourOffsets[hour] + minuteFraction * slot.height;
}

/** Height across expanded/compact slots; overnight duration is clipped to 24:00. */
export function lessonHeight(durationMinutes: number, layout: CalendarLayout, start: Date): number {
  let remaining = Math.max(0, durationMinutes);
  let hour = start.getHours();
  let minute = start.getMinutes() + start.getSeconds() / 60;
  let height = 0;

  while (remaining > 0 && hour < 24) {
    const slot = layout.slots[hour];
    const minutesLeftInHour = 60 - minute;
    const used = Math.min(remaining, minutesLeftInHour);
    height += (used / 60) * slot.height;
    remaining -= used;
    hour += 1;
    minute = 0;
  }

  // Не раздуваем высоту: иначе короткий урок у края часа визуально заезжает
  // в соседнюю клетку (особенно при старте :30 / :45).
  return Math.max(height, 4);
}

/** Convert vertical delta (px) to minutes using expanded hour scale */
export function deltaYToMinutes(deltaY: number): number {
  return Math.round((deltaY / FULL_HOUR_HEIGHT) * 60 / 15) * 15;
}

/** Shift lesson start by drag delta; keep within the original calendar day. */
export function resolveNewStart(startAt: string | Date, deltaY: number): Date | null {
  const minutes = deltaYToMinutes(deltaY);
  if (minutes === 0) return null;
  const start = new Date(startAt);
  const day = start.getDate();
  start.setMinutes(start.getMinutes() + minutes);
  if (start.getDate() !== day) {
    start.setDate(day);
    if (minutes > 0) {
      start.setHours(23, 45, 0, 0);
    } else {
      start.setHours(0, 0, 0, 0);
    }
  }
  // Snap to 15 minutes
  const snapped = Math.round((start.getHours() * 60 + start.getMinutes()) / 15) * 15;
  start.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0);
  return start;
}

export function minutesToDeltaY(minutes: number): number {
  return (minutes / 60) * FULL_HOUR_HEIGHT;
}

/** Y-позиция в сетке дня → дата/время (с округлением до 15 мин) */
export function yOffsetToDate(day: Date, layout: CalendarLayout, offsetY: number): Date {
  const clampedY = Math.max(0, Math.min(offsetY, layout.totalHeight - 1));
  let hour = 8;
  let minutes = 0;

  for (let h = 0; h < 24; h++) {
    const slot = layout.slots[h];
    const slotTop = layout.hourOffsets[h];
    const slotBottom = slotTop + slot.height;
    if (clampedY >= slotTop && clampedY < slotBottom) {
      hour = h;
      if (slot.expanded && slot.height > 0) {
        const fraction = (clampedY - slotTop) / slot.height;
        minutes = Math.round((fraction * 60) / 15) * 15;
        if (minutes >= 60) {
          minutes = 0;
          hour = Math.min(23, hour + 1);
        }
      }
      break;
    }
    if (h === 23 && clampedY >= slotBottom) {
      hour = 23;
      minutes = 45;
    }
  }

  const result = new Date(day);
  result.setHours(hour, minutes, 0, 0);
  return result;
}

/** Side-by-side columns for overlapping lessons within one day. */
export function assignOverlapColumns(lessons: Lesson[]): Map<string, LessonColumnLayout> {
  const result = new Map<string, LessonColumnLayout>();
  if (lessons.length === 0) return result;

  const items = lessons
    .map((lesson) => {
      const start = new Date(lesson.startAt).getTime();
      return {
        lesson,
        start,
        end: start + lesson.durationMinutes * 60_000,
      };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Connected clusters of overlapping intervals
  const clusters: typeof items[] = [];
  let current: typeof items = [];
  let clusterEnd = -Infinity;

  for (const item of items) {
    if (current.length === 0 || item.start < clusterEnd) {
      current.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      clusters.push(current);
      current = [item];
      clusterEnd = item.end;
    }
  }
  if (current.length) clusters.push(current);

  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const assigned: { id: string; column: number }[] = [];

    for (const item of cluster) {
      let column = colEnds.findIndex((end) => end <= item.start);
      if (column === -1) {
        column = colEnds.length;
        colEnds.push(item.end);
      } else {
        colEnds[column] = item.end;
      }
      assigned.push({ id: item.lesson.id, column });
    }

    const columns = Math.max(1, colEnds.length);
    for (const entry of assigned) {
      result.set(entry.id, { column: entry.column, columns });
    }
  }

  return result;
}
