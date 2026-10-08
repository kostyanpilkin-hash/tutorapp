export type Currency = "USD" | "BYN" | "RUB" | "EUR";

export interface Student {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  messenger?: string | null;
  parents?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentMessenger?: string | null;
  birthDate?: string | null;
  notes: string;
  lessonNote: string;
  timezone?: string | null;
  defaultCost?: number | null;
  defaultCurrency?: Currency | null;
  defaultLink?: string | null;
  defaultDuration?: number | null;
  color?: string | null;
  photoPath?: string | null;
  paidLessons?: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  messenger?: string | null;
  parents?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentMessenger?: string | null;
  birthDate?: string | null;
  notes: string;
  lessonNote: string;
  timezone?: string | null;
  defaultCost?: number | null;
  defaultCurrency?: Currency | null;
  defaultLink?: string | null;
  defaultDuration?: number | null;
  color?: string | null;
  paidLessons?: number;
}

export function studentToInput(s: Student): StudentInput {
  return {
    name: s.name,
    phone: s.phone,
    email: s.email,
    messenger: s.messenger,
    parents: s.parents,
    parentName: s.parentName,
    parentPhone: s.parentPhone,
    parentMessenger: s.parentMessenger,
    birthDate: s.birthDate,
    notes: s.notes,
    lessonNote: s.lessonNote ?? "",
    timezone: s.timezone,
    defaultCost: s.defaultCost,
    defaultCurrency: s.defaultCurrency,
    defaultLink: s.defaultLink,
    defaultDuration: s.defaultDuration,
    color: s.color,
    paidLessons: s.paidLessons ?? 0,
  };
}

export interface StudentFinance {
  earned: { currency: string; amount: number }[];
  debt: { currency: string; amount: number }[];
  expected: { currency: string; amount: number }[];
}

export interface StudentSettingsLog {
  id: string;
  studentId: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  changedAt: string;
}

export interface DebtEntry {
  lessonId: string;
  studentId: string;
  studentName: string;
  subject: string;
  startAt: string;
  status: string;
  cost: number;
  currency: string;
}
