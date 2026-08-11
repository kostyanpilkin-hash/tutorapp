import { useEffect, useMemo, useState } from "react";
import { format, isSameDay, startOfDay } from "date-fns";
import { ru, enUS, be as beLocale } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  UserX,
  Wallet,
} from "lucide-react";
import type { Lesson } from "@/types/lesson";
import { lessonDisplayColor, lessonStudentNames } from "@/types/lesson";
import { LessonStatusBadges } from "@/components/lesson/LessonStatusBadges";
import { useLessonContextMenu } from "@/components/lesson/useLessonContextMenu";
import { Button } from "@/components/ui/button";
import {
  copyLessonLink,
  isLessonNow,
  isLessonUpcoming,
  lessonPaymentStatus,
  openLessonLink,
  setLessonPaid,
  setLessonStatus,
} from "@/lib/lessonActions";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";

const locales = { ru, en: enUS, be: beLocale };

interface Props {
  lessons: Lesson[];
  loading?: boolean;
  onSelect: (lesson: Lesson) => void;
  onCreate: () => void;
  onChanged: () => void;
  activeDate: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-border/70 bg-card/80 p-4">
      <div className="mb-3 h-4 w-32 rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-16 rounded-lg bg-muted/80" />
        <div className="h-16 rounded-lg bg-muted/60" />
        <div className="h-16 rounded-lg bg-muted/40" />
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "now" | "next" | "debt" | "done";
}) {
  const tones = {
    now: "border-emerald-300/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    next: "border-sky-300/60 bg-sky-500/10 text-sky-800 dark:text-sky-200",
    debt: "border-amber-300/60 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    done: "border-border bg-card text-foreground",
  };
  return (
    <div className={cn("animate-fade-up rounded-xl border px-3 py-2", tones[tone])}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="font-display text-2xl font-semibold leading-none tracking-tight">{value}</div>
    </div>
  );
}

export function TodayWidget({
  lessons,
  loading,
  onSelect,
  onCreate,
  onChanged,
  activeDate,
  onPrevDay,
  onNextDay,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const { show } = useLessonContextMenu({ onOpen: onSelect, onChanged });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const { referenceNow, current, upcoming, debtCount, doneCount } = useMemo(() => {
    const referenceNow = isSameDay(activeDate, new Date()) ? now : startOfDay(activeDate);
    const current = lessons.filter((l) => isLessonNow(l, referenceNow));
    const upcoming = lessons.filter((l) => isLessonUpcoming(l, referenceNow));
    const debtCount = lessons.filter(
      (l) =>
        (l.status === "completed" || l.status === "no_show") &&
        lessonPaymentStatus(l) === "unpaid",
    ).length;
    const doneCount = lessons.filter((l) => l.status === "completed").length;
    return { referenceNow, current, upcoming, debtCount, doneCount };
  }, [lessons, now, activeDate]);

  const runAction = async (
    fn: () => Promise<void>,
    message: string,
    action?: { label: string; onClick: () => void },
  ) => {
    try {
      await fn();
      onChanged();
      useToastStore.getState().info(message, action);
    } catch {
      // api toasts errors
    }
  };

  if (loading && lessons.length === 0) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header className="animate-fade-up relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_55%)]" />
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={t("today.prevDay")}
              onClick={onPrevDay}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <p className="min-w-0 text-center text-sm text-muted-foreground">
              {format(activeDate, "EEEE, d MMMM", { locale })}
            </p>

            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={t("today.nextDay")}
              onClick={onNextDay}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="font-display mt-1 text-3xl font-semibold tracking-tight">
            {t("today.title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("today.subtitle")}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryChip label={t("today.now")} value={current.length} tone="now" />
            <SummaryChip label={t("today.upcoming")} value={upcoming.length} tone="next" />
            <SummaryChip label={t("today.debts")} value={debtCount} tone="debt" />
            <SummaryChip label={t("today.done")} value={doneCount} tone="done" />
          </div>
        </div>
      </header>

      {lessons.length === 0 ? (
        <div className="animate-fade-up rounded-2xl border border-dashed border-border bg-card/70 px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Clock3 className="h-6 w-6" />
          </div>
          <h3 className="font-display text-xl font-semibold">{t("today.emptyTitle")}</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t("today.emptyHint")}</p>
          <Button className="mt-4" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            {t("today.addLesson")}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {lessons.map((lesson, index) => {
            const color = lessonDisplayColor(lesson);
            const live = isLessonNow(lesson, referenceNow);
            const unpaid = lessonPaymentStatus(lesson) === "unpaid";
            const canComplete = lesson.status === "scheduled";

            return (
              <article
                key={lesson.id}
                className={cn(
                  "animate-fade-up group relative overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md",
                  live && "ring-2 ring-emerald-400/50",
                )}
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                onContextMenu={(e) => show(e, lesson)}
              >
                <div
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ backgroundColor: color || "var(--primary)" }}
                />
                <div className="flex flex-col gap-3 p-4 pl-5 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(lesson)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-semibold leading-tight">
                        {lessonStudentNames(lesson)}
                      </span>
                      {live && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          {t("today.now")}
                        </span>
                      )}
                      <LessonStatusBadges lesson={lesson} />
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {format(new Date(lesson.startAt), "HH:mm", { locale })}
                      {" · "}
                      {lesson.durationMinutes} {t("today.min")}
                      {lesson.subject ? ` · ${lesson.subject}` : ""}
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {canComplete && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void runAction(
                            () => setLessonStatus(lesson, "completed"),
                            t("today.markedCompleted"),
                            unpaid
                              ? {
                                  label: t("payment.paid"),
                                  onClick: () => {
                                    void runAction(() => setLessonPaid(lesson, true), t("today.markedPaid"));
                                  },
                                }
                              : undefined,
                          )
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {t("today.markDone")}
                      </Button>
                    )}
                    {canComplete && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void runAction(() => setLessonStatus(lesson, "no_show"), t("today.markedNoShow"))
                        }
                      >
                        <UserX className="h-4 w-4" />
                        {t("today.markNoShow")}
                      </Button>
                    )}
                    {unpaid && lesson.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void runAction(() => setLessonPaid(lesson, true), t("today.markedPaid"))
                        }
                      >
                        <Wallet className="h-4 w-4" />
                        {t("today.markPaid")}
                      </Button>
                    )}
                    {lesson.link && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("lesson.openLink")}
                          onClick={() => void openLessonLink(lesson)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("lesson.copyLink")}
                          onClick={() => {
                            void copyLessonLink(lesson).then((ok) => {
                              if (ok) useToastStore.getState().success(t("today.linkCopied"));
                            });
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
