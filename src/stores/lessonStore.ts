import { create } from "zustand";
import type { Lesson } from "@/types/lesson";
import { todayBoundsInTimezone } from "@/lib/contacts";
import { loadExpandedLessons } from "@/lib/recurrence";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";

interface LessonState {
  lessons: Lesson[];
  expanded: Lesson[];
  todayLessons: Lesson[];
  loading: boolean;
  todayLoading: boolean;
  error: string | null;
  fetchRange: (from: Date, to: Date) => Promise<void>;
  fetchDay: (baseDate: Date) => Promise<void>;
  refresh: (from: Date, to: Date) => Promise<void>;
}

function sortTodayLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
}

async function loadDayExpanded(baseDate: Date): Promise<Lesson[]> {
  const timezone = useSettingsStore.getState().timezone || "Europe/Moscow";
  const { from, to } = todayBoundsInTimezone(timezone, baseDate);
  return loadExpandedLessons(from, to);
}

export const useLessonStore = create<LessonState>((set) => ({
  lessons: [],
  expanded: [],
  todayLessons: [],
  loading: false,
  todayLoading: false,
  error: null,

  fetchRange: async (from, to) => {
    set({ loading: true, error: null });
    try {
      const expanded = await loadExpandedLessons(from, to);
      set({ lessons: expanded, expanded, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  fetchDay: async (baseDate) => {
    set({ todayLoading: true });
    try {
      const expanded = await loadDayExpanded(baseDate);
      set({ todayLessons: sortTodayLessons(expanded), error: null, todayLoading: false });
    } catch {
      set({ todayLessons: [], todayLoading: false });
    }
  },

  refresh: async (from, to) => {
    set({ loading: true, todayLoading: true });
    try {
      const [expanded, todayExpanded] = await Promise.all([
        loadExpandedLessons(from, to),
        loadDayExpanded(new Date()),
      ]);
      set({
        lessons: expanded,
        expanded,
        todayLessons: sortTodayLessons(todayExpanded),
        error: null,
        loading: false,
        todayLoading: false,
      });
    } catch (e) {
      set({ loading: false, todayLoading: false, error: String(e) });
      useToastStore.getState().error("Не удалось обновить занятия");
    }
  },
}));
