import {
  CalendarPlus,
  CheckCircle2,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
  UserX,
  Wallet,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  copyLessonLink,
  deleteLessonInstance,
  deleteLessonSeries,
  lessonPaymentStatus,
  openLessonLink,
  setLessonPaid,
  setLessonStatus,
} from "@/lib/lessonActions";
import { useToastStore } from "@/stores/toastStore";
import type { Lesson } from "@/types/lesson";
import { useContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { useRescheduleLessonStore } from "@/components/lesson/RescheduleLessonDialog";
import { useRescheduleSeriesStore } from "@/components/lesson/RescheduleSeriesDialog";

interface Options {
  onOpen: (lesson: Lesson) => void;
  onChanged: () => void;
}

export function useLessonContextMenu({ onOpen, onChanged }: Options) {
  const { t } = useTranslation();
  const { open } = useContextMenu();

  const run = async (fn: () => Promise<void>, okMessage: string, action?: { label: string; onClick: () => void }) => {
    try {
      await fn();
      onChanged();
      useToastStore.getState().info(okMessage, action);
    } catch {
      // api already toasts errors
    }
  };

  const show = (e: React.MouseEvent, lesson: Lesson) => {
    const paid = lessonPaymentStatus(lesson) === "paid";
    const isRecurring = lesson.recurrenceRule || lesson.recurrenceParentId;
    const items: ContextMenuItem[] = [
      {
        id: "open",
        label: t("lesson.edit"),
        icon: <Pencil className="h-4 w-4" />,
        onSelect: () => onOpen(lesson),
      },
      { id: "sep1", label: "", separator: true },
      {
        id: "done",
        label: t("status.completed"),
        icon: <CheckCircle2 className="h-4 w-4" />,
        disabled: lesson.status === "completed",
        onSelect: () => {
          void run(
            () => setLessonStatus(lesson, "completed"),
            t("today.markedCompleted"),
            lessonPaymentStatus(lesson) === "unpaid"
              ? {
                  label: t("payment.paid"),
                  onClick: () => {
                    void run(() => setLessonPaid(lesson, true), t("today.markedPaid"));
                  },
                }
              : undefined,
          );
        },
      },
      {
        id: "noshow",
        label: t("status.no_show"),
        icon: <UserX className="h-4 w-4" />,
        disabled: lesson.status === "no_show",
        onSelect: () => {
          void run(() => setLessonStatus(lesson, "no_show"), t("today.markedNoShow"));
        },
      },
      {
        id: "cancelled",
        label: t("status.cancelled"),
        icon: <XCircle className="h-4 w-4" />,
        disabled: lesson.status === "cancelled",
        onSelect: () => {
          void run(() => setLessonStatus(lesson, "cancelled"), t("today.markedCancelled"));
        },
      },
      {
        id: "pay",
        label: paid ? t("payment.unpaid") : t("payment.paid"),
        icon: <Wallet className="h-4 w-4" />,
        onSelect: () => {
          void run(() => setLessonPaid(lesson, !paid), paid ? t("today.markedUnpaid") : t("today.markedPaid"));
        },
      },
      {
        id: "reschedule",
        label: t("lesson.rescheduleAction"),
        icon: <CalendarPlus className="h-4 w-4" />,
        onSelect: () => useRescheduleLessonStore.getState().open(lesson, onChanged),
      },
      { id: "sep3", label: "", separator: true },
      {
        id: "deleteThis",
        label: t("lesson.deleteThis"),
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        onSelect: () => {
          if (!window.confirm(t("lesson.confirmDeleteLesson"))) return;
          void (async () => {
            try {
              const result = await deleteLessonInstance(lesson);
              onChanged();
              useToastStore.getState().info(t("lesson.deletedToast"), {
                label: t("common.undo"),
                onClick: () => {
                  void result
                    .undo()
                    .then(() => onChanged())
                    .catch(() => useToastStore.getState().error(t("lesson.undoFailed")));
                },
              });
            } catch {
              // api already toasts errors
            }
          })();
        },
      },
    ];

    if (isRecurring) {
      items.push(
        {
          id: "rescheduleSeries",
          label: t("lesson.rescheduleSeries"),
          icon: <CalendarPlus className="h-4 w-4" />,
          onSelect: () => useRescheduleSeriesStore.getState().open(lesson, onChanged),
        },
        {
          id: "deleteSeries",
          label: t("lesson.deleteSeries"),
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => {
            if (window.confirm(t("lesson.deleteSeriesConfirm"))) {
              void run(() => deleteLessonSeries(lesson), t("lesson.seriesDeleted"));
            }
          },
        },
      );
    }

    if (lesson.link) {
      items.push(
        { id: "sep2", label: "", separator: true },
        {
          id: "openLink",
          label: t("lesson.openLink"),
          icon: <ExternalLink className="h-4 w-4" />,
          onSelect: () => {
            void openLessonLink(lesson);
          },
        },
        {
          id: "copyLink",
          label: t("lesson.copyLink"),
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => {
            void copyLessonLink(lesson).then((ok) => {
              if (ok) useToastStore.getState().success(t("today.linkCopied"));
            });
          },
        },
      );
    }

    open(e, items);
  };

  return { show };
}
