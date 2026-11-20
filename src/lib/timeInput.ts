/**
 * Парсер свободного ввода времени → "HH:mm" (24h) или null.
 * Принимает: "17:35", "9:5", "17:", "1735", "935", "9", "07", " 12 : 30 ".
 */
export function parseTimeInput(raw: string): string | null {
  const s = raw.replace(/\s+/g, "");
  if (!s) return null;
  let h: number;
  let m: number;
  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length !== 2) return null;
    const [hs, ms] = parts;
    if (!/^\d{1,2}$/.test(hs)) return null;
    if (ms !== "" && !/^\d{1,2}$/.test(ms)) return null;
    h = Number(hs);
    m = ms === "" ? 0 : Number(ms);
  } else if (/^\d{3,4}$/.test(s)) {
    const digits = s.length === 3 ? `0${s}` : s;
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2));
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * End of a lesson that starts at `start` ("HH:mm") and lasts `minutes`:
 * wall-clock "HH:mm" plus how many days later it ends (0 = same day).
 */
export function lessonEnd(start: string, minutes: number): { end: string; dayOffset: number } | null {
  const parsed = parseTimeInput(start);
  if (!parsed || !Number.isFinite(minutes) || minutes <= 0) return null;
  const [h, m] = parsed.split(":").map(Number);
  const total = h * 60 + m + Math.round(minutes);
  const inDay = total % 1440;
  return {
    end: `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`,
    dayOffset: Math.floor(total / 1440),
  };
}
