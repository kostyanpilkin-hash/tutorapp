import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@/lib/api";
import { parentLessonId } from "@/lib/recurrence";
import type { Lesson, LessonInput, LessonStatus, PaymentStatus } from "@/types/lesson";
import { lessonToInput } from "@/types/lesson";

export function lessonPaymentStatus(lesson: Lesson): PaymentStatus {
  if (lesson.students.length === 0) return lesson.paymentStatus;
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

export async function persistLessonChange(
  lesson: Lesson,
  patch: Partial<LessonInput>,
): Promise<Lesson> {
  const base = lessonToInput(lesson);
  if (lesson.id.includes("::")) {
    return api.createLesson({
      ...base,
      ...patch,
      recurrenceRule: null,
      recurrenceParentId: parentLessonId(lesson),
      recurrenceInstanceDate: lesson.recurrenceInstanceDate || lesson.startAt,
    });
  }
  return api.updateLesson(lesson.id, { ...base, ...patch });
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

export async function rescheduleLesson(lesson: Lesson, newStart: Date): Promise<void> {
  await persistLessonChange(lesson, { startAt: newStart.toISOString() });
}

export async function openLessonLink(lesson: Lesson): Promise<void> {
  if (lesson.link) await openUrl(lesson.link);
}

export async function copyLessonLink(lesson: Lesson): Promise<boolean> {
  if (!lesson.link) return false;
  await navigator.clipboard.writeText(lesson.link);
  return true;
}

export async function deleteLessonSeries(lesson: Lesson): Promise<void> {
  const parentId = lesson.recurrenceParentId || (lesson.id.includes("::") ? lesson.id.split("::")[0] : lesson.id);
  await api.deleteLessonSeries(parentId);
}
