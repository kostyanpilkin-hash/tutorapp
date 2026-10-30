import type { QueryClient } from "@tanstack/react-query";

export const keys = {
  lessons: {
    range: (fromISO: string, toISO: string) =>
      ["lessons", "range", fromISO, toISO] as const,
    day: (fromISO: string, toISO: string) =>
      ["lessons", "day", fromISO, toISO] as const,
    detail: (id: string) => ["lessons", "detail", id] as const,
  },
  students: {
    all: (includeArchived: boolean) => ["students", "list", includeArchived] as const,
    detail: (id: string) => ["students", "detail", id] as const,
    finance: (id: string) => ["students", "finance", id] as const,
    lessons: (id: string) => ["students", "lessons", id] as const,
    expanded: (id: string, fromISO: string, toISO: string) =>
      ["students", "expanded", id, fromISO, toISO] as const,
    photo: (path: string) => ["students", "photo", path] as const,
  },
  messageTemplates: () => ["settings", "message_templates"] as const,
  finance: {
    report: (period: string, anchorISO: string, customFromISO?: string, customToISO?: string) =>
      ["finance", "report", period, anchorISO, customFromISO ?? "", customToISO ?? ""] as const,
    debts: () => ["finance", "debts"] as const,
  },
  activity: (category: string) => ["activity", category] as const,
  reminders: {
    fired: () => ["reminders", "fired"] as const,
  },
  settings: () => ["settings"] as const,
  phone: {
    links: () => ["phone", "links"] as const,
  },
  tg: {
    status: () => ["tg", "status"] as const,
  },
  meta: {
    dbPath: () => ["meta", "dbPath"] as const,
  },
};

/** Префиксы, которые покрывают все пользовательские данные приложения. */
const DATA_PREFIXES = [
  ["lessons"],
  ["finance"],
  ["students"],
  ["activity"],
  ["reminders"],
] as const;

/**
 * Инвалидация после любой мутации пользовательских данных
 * (урок/ученик/оплата): перечитывает все видимые виды.
 */
export function invalidateAppData(qc: QueryClient) {
  return Promise.all(
    DATA_PREFIXES.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
  );
}
