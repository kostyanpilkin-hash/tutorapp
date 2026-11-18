import { openUrl } from "@tauri-apps/plugin-opener";
import { addDays, endOfDay } from "date-fns";
import { api } from "@/lib/api";
import {
  WEEKLY_RULE,
  buildWeeklyRule,
  countWeeklyOccurrencesFrom,
  isRecurrenceInstance,
  parentLessonId,
  parseByday,
  parseCount,
  parseUntil,
  withUntil,
} from "@/lib/recurrence";
import type { Lesson, LessonInput, LessonStatus, PaymentStatus } from "@/types/lesson";
import { lessonToInput } from "@/types/lesson";
import { queryClient } from "@/lib/queryClient";
import { invalidateAppData } from "@/lib/queryKeys";

export function lessonPaymentStatus(lesson: Lesson): PaymentStatus {
  if (lesson.students.length === 0) return lesson.paymentStatus as PaymentStatus;
  return lesson.students.every((s) => s.paymentStatus === "paid") ? "paid" : "unpaid";
}

export function isLessonNow(lesson: Lesson, now = new Date()): boolean {
  const start = new Date(lesson.startAt).getTime();
  const end = start + lesson.durationMinutes * 60_000;
  const t = now.getTime();
  return t >= start && t < end && lesson.status === "scheduled";
}

export function isLessonUpcoming(lesson: Lesson, now = new Date()): boolean {
  return new Date(lesson.startAt).getTime() > now.getTime() && lesson.status === "scheduled";
}

/** Кого исключать из overlap-проверки при редактировании/переносе. */
export function overlapExcludeId(
  lesson: Lesson,
  scope?: "this" | "thisAndFuture" | "all",
): string {
  if (scope === "all" || scope === "thisAndFuture") return parentLessonId(lesson);
  return lesson.id;
}

export async function persistLessonChange(
  lesson: Lesson,
  patch: Partial<LessonInput>,
  opts?: { force?: boolean },
): Promise<Lesson> {
  const base = lessonToInput(lesson);
  const force = opts?.force ?? false;
  const saved = lesson.id.includes("::")
    ? await api.createLesson({
        ...base,
        ...patch,
        recurrenceRule: null,
        recurrenceParentId: parentLessonId(lesson),
        recurrenceInstanceDate: lesson.recurrenceInstanceDate || lesson.startAt,
        force,
      })
    : await api.updateLesson(lesson.id, { ...base, ...patch, force });
  await invalidateAppData(queryClient);
  return saved;
}

export async function setLessonStatus(
  lesson: Lesson,
  status: LessonStatus,
  paymentStatus?: PaymentStatus,
): Promise<void> {
  const pay = paymentStatus ?? lesson.paymentStatus;
  await persistLessonChange(lesson, {
    status,
    paymentStatus: pay,
    students: lesson.students.map((s) => ({
      studentId: s.studentId,
      cost: s.cost,
      currency: s.currency,
      paymentStatus: paymentStatus ? pay : s.paymentStatus,
    })),
  });
}

export async function setLessonPaid(lesson: Lesson, paid: boolean): Promise<void> {
  const paymentStatus: PaymentStatus = paid ? "paid" : "unpaid";
  await persistLessonChange(lesson, {
    paymentStatus,
    students: lesson.students.map((s) => ({
      studentId: s.studentId,
      cost: s.cost,
      currency: s.currency,
      paymentStatus,
    })),
  });
}

export async function rescheduleLesson(
  lesson: Lesson,
  newStart: Date,
  opts?: { force?: boolean },
): Promise<void> {
  await persistLessonChange(lesson, { startAt: newStart.toISOString() }, opts);
}

export async function openLessonLink(lesson: Lesson): Promise<void> {
  if (lesson.link) await openUrl(lesson.link);
}

export async function copyLessonLink(lesson: Lesson): Promise<boolean> {
  if (!lesson.link) return false;
  await navigator.clipboard.writeText(lesson.link);
  return true;
}

export async function deleteLessonSeries(lesson: Lesson): Promise<{ archiveId: string }> {
  const parentId = parentLessonId(lesson);
  const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;
  const archiveId = await api.deleteLessonSeriesFromInstance(parentId, instanceDate);
  await invalidateAppData(queryClient);
  return { archiveId };
}

export async function restoreLessonArchive(archiveId: string): Promise<void> {
  await api.restoreLessonArchive(archiveId);
  await invalidateAppData(queryClient);
}

/**
 * Deletes a single lesson. For recurring instances creates a cancelled
 * exception so the slot stays suppressed. Returns an undo callback.
 */
export async function deleteLessonInstance(lesson: Lesson): Promise<{ undo: () => Promise<void> }> {
  const snapshot = lessonToInput(lesson);
  const parentId = parentLessonId(lesson);
  const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;
  const undoing = (fn: () => Promise<unknown>) => async () => {
    await fn();
    await invalidateAppData(queryClient);
  };

  if (lesson.recurrenceParentId && !lesson.id.includes("::")) {
    await api.updateLesson(lesson.id, { ...snapshot, status: "cancelled" });
    await invalidateAppData(queryClient);
    return { undo: undoing(() => api.updateLesson(lesson.id, snapshot)) };
  }

  if (isRecurrenceInstance(lesson) || lesson.recurrenceRule) {
    const created = await api.createLesson({
      ...snapshot,
      recurrenceRule: null,
      recurrenceParentId: parentId,
      recurrenceInstanceDate: instanceDate,
      status: "cancelled",
      startAt: instanceDate,
    });
    await invalidateAppData(queryClient);
    return { undo: undoing(() => api.deleteLesson(created.id)) };
  }

  await api.deleteLesson(lesson.id);
  await invalidateAppData(queryClient);
  return {
    undo: undoing(() =>
      api.createLesson({
        ...snapshot,
        recurrenceRule: null,
        recurrenceParentId: null,
        recurrenceInstanceDate: null,
      }),
    ),
  };
}

/**
 * Moves a recurring series "this and future": truncates the old series
 * before the earlier of (clicked instance, new start) and creates a new
 * series with the same weekdays starting at `newStart` (date AND time may
 * both change). Past lessons keep their history.
 */
export async function rescheduleSeriesFromInstance(
  lesson: Lesson,
  newStart: Date,
  opts?: { force?: boolean },
): Promise<void> {
  const parentId = parentLessonId(lesson);
  const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;
  const parent = await api.getLesson(parentId);

  const slot = new Date(instanceDate);
  if (newStart.getTime() === slot.getTime()) return;

  const oldRule = parent.recurrenceRule || WEEKLY_RULE;
  const oldCount = parseCount(oldRule);
  const remaining =
    oldCount != null ? countWeeklyOccurrencesFrom(oldRule, new Date(parent.startAt), slot) : null;

  if (oldCount != null && (remaining == null || remaining <= 0)) {
    await rescheduleLesson(lesson, newStart, opts);
    return;
  }

  const bydays = parseByday(oldRule);
  const newRule = buildWeeklyRule({
    bydays: bydays.length > 0 ? bydays : [newStart.getDay()],
    count: remaining,
    until: remaining == null ? parseUntil(oldRule) : null,
  });

  const input = lessonToInput(parent);
  const created = await api.createLesson({
    ...input,
    startAt: newStart.toISOString(),
    recurrenceRule: newRule,
    recurrenceParentId: null,
    recurrenceInstanceDate: null,
    force: opts?.force ?? false,
  });

  try {
    const until = endOfDay(addDays(slot < newStart ? slot : newStart, -1));
    await api.updateLesson(parentId, { ...input, recurrenceRule: withUntil(oldRule, until) });
    await invalidateAppData(queryClient);
  } catch (e) {
    await api.deleteLesson(created.id).catch(() => undefined);
    throw e;
  }
}
