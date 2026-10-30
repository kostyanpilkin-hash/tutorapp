// IPC types are generated from Rust models via ts-rs (src/types/bindings).
import type { Student, StudentInput } from "./generated";
export type {
  Student,
  StudentInput,
  StudentFinance,
  ActivityLogEntry,
  StudentSettingsLog,
  DebtEntry,
} from "./generated";

export type Currency = "USD" | "BYN" | "RUB" | "EUR";

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
