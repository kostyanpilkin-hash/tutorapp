import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { addDays, format, parseISO } from "date-fns";
import { enUS, ru, be as beLocale } from "date-fns/locale";
import type { Lesson } from "@/types/lesson";
import type { FiredReminderEntry } from "@/lib/api";
import { api } from "@/lib/api";
import { loadExpandedLessons } from "@/lib/recurrence";
import { useShallow } from "zustand/react/shallow";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const locales = { ru, en: enUS, be: beLocale };

interface UpcomingReminderEntry {
  lessonId: string;
  instanceStart: string;
  minutesBefore: number;
  reminderAt: string;
  studentName: string;
  subject: string;
  link?: string | null;
}

function reminderKey(lessonId: string, instanceStart: string, minutesBefore: number): string {
  return `${lessonId}|${instanceStart}|${minutesBefore}`;
}

function parseSnoozeMap(raw: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function buildUpcomingReminders(
  lessons: Lesson[],
  snoozeMap: Record<string, string>,
  now: Date,
): UpcomingReminderEntry[] {
  return lessons
    .flatMap((lesson) =>
      lesson.reminders.map((reminder) => {
        const lessonStart = new Date(lesson.startAt);
        const baseReminderAt = new Date(lessonStart.getTime() - reminder.minutesBefore * 60_000);
        const snoozeUntilRaw = snoozeMap[reminderKey(lesson.id, lesson.startAt, reminder.minutesBefore)];
        const snoozeUntil = snoozeUntilRaw ? new Date(snoozeUntilRaw) : null;
        const effectiveReminderAt =
          snoozeUntil && !Number.isNaN(snoozeUntil.getTime()) && snoozeUntil > baseReminderAt
            ? snoozeUntil
            : baseReminderAt;
        return {
          lessonId: lesson.id,
          instanceStart: lesson.startAt,
          minutesBefore: reminder.minutesBefore,
          reminderAt: effectiveReminderAt.toISOString(),
          studentName: lesson.studentName,
          subject: lesson.subject,
          link: lesson.link,
        };
      }),
    )
    .filter((item) => new Date(item.reminderAt) >= now)
    .sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime());
}

export function RemindersPanel() {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const toast = useToastStore(
    useShallow((s) => ({ error: s.error, info: s.info, success: s.success })),
  );
  const [activeTab, setActiveTab] = useState<"upcoming" | "journal">("upcoming");
  const [upcoming, setUpcoming] = useState<UpcomingReminderEntry[]>([]);
  const [journal, setJournal] = useState<FiredReminderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const from = now;
      const to = addDays(now, 7);
      const [expandedRows, firedRows, settings] = await Promise.all([
        loadExpandedLessons(from, to),
        api.getFiredReminders(100),
        api.getSettings(),
      ]);
      const snoozeMap = parseSnoozeMap(settings.reminder_snooze);
      const expanded = expandedRows.filter((lesson) => lesson.status === "scheduled");
      setUpcoming(buildUpcomingReminders(expanded, snoozeMap, now));
      setJournal(firedRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const upcomingCount = useMemo(() => upcoming.length, [upcoming.length]);

  const handleSnooze = async (item: UpcomingReminderEntry) => {
    const key = reminderKey(item.lessonId, item.instanceStart, item.minutesBefore);
    setBusyKey(key);
    try {
      await api.snoozeReminder(item.lessonId, item.instanceStart, item.minutesBefore, 10);
      toast.success(t("reminders.snoozed"));
      await loadData();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("reminders.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("reminders.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
          {t("reminders.refresh")}
        </Button>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-card p-0.5">
        <Button
          size="sm"
          variant={activeTab === "upcoming" ? "default" : "ghost"}
          className="h-8 px-3 text-xs"
          onClick={() => setActiveTab("upcoming")}
        >
          {t("reminders.upcoming")} ({upcomingCount})
        </Button>
        <Button
          size="sm"
          variant={activeTab === "journal" ? "default" : "ghost"}
          className="h-8 px-3 text-xs"
          onClick={() => setActiveTab("journal")}
        >
          {t("reminders.journal")}
        </Button>
      </div>

      {activeTab === "upcoming" && (
        <div className="space-y-2">
          {loading && upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("finance.loading")}</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reminders.emptyUpcoming")}</p>
          ) : (
            upcoming.map((item) => {
              const itemKey = reminderKey(item.lessonId, item.instanceStart, item.minutesBefore);
              return (
                <div
                  key={itemKey}
                  className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {item.studentName}
                      {item.subject ? <span className="text-muted-foreground"> · {item.subject}</span> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("reminders.lessonAt")}: {format(parseISO(item.instanceStart), "d MMM yyyy, HH:mm", { locale })}
                    </p>
                    <p className={cn("text-sm", item.minutesBefore === 0 ? "text-primary" : "text-muted-foreground")}>
                      {t("reminders.reminderAt")}: {format(parseISO(item.reminderAt), "d MMM yyyy, HH:mm", { locale })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSnooze(item)}
                    disabled={busyKey === itemKey}
                  >
                    {t("reminders.snooze10m")}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "journal" && (
        <div className="space-y-2">
          {loading && journal.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("finance.loading")}</p>
          ) : journal.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reminders.emptyJournal")}</p>
          ) : (
            journal.map((item) => (
              <div
                key={reminderKey(item.lessonId, item.instanceStart, item.minutesBefore)}
                className="rounded-lg border border-border px-3 py-3"
              >
                <p className="font-medium">
                  {item.studentName || t("reminders.unknownStudent")}
                  {item.subject ? <span className="text-muted-foreground"> · {item.subject}</span> : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("reminders.lessonAt")}: {format(parseISO(item.instanceStart), "d MMM yyyy, HH:mm", { locale })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("reminders.firedAt")}: {format(parseISO(item.firedAt || item.instanceStart), "d MMM yyyy, HH:mm", { locale })}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
