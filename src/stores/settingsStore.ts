import { create } from "zustand";
import type { CalendarView, Theme } from "@/types/lesson";
import { api } from "@/lib/api";

interface SettingsState {
  language: string;
  theme: Theme;
  timezone: string;
  defaultDuration: number;
  defaultReminders: number[];
  defaultCalendarView: CalendarView;
  view: CalendarView;
  anchorDate: Date;
  loaded: boolean;
  onboardingDone: boolean;
  load: () => Promise<void>;
  setLanguage: (lang: string) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setTimezone: (tz: string) => Promise<void>;
  setDefaultCalendarView: (view: CalendarView) => Promise<void>;
  setDefaultDuration: (minutes: number) => Promise<void>;
  setDefaultReminders: (minutes: number[]) => Promise<void>;
  setOnboardingDone: () => Promise<void>;
  setView: (view: CalendarView) => void;
  setAnchorDate: (date: Date) => void;
}

const VALID_VIEWS: CalendarView[] = ["day", "week", "month", "agenda"];
const VALID_THEMES: Theme[] = [
  "light",
  "dark",
  "colorful",
  "mint",
  "ink",
  "indigo",
  "contrast",
  "forest",
  "sand",
  "rose",
  "ocean",
];

function parseTheme(value: string | undefined): Theme {
  if (value && VALID_THEMES.includes(value as Theme)) {
    return value as Theme;
  }
  return "light";
}

function parseReminders(raw: string | undefined): number[] {
  try {
    const parsed = JSON.parse(raw || "[1440,15,0]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => !Number.isNaN(n)) : [1440, 15, 0];
  } catch {
    return [1440, 15, 0];
  }
}

function parseCalendarView(value: string | undefined): CalendarView {
  if (value && VALID_VIEWS.includes(value as CalendarView)) {
    return value as CalendarView;
  }
  return "week";
}

export const useSettingsStore = create<SettingsState>((set) => ({
  language: "ru",
  theme: "light",
  timezone: "Europe/Moscow",
  defaultDuration: 60,
  defaultReminders: [1440, 15, 0],
  defaultCalendarView: "week",
  view: "week",
  anchorDate: new Date(),
  loaded: false,
  onboardingDone: true,

  load: async () => {
    const s = await api.getSettings();
    const theme = parseTheme(s.theme);
    const defaultCalendarView = parseCalendarView(s.default_calendar_view);
    document.documentElement.className = `theme-${theme}`;
    set({
      language: s.language || "ru",
      theme,
      timezone: s.timezone || "Europe/Moscow",
      defaultDuration: Number(s.default_duration || 60),
      defaultReminders: parseReminders(s.default_reminders),
      defaultCalendarView,
      view: defaultCalendarView,
      onboardingDone: s.onboarding_done === "1",
      loaded: true,
    });
  },

  setLanguage: async (language) => {
    await api.setSetting("language", language);
    set({ language });
  },

  setTheme: async (theme) => {
    await api.setSetting("theme", theme);
    document.documentElement.className = `theme-${theme}`;
    set({ theme });
  },

  setTimezone: async (timezone) => {
    await api.setSetting("timezone", timezone);
    set({ timezone });
  },

  setDefaultCalendarView: async (defaultCalendarView) => {
    await api.setSetting("default_calendar_view", defaultCalendarView);
    set({ defaultCalendarView, view: defaultCalendarView });
  },

  setDefaultDuration: async (minutes) => {
    const value = Math.max(15, Math.min(240, Math.round(minutes)));
    await api.setSetting("default_duration", String(value));
    set({ defaultDuration: value });
  },

  setDefaultReminders: async (minutes) => {
    const cleaned = minutes.filter((n) => Number.isFinite(n) && n >= 0);
    await api.setSetting("default_reminders", JSON.stringify(cleaned));
    set({ defaultReminders: cleaned });
  },

  setOnboardingDone: async () => {
    await api.setSetting("onboarding_done", "1");
    set({ onboardingDone: true });
  },

  setView: (view) => set({ view }),
  setAnchorDate: (anchorDate) => set({ anchorDate }),
}));
