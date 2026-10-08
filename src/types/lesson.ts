export type LessonStatus = "scheduled" | "completed" | "cancelled" | "no_show";
export type PaymentStatus = "unpaid" | "paid";
export type Currency = "USD" | "BYN" | "RUB" | "EUR";
export type CalendarView = "day" | "week" | "month" | "agenda";
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
  | "plum";
export type FinancePeriod = "day" | "week" | "month" | "year" | "custom";

export interface Reminder {
  id: string;
  lessonId: string;
  minutesBefore: number;
}

export interface LessonStudent {
  studentId: string;
  name: string;
  cost?: number | null;
  currency?: Currency | null;
  paymentStatus: PaymentStatus;
  color?: string | null;
  timezone?: string | null;
  lessonNote: string;
}

export interface Lesson {
  id: string;
  studentName: string;
  subject: string;
  startAt: string;
  durationMinutes: number;
  cost?: number | null;
  currency?: Currency | null;
  link?: string | null;
  notes: string;
  materials: string;
  materialsLink?: string | null;
  status: LessonStatus;
  paymentStatus: PaymentStatus;
  recurrenceRule?: string | null;
  recurrenceParentId?: string | null;
  recurrenceInstanceDate?: string | null;
  color?: string | null;
  students: LessonStudent[];
  reminders: Reminder[];
  createdAt: string;
  updatedAt: string;
}

export interface LessonStudentInput {
  studentId: string;
  cost?: number | null;
  currency?: Currency | null;
  paymentStatus?: PaymentStatus | null;
}

export interface LessonInput {
  subject: string;
  startAt: string;
  durationMinutes: number;
  cost?: number | null;
  currency?: Currency | null;
  link?: string | null;
  notes: string;
  materials: string;
  materialsLink?: string | null;
  status: LessonStatus;
  paymentStatus: PaymentStatus;
  recurrenceRule?: string | null;
  recurrenceParentId?: string | null;
  recurrenceInstanceDate?: string | null;
  color?: string | null;
  students: LessonStudentInput[];
  reminders: number[];
  force?: boolean;
}

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
  };
}

export interface OverlapInfo {
  id: string;
  studentName: string;
  startAt: string;
  durationMinutes: number;
}

export type RecurrenceEditScope = "this" | "thisAndFuture" | "all";

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface SubjectAmount {
  subject: string;
  currency: string;
  earned: number;
  debt: number;
  expected: number;
}

export interface TimelinePoint {
  label: string;
  earned: number;
  debt: number;
  expected: number;
  currency: string;
}

export interface FinanceReport {
  period: string;
  from: string;
  to: string;
  earned: CurrencyAmount[];
  debt: CurrencyAmount[];
  expected: CurrencyAmount[];
  bySubject: SubjectAmount[];
  timeline: TimelinePoint[];
}

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
