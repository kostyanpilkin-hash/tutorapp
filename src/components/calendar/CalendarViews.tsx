import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { addDays, format, startOfWeek, isSameDay, type Locale } from "date-fns";
import { ru, enUS, be as beLocale } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import type { Lesson } from "@/types/lesson";
import { lessonDisplayColor, lessonStudentNames, lessonStudentNotes, lessonToInput } from "@/types/lesson";
import { LessonStatusBadges } from "@/components/lesson/LessonStatusBadges";
import { useLessonContextMenu } from "@/components/lesson/useLessonContextMenu";
import { useRescheduleStore } from "@/components/lesson/RescheduleDialog";
import { api } from "@/lib/api";
import { resolveNewStart } from "@/lib/calendarLayout";
import { formatTimeInTimezone } from "@/lib/contacts";
import { realLessonId, isRecurrenceInstance, parentLessonId } from "@/lib/recurrence";
import { queryClient } from "@/lib/queryClient";
import { invalidateAppData } from "@/lib/queryKeys";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const locales = { ru, en: enUS, be: beLocale };

interface Props {
  lessons: Lesson[];
  anchor: Date;
  onSelect: (lesson: Lesson) => void;
  onCreate?: (date: Date) => void;
}

async function moveLesson(
  lesson: Lesson,
  newStart: Date,
  overlapConfirm: (names: string) => boolean,
  undoLabel: string,
  movedMessage: string,
  undoFailedMessage: string,
) {
  const excludeId = lesson.id.includes("::")
    ? lesson.id
    : lesson.recurrenceParentId
      ? lesson.id
      : realLessonId(lesson.id);
  const overlaps = await api.checkOverlaps(
    newStart.toISOString(),
    lesson.durationMinutes,
    excludeId,
  );
  if (overlaps.length > 0) {
    const ok = overlapConfirm(overlaps.map((o) => o.studentName).join(", "));
    if (!ok) return;
  }

  const previousStart = lesson.startAt;
  const input = { ...lessonToInput(lesson), startAt: newStart.toISOString(), force: true };
  let createdExceptionId: string | null = null;
  let updatedId: string | null = null;

  if (isRecurrenceInstance(lesson)) {
    const parentId = parentLessonId(lesson);
    const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;
    if (lesson.recurrenceParentId && !lesson.id.includes("::")) {
      updatedId = lesson.id;
      await api.updateLesson(lesson.id, input);
    } else {
      const created = await api.createLesson({
        ...input,
        recurrenceRule: null,
        recurrenceParentId: parentId,
        recurrenceInstanceDate: instanceDate,
      });
      createdExceptionId = created.id;
    }
  } else {
    updatedId = realLessonId(lesson.id);
    await api.updateLesson(updatedId, input);
  }
  await invalidateAppData(queryClient);

  useToastStore.getState().info(movedMessage, {
    label: undoLabel,
    onClick: () => {
      void (async () => {
        try {
          if (createdExceptionId) {
            await api.deleteLesson(createdExceptionId);
          } else if (updatedId) {
            await api.updateLesson(updatedId, {
              ...lessonToInput(lesson),
              startAt: previousStart,
            });
          }
          await invalidateAppData(queryClient);
        } catch {
          useToastStore.getState().error(undoFailedMessage);
        }
      })();
    },
  });
}

function DraggableLessonCard({
  lesson,
  onSelect,
  onContextMenu,
  compact,
}: {
  lesson: Lesson;
  onSelect: (lesson: Lesson) => void;
  onContextMenu?: (e: React.MouseEvent, lesson: Lesson) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const start = new Date(lesson.startAt);
  const end = new Date(start.getTime() + lesson.durationMinutes * 60_000);
  const color = lessonDisplayColor(lesson);
  const studentNotes = lessonStudentNotes(lesson);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lesson.id,
    data: { lesson },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-lesson
      {...listeners}
      {...attributes}
      onClick={() => onSelect(lesson)}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => onContextMenu?.(e, lesson)}
      style={{
        transform: CSS.Translate.toString(transform),
        borderColor: color ? `${color}99` : undefined,
        backgroundColor: color
          ? `color-mix(in oklab, ${color} 34%, var(--card))`
          : `color-mix(in oklab, var(--primary) 20%, var(--card))`,
      }}
      className={cn(
        "group relative w-full overflow-hidden rounded-lg border-2 text-left shadow-sm transition duration-150",
        compact ? "px-1.5 py-1.5 text-xs" : "px-3 py-2.5 text-sm",
        !color && "border-primary/40",
        isDragging && "z-30 opacity-80 ring-2 ring-primary",
      )}
    >
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color || "var(--primary)" }}
      />
      <div className={cn("flex items-start justify-between gap-1", compact ? "pl-1.5" : "pl-2")}>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight tabular-nums">
            {format(start, "HH:mm")}
            <span className="font-medium opacity-60">–{format(end, "HH:mm")}</span>
          </div>
          <div className="truncate font-medium leading-tight">{lessonStudentNames(lesson)}</div>
          {!compact && lesson.subject && (
            <div className="truncate text-[0.85em] opacity-80">{lesson.subject}</div>
          )}
          {!compact && studentNotes.length > 0 && (
            <div className="truncate text-[0.8em] opacity-70">
              {studentNotes.map((n) => n.note).join(" · ")}
            </div>
          )}
        </div>
        <LessonStatusBadges lesson={lesson} className="mt-0.5" size={compact ? "sm" : "md"} />
      </div>
      <span
        role="button"
        title={t("lesson.rescheduleAction")}
        className={cn(
          "absolute bottom-1 right-1 flex items-center justify-center rounded-md bg-card/80 p-0.5 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100",
          compact && "bottom-0.5 right-0.5",
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          useRescheduleStore.getState().open(lesson);
        }}
      >
        <CalendarClock className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function DayLessonList({
  day,
  lessons,
  onSelect,
  onCreate,
  onContextMenu,
  compact,
  className,
}: {
  day: Date;
  lessons: Lesson[];
  onSelect: (lesson: Lesson) => void;
  onCreate?: (date: Date) => void;
  onContextMenu?: (e: React.MouseEvent, lesson: Lesson) => void;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({ id });
  const dayLessons = lessons
    .filter((l) => isSameDay(new Date(l.startAt), day))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onCreate) return;
    if ((e.target as HTMLElement).closest("[data-lesson]")) return;
    const slotDate = new Date(day);
    slotDate.setHours(10, 0, 0, 0);
    onCreate(slotDate);
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        isOver && "bg-primary/5",
        className,
      )}
      onDoubleClick={handleDoubleClick}
    >
      <div className={cn("flex flex-1 flex-col gap-2 overflow-auto", compact ? "p-1.5" : "p-3")}>
        {dayLessons.map((lesson) => (
          <DraggableLessonCard
            key={lesson.id}
            lesson={lesson}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            compact={compact}
          />
        ))}
        {dayLessons.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground/80">
            {t("today.emptyShort")}
          </p>
        )}
      </div>
    </div>
  );
}

function moveToDay(lesson: Lesson, targetDay: Date): Date {
  const oldStart = new Date(lesson.startAt);
  const result = new Date(targetDay);
  result.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
  return result;
}

function MonthLessonChip({
  lesson,
  onSelect,
  onContextMenu,
}: {
  lesson: Lesson;
  onSelect: (lesson: Lesson) => void;
  onContextMenu: (e: React.MouseEvent, lesson: Lesson) => void;
}) {
  const color = lessonDisplayColor(lesson);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `month-${lesson.id}`,
    data: { lesson },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-lesson
      {...listeners}
      {...attributes}
      onClick={() => onSelect(lesson)}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => onContextMenu(e, lesson)}
      className={cn(
        "mt-1 flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-1 text-left text-xs font-medium transition hover:brightness-95",
        isDragging && "z-30 opacity-80 ring-1 ring-primary",
      )}
      style={{
        transform: CSS.Translate.toString(transform),
        borderColor: color ? `${color}88` : undefined,
        backgroundColor: color ? `${color}22` : undefined,
        borderLeftWidth: 3,
        borderLeftColor: color || "var(--primary)",
      }}
    >
      <span className="min-w-0 flex-1 truncate">
        {format(new Date(lesson.startAt), "HH:mm")} {lessonStudentNames(lesson)}
      </span>
      <LessonStatusBadges lesson={lesson} size="sm" />
    </button>
  );
}

function MonthDayCell({
  day,
  inMonth,
  isToday,
  dayLessons,
  locale,
  onSelect,
  onCreate,
  onContextMenu,
  onExpand,
}: {
  day: Date;
  inMonth: boolean;
  isToday: boolean;
  dayLessons: Lesson[];
  locale: Locale;
  onSelect: (lesson: Lesson) => void;
  onCreate?: (date: Date) => void;
  onContextMenu: (e: React.MouseEvent, lesson: Lesson) => void;
  onExpand: (day: Date, lessons: Lesson[]) => void;
}) {
  const { t } = useTranslation();
  const id = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-28 cursor-cell bg-card p-1.5",
        !inMonth && "opacity-40",
        isToday && "bg-primary/10 ring-1 ring-inset ring-primary/40",
        isOver && "bg-primary/10",
      )}
      onDoubleClick={(e) => {
        if (!onCreate) return;
        if ((e.target as HTMLElement).closest("[data-lesson]")) return;
        const slotDate = new Date(day);
        slotDate.setHours(10, 0, 0, 0);
        onCreate(slotDate);
      }}
    >
      <div
        className={cn(
          "pointer-events-none mb-1 inline-flex h-6 min-w-6 items-center justify-center px-1 text-xs font-medium",
          isToday
            ? "rounded-full bg-primary font-semibold text-primary-foreground"
            : "text-foreground",
        )}
      >
        {format(day, "d", { locale })}
      </div>
      {dayLessons.slice(0, 3).map((l) => (
        <MonthLessonChip
          key={l.id}
          lesson={l}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
      {dayLessons.length > 3 && (
        <button
          type="button"
          className="mt-1 w-full text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onExpand(day, dayLessons)}
        >
          +{dayLessons.length - 3}
        </button>
      )}
      {dayLessons.length === 0 && inMonth && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">{t("today.emptyShort")}</p>
      )}
    </div>
  );
}

export function WeekView({ lessons, anchor, onSelect, onCreate }: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const { show } = useLessonContextMenu({ onOpen: onSelect });
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const lesson = event.active.data.current?.lesson as Lesson | undefined;
    if (!lesson) return;

    const overId = event.over?.id as string | undefined;
    const targetDay = overId ? days.find((d) => format(d, "yyyy-MM-dd") === overId) : undefined;
    if (!targetDay || isSameDay(new Date(lesson.startAt), targetDay)) return;

    await moveLesson(
      lesson,
      moveToDay(lesson, targetDay),
      (names) =>
        window.confirm(`${t("lesson.overlap")}: ${names}. ${t("lesson.overlapDragConfirm")}`),
      t("common.undo"),
      t("lesson.movedToast"),
      t("lesson.undoFailed"),
    );
  };

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-border bg-card">
          {days.map((day, i) => (
            <div
              key={day.toISOString()}
              className={cn(
                "p-2 text-center text-sm font-medium",
                i > 0 && "border-l border-border",
                isSameDay(day, new Date()) && "bg-primary/10 text-primary",
              )}
            >
              {format(day, "EEE d", { locale })}
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {days.map((day, i) => (
            <DayLessonList
              key={day.toISOString()}
              day={day}
              lessons={lessons}
              onSelect={onSelect}
              onCreate={onCreate}
              onContextMenu={show}
              compact
              className={i > 0 ? "border-l border-border" : undefined}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

export function DayView({ lessons, anchor, onSelect, onCreate }: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const { show } = useLessonContextMenu({ onOpen: onSelect });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const lesson = event.active.data.current?.lesson as Lesson | undefined;
    if (!lesson) return;

    const newStart = resolveNewStart(lesson.startAt, event.delta.y);
    if (!newStart || newStart.getTime() === new Date(lesson.startAt).getTime()) return;

    await moveLesson(
      lesson,
      newStart,
      (names) =>
        window.confirm(`${t("lesson.overlap")}: ${names}. ${t("lesson.overlapDragConfirm")}`),
      t("common.undo"),
      t("lesson.movedToast"),
      t("lesson.undoFailed"),
    );
  };

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="sticky top-0 z-20 border-b border-border bg-card p-2 text-center font-medium">
          {format(anchor, "EEEE, d MMMM", { locale })}
        </div>
        <DayLessonList
          day={anchor}
          lessons={lessons}
          onSelect={onSelect}
          onCreate={onCreate}
          onContextMenu={show}
        />
      </div>
    </DndContext>
  );
}

export function MonthView({
  lessons,
  anchor,
  onSelect,
  onCreate,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const { show } = useLessonContextMenu({ onOpen: onSelect });
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first, { weekStartsOn: 1 });
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weekDays = Array.from({ length: 7 }, (_, i) => format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i), "EEE", { locale }));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dayDialog, setDayDialog] = useState<{ day: Date; lessons: Lesson[] } | null>(null);

  const handleDragEnd = async (event: DragEndEvent) => {
    const lesson = event.active.data.current?.lesson as Lesson | undefined;
    if (!lesson) return;

    const overId = event.over?.id as string | undefined;
    const targetDay = overId ? cells.find((d) => format(d, "yyyy-MM-dd") === overId) : undefined;
    if (!targetDay || isSameDay(new Date(lesson.startAt), targetDay)) return;

    await moveLesson(
      lesson,
      moveToDay(lesson, targetDay),
      (names) =>
        window.confirm(`${t("lesson.overlap")}: ${names}. ${t("lesson.overlapDragConfirm")}`),
      t("common.undo"),
      t("lesson.movedToast"),
      t("lesson.undoFailed"),
    );
  };

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
        <div className="grid h-full grid-cols-7 grid-rows-[auto_1fr] gap-px bg-border">
          {weekDays.map((d) => (
            <div key={d} className="bg-card p-2 text-center text-xs font-medium">{d}</div>
          ))}
          <div className="col-span-7 grid grid-cols-7 grid-rows-6 gap-px bg-border">
            {cells.map((day) => {
              const dayLessons = lessons
                .filter((l) => isSameDay(new Date(l.startAt), day))
                .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
              return (
                <MonthDayCell
                  key={day.toISOString()}
                  day={day}
                  inMonth={day.getMonth() === anchor.getMonth()}
                  isToday={isSameDay(day, new Date())}
                  dayLessons={dayLessons}
                  locale={locale}
                  onSelect={onSelect}
                  onCreate={onCreate}
                  onContextMenu={show}
                  onExpand={(d, ls) => setDayDialog({ day: d, lessons: ls })}
                />
              );
            })}
          </div>
        </div>
      </DndContext>

      <Dialog open={!!dayDialog} onOpenChange={(v) => !v && setDayDialog(null)}>
        <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dayDialog
                ? t("calendar.dayLessons", { date: format(dayDialog.day, "dd.MM", { locale }) })
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {dayDialog?.lessons.map((lesson) => (
              <button
                key={lesson.id}
                type="button"
                data-lesson
                onClick={() => {
                  setDayDialog(null);
                  onSelect(lesson);
                }}
                onContextMenu={(e) => show(e, lesson)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition hover:bg-muted"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: lessonDisplayColor(lesson) || "var(--primary)",
                }}
              >
                <div className="min-w-0">
                  <div className="font-medium tabular-nums">
                    {format(new Date(lesson.startAt), "HH:mm")} {lessonStudentNames(lesson)}
                  </div>
                  {lesson.subject && (
                    <div className="truncate text-xs text-muted-foreground">{lesson.subject}</div>
                  )}
                </div>
                <LessonStatusBadges lesson={lesson} />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AgendaView({
  lessons,
  onSelect,
}: Pick<Props, "lessons" | "onSelect">) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const tutorTimezone = useSettingsStore((s) => s.timezone);
  const { show } = useLessonContextMenu({ onOpen: onSelect });

  return (
    <div className="space-y-2 overflow-auto p-3">
      {lessons.length === 0 && (
        <div className="animate-fade-up rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <p className="font-display text-lg font-semibold">{t("today.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("today.empty")}</p>
        </div>
      )}
      {lessons.map((lesson, index) => {
        const color = lessonDisplayColor(lesson);
        const tzHints = lesson.students
          .filter((s) => s.timezone && s.timezone !== tutorTimezone)
          .map((s) => `${s.name}: ${formatTimeInTimezone(lesson.startAt, s.timezone!)}`);
        return (
          <button
            key={lesson.id}
            type="button"
            onClick={() => onSelect(lesson)}
            onContextMenu={(e) => show(e, lesson)}
            className="animate-fade-up flex w-full items-center justify-between rounded-xl border border-border bg-card p-3 text-left transition hover:-translate-y-0.5 hover:bg-muted hover:shadow-sm"
            style={{
              borderLeftWidth: 4,
              borderLeftColor: color || "var(--primary)",
              animationDelay: `${Math.min(index, 8) * 30}ms`,
            }}
          >
            <div>
              <div className="font-medium">{lessonStudentNames(lesson)}</div>
              <div className="text-sm text-muted-foreground">{lesson.subject}</div>
              {tzHints.length > 0 && (
                <div className="mt-0.5 text-xs text-blue-600">{tzHints.join(" · ")}</div>
              )}
              {lessonStudentNotes(lesson).length > 0 && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {lessonStudentNotes(lesson).map((n) => n.note).join(" · ")}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 text-right text-sm">
              <div>{format(new Date(lesson.startAt), "d MMM HH:mm", { locale })}</div>
              <LessonStatusBadges lesson={lesson} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
