import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { api, overlapNamesFromError } from "@/lib/api";
import { rescheduleLesson } from "@/lib/lessonActions";
import type { Lesson } from "@/types/lesson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToastStore } from "@/stores/toastStore";

interface RescheduleState {
  lesson: Lesson | null;
  onChanged?: () => void;
  open: (lesson: Lesson, onChanged: () => void) => void;
  close: () => void;
}

export const useRescheduleLessonStore = create<RescheduleState>((set) => ({
  lesson: null,
  onChanged: undefined,
  open: (lesson, onChanged) => set({ lesson, onChanged }),
  close: () => set({ lesson: null, onChanged: undefined }),
}));

const START_HOUR = 7;
const END_HOUR = 24;

function startAt(date: string, hour: number, minute: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function slotLabel(date: Date, durationMinutes: number): string {
  const end = new Date(date.getTime() + durationMinutes * 60_000);
  return `${format(date, "HH:mm")}–${format(end, "HH:mm")}`;
}

export function RescheduleLessonDialog() {
  const { t } = useTranslation();
  const { lesson, onChanged, close } = useRescheduleLessonStore();
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Date[]>([]);
  const [selected, setSelected] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lesson) return;
    setDate(format(new Date(lesson.startAt), "yyyy-MM-dd"));
    setSelected(null);
  }, [lesson]);

  useEffect(() => {
    if (!lesson || !date) return;
    let cancelled = false;
    setLoading(true);
    setSelected(null);

    const candidates: Date[] = [];
    for (let minutes = START_HOUR * 60; minutes + lesson.durationMinutes <= END_HOUR * 60; minutes += 30) {
      candidates.push(startAt(date, Math.floor(minutes / 60), minutes % 60));
    }

    void Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        overlaps: await api.checkOverlaps(candidate.toISOString(), lesson.durationMinutes, lesson.id),
      })),
    )
      .then((results) => {
        if (!cancelled) setSlots(results.filter((result) => result.overlaps.length === 0).map((result) => result.candidate));
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date, lesson]);

  const save = async () => {
    if (!lesson || !selected) return;
    setSaving(true);
    try {
      const overlaps = await api.checkOverlaps(selected.toISOString(), lesson.durationMinutes, lesson.id);
      if (overlaps.length > 0) {
        setSelected(null);
        setSlots((current) => current.filter((slot) => slot.getTime() !== selected.getTime()));
        useToastStore.getState().error(t("lesson.rescheduleSlotUnavailable"));
        return;
      }
      await rescheduleLesson(lesson, selected);
      onChanged?.();
      useToastStore.getState().success(t("lesson.movedToast"));
      close();
    } catch (e) {
      if (overlapNamesFromError(e) !== null) {
        setSelected(null);
        setSlots((current) => current.filter((slot) => slot.getTime() !== selected.getTime()));
        useToastStore.getState().error(t("lesson.rescheduleSlotUnavailable"));
      } else {
        throw e;
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(lesson)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xl">
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
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="reschedule-date">{t("lesson.rescheduleDate")}</label>
              <Input id="reschedule-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("lesson.rescheduleAvailableTime")}</p>
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("finance.loading")}</p>
              ) : slots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  {t("lesson.rescheduleNoSlots")}
                </p>
              ) : (
                <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                  {slots.map((slot) => (
                    <Button
                      key={slot.toISOString()}
                      type="button"
                      size="sm"
                      variant={selected?.getTime() === slot.getTime() ? "default" : "outline"}
                      onClick={() => setSelected(slot)}
                    >
                      {slotLabel(slot, lesson.durationMinutes)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>{t("common.cancel")}</Button>
              <Button type="button" disabled={!selected || loading || saving} onClick={() => void save()}>
                {t("lesson.rescheduleAction")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
