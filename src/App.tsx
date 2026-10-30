import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { addDays, addMonths, format, subDays, subMonths } from "date-fns";
import { Bell, Calendar, ChevronLeft, ChevronRight, History, Plus, Settings, Users, Wallet } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { api } from "@/lib/api";
import { todayBoundsInTimezone } from "@/lib/contacts";
import { defaultRange, loadExpandedLessons } from "@/lib/recurrence";
import { keys } from "@/lib/queryKeys";
import type { CalendarView, Lesson } from "@/types/lesson";
import { TodayWidget } from "@/components/TodayWidget";
import { LessonFormDialog } from "@/components/lesson/LessonFormDialog";
import { RescheduleLessonDialog } from "@/components/lesson/RescheduleLessonDialog";
import { RescheduleSeriesDialog } from "@/components/lesson/RescheduleSeriesDialog";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { WeekView, MonthView } from "@/components/calendar/CalendarViews";
const FinancePanel = lazy(() =>
  import("@/components/finance/FinancePanel").then((m) => ({ default: m.FinancePanel })),
);
const HistoryPanel = lazy(() =>
  import("@/components/history/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);
import { RemindersPanel } from "@/components/reminders/RemindersPanel";
import { StudentsPanel } from "@/components/students/StudentsPanel";
import { ToastHost } from "@/components/ui/ToastHost";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";

type Page = "home" | "calendar" | "students" | "reminders" | "finance" | "history" | "settings";

export default function App() {
  const { t } = useTranslation();
  const {
    view,
    anchorDate,
    setView,
    setAnchorDate,
    load,
    loaded,
    language,
    timezone,
    onboardingDone,
    setOnboardingDone,
  } = useSettingsStore(
    useShallow((s) => ({
      view: s.view,
      anchorDate: s.anchorDate,
      setView: s.setView,
      setAnchorDate: s.setAnchorDate,
      load: s.load,
      loaded: s.loaded,
      language: s.language,
      timezone: s.timezone,
      onboardingDone: s.onboardingDone,
      setOnboardingDone: s.setOnboardingDone,
    })),
  );
  const queryClient = useQueryClient();
  const [page, setPage] = useState<Page>("home");
  const [todayDate, setTodayDate] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [createDate, setCreateDate] = useState<Date | undefined>();
  const [createStudentIds, setCreateStudentIds] = useState<string[] | undefined>();
  const [studentCount, setStudentCount] = useState<number | null>(null);

  const dayBounds = todayBoundsInTimezone(timezone, todayDate);
  const dayQuery = useQuery({
    queryKey: keys.lessons.day(dayBounds.from.toISOString(), dayBounds.to.toISOString()),
    queryFn: () => loadExpandedLessons(dayBounds.from, dayBounds.to),
    enabled: loaded && page === "home",
  });
  const todayLessons = useMemo(
    () =>
      [...(dayQuery.data ?? [])].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      ),
    [dayQuery.data],
  );
  const todayLoading = dayQuery.isPending;

  const range = defaultRange(view, anchorDate);
  const rangeQuery = useQuery({
    queryKey: keys.lessons.range(range.from.toISOString(), range.to.toISOString()),
    queryFn: () => loadExpandedLessons(range.from, range.to),
    enabled: loaded && page !== "home",
  });
  const expanded = rangeQuery.data ?? [];
  const loading = rangeQuery.isPending;

  const goToToday = useCallback(() => {
    setTodayDate(new Date());
    setPage("home");
  }, []);

  useEffect(() => {
    void load().then(() => i18n.changeLanguage(language));
  }, [load, language]);

  useEffect(() => {
    if (!loaded || onboardingDone) return;
    void api.getStudents(false).then((s) => setStudentCount(s.length)).catch(() => setStudentCount(0));
  }, [loaded, onboardingDone]);

  useEffect(() => {
    const unlisten = listen<{ link?: string; title?: string; body?: string }>("lesson-reminder", (event) => {
      const link = event.payload.link;
      useToastStore.getState().info(
        event.payload.body || t("today.reminderToast"),
        link
          ? {
              label: t("lesson.openLink"),
              onClick: () => {
                void openUrl(link);
              },
            }
          : undefined,
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  const openCreate = useCallback((date?: Date, studentIds?: string[]) => {
    const baseDate = page === "home" ? todayDate : anchorDate;
    if (date) {
      if (page === "home") setTodayDate(date);
      else setAnchorDate(date);
    }
    setSelectedLesson(null);
    setCreateDate(date || baseDate);
    setCreateStudentIds(studentIds);
    setFormOpen(true);
  }, [page, anchorDate, todayDate, setAnchorDate]);

  const openEdit = (lesson: Lesson) => {
    setSelectedLesson(lesson);
    setCreateStudentIds(undefined);
    setFormOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openCreate();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "1":
            e.preventDefault();
            goToToday();
            break;
          case "2":
            e.preventDefault();
            setPage("calendar");
            break;
          case "3":
            e.preventDefault();
            setPage("students");
            break;
          case "4":
            e.preventDefault();
            setPage("reminders");
            break;
          case "5":
            e.preventDefault();
            setPage("finance");
            break;
          case "6":
            e.preventDefault();
            setPage("settings");
            break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCreate, goToToday]);

  // Refresh data when the app regains focus (e.g. after bot actions).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void queryClient.invalidateQueries();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [queryClient]);

  const views: { id: CalendarView; label: string }[] = [
    { id: "week", label: t("views.week") },
    { id: "month", label: t("views.month") },
  ];

  const showOnboarding = loaded && !onboardingDone && studentCount === 0;

  return (
    <ContextMenuProvider>
      <div className="flex min-h-screen text-foreground" data-page={page}>
        <aside className="flex w-56 flex-col border-r border-border/80 bg-[var(--sidebar-bg)] p-4 backdrop-blur">
          <h1 className="font-display mb-6 text-2xl font-semibold tracking-tight text-primary">{t("app.title")}</h1>
          <nav className="flex flex-col gap-1">
            <Button variant={page === "home" ? "default" : "ghost"} className="justify-start" onClick={goToToday}>
              {t("app.today")}
            </Button>
            <Button variant={page === "calendar" ? "default" : "ghost"} className="justify-start" onClick={() => setPage("calendar")}>
              <Calendar className="mr-2 h-4 w-4" />{t("app.calendar")}
            </Button>
            <Button variant={page === "students" ? "default" : "ghost"} className="justify-start" onClick={() => setPage("students")}>
              <Users className="mr-2 h-4 w-4" />{t("app.students")}
            </Button>
            <Button variant={page === "reminders" ? "default" : "ghost"} className="justify-start" onClick={() => setPage("reminders")}>
              <Bell className="mr-2 h-4 w-4" />{t("app.reminders")}
            </Button>
            <Button variant={page === "finance" ? "default" : "ghost"} className="justify-start" onClick={() => setPage("finance")}>
              <Wallet className="mr-2 h-4 w-4" />{t("app.finance")}
            </Button>
            <Button variant={page === "history" ? "default" : "ghost"} className="justify-start" onClick={() => setPage("history")}>
              <History className="mr-2 h-4 w-4" />{t("app.history")}
            </Button>
            <Button variant={page === "settings" ? "default" : "ghost"} className="justify-start" onClick={() => setPage("settings")}>
              <Settings className="mr-2 h-4 w-4" />{t("app.settings")}
            </Button>
          </nav>
          <Button className="mt-auto" onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" />{t("lesson.new")}
          </Button>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden p-5">
          {showOnboarding && (
            <div className="animate-fade-up mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
              <h2 className="font-display mb-1 text-xl font-semibold">{t("onboarding.title")}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{t("onboarding.body")}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPage("students")}>{t("onboarding.addStudent")}</Button>
                <Button size="sm" variant="outline" onClick={() => openCreate()}>{t("onboarding.addLesson")}</Button>
                <Button size="sm" variant="ghost" onClick={() => void setOnboardingDone()}>{t("onboarding.skip")}</Button>
              </div>
            </div>
          )}

          {page === "home" && (
            <div className="mx-auto w-full max-w-3xl space-y-4 overflow-auto">
              <TodayWidget
                lessons={todayLessons}
                loading={todayLoading}
                activeDate={todayDate}
                onPrevDay={() => setTodayDate(subDays(todayDate, 1))}
                onNextDay={() => setTodayDate(addDays(todayDate, 1))}
                onSelect={openEdit}
                onCreate={() => openCreate()}
              />
            </div>
          )}

          {page === "calendar" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" onClick={() => setAnchorDate(view === "month" ? subMonths(anchorDate, 1) : subDays(anchorDate, view === "week" ? 7 : 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-display min-w-40 text-center text-lg font-semibold tracking-tight">
                    {format(anchorDate, view === "month" ? "LLLL yyyy" : "d MMMM yyyy")}
                  </span>
                  <Button size="icon" variant="outline" onClick={() => setAnchorDate(view === "month" ? addMonths(anchorDate, 1) : addDays(anchorDate, view === "week" ? 7 : 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAnchorDate(new Date())}>{t("finance.today")}</Button>
                </div>
                <div className="flex gap-1">
                  {views.map((v) => (
                    <Button key={v.id} size="sm" variant={view === v.id ? "default" : "outline"} onClick={() => setView(v.id)}>
                      {v.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="relative flex-1 overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-sm backdrop-blur">
                {loading && expanded.length === 0 && (
                  <div className="absolute inset-0 z-20 grid place-items-center bg-card/60 backdrop-blur-sm">
                    <div className="animate-pulse text-sm text-muted-foreground">{t("finance.loading")}</div>
                  </div>
                )}
                {view === "week" && (
                  <WeekView lessons={expanded} anchor={anchorDate} onSelect={openEdit} onCreate={openCreate} />
                )}
                {view === "month" && (
                  <MonthView
                    lessons={expanded}
                    anchor={anchorDate}
                    onSelect={openEdit}
                    onCreate={openCreate}
                  />
                )}
              </div>
            </>
          )}

          {page === "reminders" && <RemindersPanel />}
          {page === "history" && (
            <Suspense fallback={null}>
              <HistoryPanel />
            </Suspense>
          )}

          {page === "finance" && (
            <Suspense
              fallback={
                <div className="animate-pulse text-sm text-muted-foreground">
                  {t("finance.loading")}
                </div>
              }
            >
              <FinancePanel />
            </Suspense>
          )}

          {page === "students" && (
            <StudentsPanel
              onOpenLesson={(lesson) => {
                setSelectedLesson(lesson);
                setCreateStudentIds(undefined);
                setFormOpen(true);
              }}
              onCreateLesson={(studentId) => openCreate(undefined, [studentId])}
            />
          )}

          {page === "settings" && (
            <div className="mx-auto w-full max-w-lg">
              <SettingsPanel />
            </div>
          )}
        </main>

        <LessonFormDialog
          open={formOpen}
          lesson={selectedLesson}
          initialDate={createDate}
          initialStudentIds={createStudentIds}
          onClose={() => {
            setFormOpen(false);
            setCreateStudentIds(undefined);
          }}
          onSaved={() => {
            if (!onboardingDone) void setOnboardingDone();
            useToastStore.getState().info(t("lesson.savedToast"), {
              label: t("app.today"),
              onClick: goToToday,
            });
          }}
        />
        <RescheduleLessonDialog />
        <RescheduleSeriesDialog />
        <ToastHost />
      </div>
    </ContextMenuProvider>
  );
}
