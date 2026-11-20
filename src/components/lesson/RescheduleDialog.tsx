import { useEffect, useRef, useState } from "react";
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
import { conflictFor, createGeneration, mayForce, overlapKey, singleFlight, type OverlapConflict, type PreviewState } from "@/lib/dialogOperation";
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
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [conflict, setConflict] = useState<OverlapConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const confirmedRef = useRef<OverlapConflict | null>(null);
  const [session] = useState(createGeneration);
  const [previews] = useState(createGeneration);
  const sessionRef = useRef(0);
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
    setPreview({ kind: "idle" });
    setConflict(null);
    confirmedRef.current = null;
    setTimeValid(true);
  }, [lesson]);

  useEffect(() => {
    sessionRef.current = session.begin();
  }, [lesson?.id, session]);

  const parsedTime = parseTimeInput(time);
  const start = date && parsedTime ? parseLocalDateTime(date, parsedTime) : null;
  const end = parsedTime && lesson ? lessonEnd(parsedTime, lesson.durationMinutes) : null;
  const endLabel = end ? (end.dayOffset > 0 ? `${end.end} (${t("timePicker.nextDay")})` : end.end) : "";

  const payloadFor = (startAt: Date) => ({
    startAt: startAt.toISOString(),
    durationMinutes: lesson?.durationMinutes ?? 0,
    scope,
  });

  useEffect(() => {
    const parsed = parseTimeInput(time);
    if (!lesson || !date || !parsed) {
      previews.begin();
      setPreview({ kind: "idle" });
      return;
    }
    const startIso = parseLocalDateTime(date, parsed).toISOString();
    const excludeId = overlapExcludeId(lesson, scope === "series" ? "thisAndFuture" : "this");
    const duration = lesson.durationMinutes;
    const gen = previews.begin();
    setPreview({ kind: "checking" });
    const timer = setTimeout(() => {
      api
        .checkOverlaps(startIso, duration, excludeId)
        .then((overlaps) => {
          if (!previews.isCurrent(gen)) return;
          setPreview(
            overlaps.length > 0
              ? { kind: "conflict", names: overlaps.map((o) => o.studentName).join(", ") }
              : { kind: "clear" },
          );
        })
        .catch(() => {
          if (previews.isCurrent(gen)) setPreview({ kind: "error" });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      previews.begin();
    };
  }, [lesson, date, time, scope, previews]);

  const [saveFlight] = useState(() =>
    singleFlight(async (run: () => Promise<void>) => {
      setSaving(true);
      try {
        await run();
      } catch {
        // api.call has already shown the error; the dialog stays for a retry.
      } finally {
        setSaving(false);
      }
    }),
  );

  const doSave = async () => {
    if (!lesson || !start || !timeValid) return;
    const sid = sessionRef.current;
    const live = () => session.isCurrent(sid);
    const payload = payloadFor(start);
    const showConflict = (names: string) => {
      confirmedRef.current = null;
      setConflict({ key: overlapKey(payload), names, confirmed: false });
    };
    const force = mayForce(confirmedRef.current, payload);
    if (!force) {
      const overlaps = await api.checkOverlaps(
        payload.startAt,
        payload.durationMinutes,
        overlapExcludeId(lesson, scope === "series" ? "thisAndFuture" : "this"),
      );
      if (!live()) return;
      if (overlaps.length > 0) {
        showConflict(overlaps.map((o) => o.studentName).join(", "));
        return;
      }
    }
    try {
      if (scope === "series") {
        await rescheduleSeriesFromInstance(lesson, start, { force });
        useToastStore.getState().success(t("lesson.seriesMovedToast"));
      } else {
        await persistLessonChange(lesson, { startAt: payload.startAt }, { force });
        useToastStore.getState().success(t("lesson.movedToast"));
      }
    } catch (e) {
      const names = overlapNamesFromError(e);
      if (names === null) throw e;
      if (live()) showConflict(names);
      return;
    }
    if (live()) close();
  };

  const save = () => void saveFlight(doSave);

  const confirmOverlap = () => {
    if (!conflict) return;
    confirmedRef.current = { ...conflict, confirmed: true };
    save();
  };

  const visibleConflict = start ? conflictFor(conflict, payloadFor(start)) : null;

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

            {visibleConflict ? (
              <div role="alert" className="space-y-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                <p>{`${t("lesson.overlap")}: ${visibleConflict.names}. ${t("lesson.overlapConfirm")}`}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  disabled={saving || !timeValid}
                  onClick={confirmOverlap}
                >
                  {t("lesson.rescheduleAnyway")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {preview.kind === "checking" && t("lesson.overlapChecking")}
                {preview.kind === "clear" && t("lesson.overlapFree")}
                {preview.kind === "error" && t("lesson.overlapCheckFailed")}
                {preview.kind === "conflict" && (
                  <span className="text-amber-700 dark:text-amber-400">{`${t("lesson.overlap")}: ${preview.names}`}</span>
                )}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={!start || !timeValid || saving} aria-busy={saving} onClick={save}>
                {saving ? t("lesson.saving") : t("lesson.rescheduleAction")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
