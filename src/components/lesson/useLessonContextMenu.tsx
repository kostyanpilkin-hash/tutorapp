import {
  CalendarClock,
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
  restoreLessonArchive,
  lessonPaymentStatus,
  openLessonLink,
  setLessonPaid,
  setLessonStatus,
} from "@/lib/lessonActions";
import { useToastStore } from "@/stores/toastStore";
import type { Lesson } from "@/types/lesson";
import { useContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { useRescheduleStore } from "@/components/lesson/RescheduleDialog";

interface Options {
  onOpen: (lesson: Lesson) => void;
}

export function useLessonContextMenu({ onOpen }: Options) {
  const { t } = useTranslation();
  const { open } = useContextMenu();

  const run = async (fn: () => Promise<void>, okMessage: string, action?: { label: string; onClick: () => void }) => {
    try {
      await fn();
      useToastStore.getState().info(okMessage, action);
    } catch {
      // api already toasts errors
    }
  };

  const deleteInstanceAction = (lesson: Lesson) => () => {
    if (!window.confirm(t("lesson.confirmDeleteLesson"))) return;
    void (async () => {
      try {
        const result = await deleteLessonInstance(lesson);
        useToastStore.getState().info(t("lesson.deletedToast"), {
          label: t("common.undo"),
          onClick: () => {
            void result
              .undo()
              .catch(() => useToastStore.getState().error(t("lesson.undoFailed")));
          },
        });
      } catch {
        // api already toasts errors
      }
    })();
  };

  const deleteSeriesAction = (lesson: Lesson) => () => {
    if (!window.confirm(t("lesson.deleteSeriesConfirm"))) return;
    void (async () => {
      try {
        const { archiveId } = await deleteLessonSeries(lesson);
        useToastStore.getState().info(t("lesson.seriesDeleted"), {
          label: t("common.undo"),
          onClick: () => {
            void restoreLessonArchive(archiveId)
              .catch(() => useToastStore.getState().error(t("lesson.undoFailed")));
          },
        });
      } catch {
        // api already toasts errors
      }
    })();
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
      { id: "sep3", label: "", separator: true },
      {
        id: "reschedule",
        label: t("lesson.rescheduleAction"),
        icon: <CalendarClock className="h-4 w-4" />,
        onSelect: () => useRescheduleStore.getState().open(lesson),
      },
      {
        id: "delete",
        label: t("lesson.deleteAction"),
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        children: [
          {
            id: "deleteThis",
            label: t("lesson.deleteThis"),
            destructive: true,
            onSelect: deleteInstanceAction(lesson),
          },
          ...(isRecurring
            ? [
                {
                  id: "deleteSeries",
                  label: t("lesson.deleteSeries"),
                  destructive: true,
                  onSelect: deleteSeriesAction(lesson),
                },
              ]
            : []),
        ],
      },
    ];

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
