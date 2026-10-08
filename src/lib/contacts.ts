export function formatInTimezone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function formatTimeInTimezone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Границы «сегодня» в указанном IANA-часовом поясе (не локаль ОС). */
export function todayBoundsInTimezone(timezone: string, now = new Date()): { from: Date; to: Date } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    if (!y || !m || !d) throw new Error("bad date");

    const utcGuess = Date.UTC(y, m - 1, d, 12, 0, 0);
    const asLocal = new Date(utcGuess);
    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(asLocal);
    const get = (t: string) => Number(localParts.find((p) => p.type === t)?.value);
    const offsetMs =
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
      utcGuess;

    const from = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);
    const to = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - offsetMs);
    return { from, to };
  } catch {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
}

export const COMMON_TIMEZONES = [
  "Europe/Moscow",
  "Europe/Minsk",
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Tbilisi",
  "Asia/Almaty",
];

export function getTimezoneOffset(timezone: string): string {
  try {
    // Simple mapping for common timezones
    const offsets: Record<string, number> = {
      "Europe/Moscow": 3,
      "Europe/Minsk": 3,
      "Europe/Warsaw": 1,
      "Europe/London": 0,
      "Europe/Berlin": 1,
      "America/New_York": -5,
      "America/Los_Angeles": -8,
      "Asia/Dubai": 4,
      "Asia/Tbilisi": 4,
      "Asia/Almaty": 6,
    };
    const tzOffset = offsets[timezone] ?? 0;
    const sign = tzOffset >= 0 ? "+" : "";
    return `GMT${sign}${tzOffset}`;
  } catch {
    return "";
  }
}

export function messengerUrl(messenger?: string | null, phone?: string | null): string | null {
  if (messenger) {
    const m = messenger.trim();
    if (m.startsWith("http://") || m.startsWith("https://")) return m;
    if (m.startsWith("@")) return `https://t.me/${m.slice(1)}`;
    if (m.includes("t.me/")) return m.startsWith("http") ? m : `https://${m}`;
    if (/^\+?\d[\d\s()-]{6,}$/.test(m)) {
      const digits = m.replace(/\D/g, "");
      return `https://t.me/+${digits}`;
    }
    return `https://t.me/${m}`;
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10) return `https://wa.me/${digits}`;
  }
  return null;
}
