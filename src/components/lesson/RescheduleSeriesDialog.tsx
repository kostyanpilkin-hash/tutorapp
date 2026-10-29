import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { overlapNamesFromError } from "@/lib/api";
import { rescheduleSeriesFromInstance } from "@/lib/lessonActions";
import type { Lesson } from "@/types/lesson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToastStore } from "@/stores/toastStore";

interface RescheduleSeriesState {
  lesson: Lesson | null;
  onChanged?: () => void;
  open: (lesson: Lesson, onChanged: () => void) => void;
  close: () => void;
}

export const useRescheduleSeriesStore = create<RescheduleSeriesState>((set) => ({
  lesson: null,
  onChanged: undefined,
  open: (lesson, onChanged) => set({ lesson, onChanged }),
  close: () => set({ lesson: null, onChanged: undefined }),
}));

export function RescheduleSeriesDialog() {
  const { t } = useTranslation();
  const { lesson, onChanged, close } = useRescheduleSeriesStore();
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lesson) return;
    const slot = new Date(lesson.recurrenceInstanceDate || lesson.startAt);
    setTime(format(slot, "HH:mm"));
  }, [lesson]);

  const save = async () => {
    if (!lesson || !time) return;
    setSaving(true);
    try {
      await rescheduleSeriesFromInstance(lesson, time);
      onChanged?.();
      useToastStore.getState().success(t("lesson.seriesMovedToast"));
      close();
    } catch (e) {
      if (overlapNamesFromError(e) !== null) {
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("lesson.rescheduleSeriesTitle")}</DialogTitle>
        </DialogHeader>
        {lesson && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{lesson.studentName}</p>
              <p className="text-muted-foreground">
                {t("lesson.rescheduleSeriesHint", {
                  date: format(new Date(lesson.recurrenceInstanceDate || lesson.startAt), "dd.MM.yyyy"),
                })}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="series-reschedule-time">
                {t("lesson.rescheduleSeriesTime")}
              </label>
              <Input
                id="series-reschedule-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={!time || saving} onClick={() => void save()}>
                {t("lesson.rescheduleAction")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
