import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { api, overlapNamesFromError } from "@/lib/api";
import {
  overlapExcludeId,
  persistLessonChange,
  rescheduleSeriesFromInstance,
} from "@/lib/lessonActions";
import { parseLocalDateTime } from "@/lib/recurrence";
import { lessonEnd, parseTimeInput } from "@/lib/timeInput";
import type { Lesson } from "@/types/lesson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";

interface RescheduleState {
  lesson: Lesson | null;
  open: (lesson: Lesson) => void;
  close: () => void;
}

export const useRescheduleStore = create<RescheduleState>((set) => ({
  lesson: null,
  open: (lesson) => set({ lesson }),
  close: () => set({ lesson: null }),
}));

type Scope = "this" | "series";

export function RescheduleDialog() {
  const { t } = useTranslation();
  const { lesson, close } = useRescheduleStore();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [scope, setScope] = useState<Scope>("this");
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timeValid, setTimeValid] = useState(true);
  const [timePanelHost, setTimePanelHost] = useState<HTMLDivElement | null>(null);

  const isSeries =
    !!lesson &&
    (!!lesson.recurrenceRule ||
      !!lesson.recurrenceParentId ||
      lesson.id.includes("::"));

  useEffect(() => {
    if (!lesson) return;
    const start = new Date(lesson.startAt);
    setDate(format(start, "yyyy-MM-dd"));
    setTime(format(start, "HH:mm"));
    setScope("this");
    setWarning(null);
    setSaving(false);
    setTimeValid(true);
  }, [lesson]);

  const parsedTime = parseTimeInput(time);
  const start = date && parsedTime ? parseLocalDateTime(date, parsedTime) : null;
  const end = parsedTime && lesson ? lessonEnd(parsedTime, lesson.durationMinutes) : null;
  const endLabel = end ? (end.dayOffset > 0 ? `${end.end} (${t("timePicker.nextDay")})` : end.end) : "";

  useEffect(() => {
    if (!lesson) {
      setWarning(null);
      return;
    }
    const parsed = parseTimeInput(time);
    if (!date || !parsed) {
      setWarning(null);
      return;
    }
    const startIso = parseLocalDateTime(date, parsed).toISOString();
    const excludeId = overlapExcludeId(
      lesson,
      scope === "series" ? "thisAndFuture" : "this",
    );
    const duration = lesson.durationMinutes;
    const timer = setTimeout(() => {
      void api
        .checkOverlaps(startIso, duration, excludeId)
        .then((overlaps) =>
          setWarning(
            overlaps.length > 0
              ? `${t("lesson.overlap")}: ${overlaps.map((o) => o.studentName).join(", ")}`
              : null,
          ),
        )
        .catch(() => setWarning(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [lesson, date, time, scope, t]);

  const save = async () => {
    if (!lesson || !start || !timeValid) return;
    setSaving(true);
    try {
      const excludeId = overlapExcludeId(
        lesson,
        scope === "series" ? "thisAndFuture" : "this",
      );
      const overlaps = await api.checkOverlaps(
        start.toISOString(),
        lesson.durationMinutes,
        excludeId,
      );
      const force = overlaps.length > 0;
      if (scope === "series") {
        await rescheduleSeriesFromInstance(lesson, start, { force });
        useToastStore.getState().success(t("lesson.seriesMovedToast"));
      } else {
        await persistLessonChange(lesson, { startAt: start.toISOString() }, { force });
        useToastStore.getState().success(t("lesson.movedToast"));
      }
      close();
    } catch (e) {
      const names = overlapNamesFromError(e);
      if (names !== null) {
        setWarning(`${t("lesson.overlap")}: ${names}. ${t("lesson.overlapConfirm")}`);
      } else {
        throw e;
      }
    } finally {
      setSaving(false);
    }
  };

  const scopeCards: { value: Scope; title: string; desc: string }[] = [
    {
      value: "this",
      title: t("lesson.rescheduleThis"),
      desc: t("lesson.rescheduleScopeThis"),
    },
    {
      value: "series",
      title: t("lesson.rescheduleSeries"),
      desc: t("lesson.rescheduleScopeSeries"),
    },
  ];

  return (
    <Dialog open={Boolean(lesson)} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("lesson.rescheduleTitle")}</DialogTitle>
        </DialogHeader>
        {lesson && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{lesson.studentName}</p>
              <p className="text-muted-foreground">
                {t("lesson.rescheduleDuration", { minutes: lesson.durationMinutes })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="reschedule-date">{t("lesson.rescheduleDate")}</Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reschedule-time">{t("lesson.time")}</Label>
                <TimePicker
                  id="reschedule-time"
                  value={time}
                  onChange={setTime}
                  panelHost={timePanelHost}
                  describedBy={endLabel ? "reschedule-end-time" : undefined}
                  onValidityChange={setTimeValid}
                />
                {endLabel && parsedTime && (
                  <p id="reschedule-end-time" className="text-xs tabular-nums text-muted-foreground">
                    {parsedTime} → {endLabel}
                  </p>
                )}
              </div>
              <div ref={setTimePanelHost} className="col-span-2 empty:hidden" />
            </div>

            {isSeries && (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("lesson.rescheduleTitle")}>
                {scopeCards.map((card) => (
                  <button
                    key={card.value}
                    type="button"
                    aria-pressed={scope === card.value}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      scope === card.value
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted/50",
                    )}
                    onClick={() => setScope(card.value)}
                  >
                    <p className="text-sm font-medium">{card.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{card.desc}</p>
                  </button>
                ))}
              </div>
            )}

            {warning && (
              <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                <p>{warning}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={!start || !timeValid || saving} onClick={() => void save()}>
                {t("lesson.rescheduleAction")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
