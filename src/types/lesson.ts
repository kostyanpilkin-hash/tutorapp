// IPC types are generated from Rust models via ts-rs (src/types/bindings).
// Domain unions and helpers stay here.
import type { Lesson, LessonInput } from "./generated";
export type {
  Reminder,
  LessonStudent,
  Lesson,
  LessonStudentInput,
  LessonInput,
  OverlapInfo,
  CurrencyAmount,
  SubjectAmount,
  TimelinePoint,
  FinanceReport,
} from "./generated";

export type LessonStatus = "scheduled" | "completed" | "cancelled" | "no_show";
export type PaymentStatus = "unpaid" | "paid";
export type Currency = "USD" | "BYN" | "RUB" | "EUR";
export type CalendarView = "week" | "month";
export type Theme =
  | "light"
  | "dark"
  | "colorful"
  | "mint"
  | "ink"
  | "indigo"
  | "contrast"
  | "forest"
  | "sand"
  | "rose"
  | "ocean"
  | "lavender"
  | "peach"
  | "graphite"
  | "midnight"
  | "ember"
  | "pine"
  | "plum"
  | "cupertino"
  | "discord"
  | "spotify"
  | "github"
  | "editor"
  | "slack"
  | "mac"
  | "notion"
  | "material"
  | "mica";
export type FinancePeriod = "day" | "week" | "month" | "year" | "custom";

export function lessonToInput(lesson: Lesson): LessonInput {
  return {
    subject: lesson.subject,
    startAt: lesson.startAt,
    durationMinutes: lesson.durationMinutes,
    cost: lesson.cost,
    currency: lesson.currency,
    link: lesson.link,
    notes: lesson.notes,
    materials: lesson.materials,
    materialsLink: lesson.materialsLink,
    status: lesson.status,
    paymentStatus: lesson.paymentStatus,
    recurrenceRule: lesson.recurrenceRule,
    recurrenceParentId: lesson.recurrenceParentId,
    recurrenceInstanceDate: lesson.recurrenceInstanceDate,
    color: lesson.color,
    students: lesson.students.map((s) => ({
      studentId: s.studentId,
      cost: s.cost,
      currency: s.currency,
      paymentStatus: s.paymentStatus,
    })),
    reminders: lesson.reminders.map((r) => r.minutesBefore),
    force: false,
  };
}

export type RecurrenceEditScope = "this" | "thisAndFuture" | "all";

export function lessonDisplayColor(lesson: Lesson): string | undefined {
  if (lesson.students.length > 0) {
    const studentColor = lesson.students.find((s) => s.color)?.color;
    if (studentColor) return studentColor;
  }
  return lesson.color ?? undefined;
}

export function lessonStudentNames(lesson: Lesson): string {
  if (lesson.students.length > 0) {
    return lesson.students.map((s) => s.name).join(", ");
  }
  return lesson.studentName;
}

export function lessonStudentNotes(lesson: Lesson): { name: string; note: string }[] {
  return lesson.students
    .filter((s) => s.lessonNote?.trim())
    .map((s) => ({ name: s.name, note: s.lessonNote.trim() }));
}
