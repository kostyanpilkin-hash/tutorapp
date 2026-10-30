import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import type { Lesson, LessonInput, LessonStudentInput, RecurrenceEditScope } from "@/types/lesson";
import { lessonToInput } from "@/types/lesson";
import { studentToInput } from "@/types/student";
import { api } from "@/lib/api";
import { CURRENCIES } from "@/lib/money";
import { formatTimeInTimezone } from "@/lib/contacts";
import { parseLocalDateTime, realLessonId, isRecurrenceInstance, parentLessonId, WEEKLY_RULE, withUntil, buildWeeklyRule, parseByday, parseUntil, parseCount } from "@/lib/recurrence";
import { hrefFor, textHasLinks } from "@/lib/linkify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, invalidateAppData } from "@/lib/queryKeys";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Textarea } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import { PaymentCompleteDialog } from "./PaymentCompleteDialog";
import { StudentPickerDialog } from "@/components/students/StudentPickerDialog";
import { StudentAvatar } from "@/components/students/StudentAvatar";
import { LinkifiedText } from "@/components/LinkifiedText";
import type { PaymentStatus } from "@/types/lesson";
import { Users } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

const REMINDER_PRESETS = [
  { value: "1440", labelKey: "reminder.dayBefore" },
  { value: "60", labelKey: "reminder.hourBefore" },
  { value: "30", labelKey: "reminder.min30" },
  { value: "15", labelKey: "reminder.min15" },
  { value: "5", labelKey: "reminder.min5" },
  { value: "0", labelKey: "reminder.atStart" },
] as const;

interface Props {
  open: boolean;
  lesson?: Lesson | null;
  initialDate?: Date;
  initialStudentIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function LessonFormDialog({ open, lesson, initialDate, initialStudentIds, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { defaultDuration, defaultReminders, timezone: tutorTimezone } = useSettingsStore(
    useShallow((s) => ({
      defaultDuration: s.defaultDuration,
      defaultReminders: s.defaultReminders,
      timezone: s.timezone,
    })),
  );
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({
    queryKey: keys.students.all(false),
    queryFn: () => api.getStudents(false),
    enabled: open,
  });
  const allStudents = studentsQuery.data ?? [];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [studentCosts, setStudentCosts] = useState<Record<string, { cost: string; currency: string }>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [lessonNotesDraft, setLessonNotesDraft] = useState<Record<string, string>>({});
  const [materials, setMaterials] = useState("");
  const [materialsLink, setMaterialsLink] = useState("");
  const [status, setStatus] = useState("scheduled");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [paymentPromptOpen, setPaymentPromptOpen] = useState(false);
  const [pendingScope, setPendingScope] = useState<RecurrenceEditScope | null>(null);
  const [reminderCount, setReminderCount] = useState<"1" | "2" | "3">("2");
  const [reminder1, setReminder1] = useState("15");
  const [reminder2, setReminder2] = useState("0");
  const [reminder3, setReminder3] = useState("1440");
  const [recurrence, setRecurrence] = useState("none");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [recurrenceEnd, setRecurrenceEnd] = useState<"none" | "until" | "count">("none");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [recurrenceCount, setRecurrenceCount] = useState("10");
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [customGroupCosts, setCustomGroupCosts] = useState(false);

  const reminderValues = useMemo(() => {
    const values = [Number(reminder1)];
    if (reminderCount === "2" || reminderCount === "3") values.push(Number(reminder2));
    if (reminderCount === "3") values.push(Number(reminder3));
    return [...new Set(values)].sort((a, b) => b - a);
  }, [reminder1, reminder2, reminder3, reminderCount]);

  const selectedStudents = useMemo(
    () => allStudents.filter((s) => selectedIds.includes(s.id)),
    [allStudents, selectedIds],
  );

  const displayStudentName = selectedStudents.map((s) => s.name).join(", ");

  const startAtIso = date && time ? parseLocalDateTime(date, time).toISOString() : "";

  const timezoneHints = useMemo(() => {
    if (!startAtIso) return [];
    return selectedStudents
      .filter((s) => s.timezone && s.timezone !== tutorTimezone)
      .map((s) => ({
        name: s.name,
        tz: s.timezone!,
        time: formatTimeInTimezone(startAtIso, s.timezone!),
      }));
  }, [selectedStudents, startAtIso, tutorTimezone]);

  useEffect(() => {
    if (!open) return;
    setLessonNotesDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of selectedStudents) {
        if (next[s.id] === undefined) {
          next[s.id] = s.notes ?? s.lessonNote ?? "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, selectedStudents]);

  useEffect(() => {
    if (!open) return;
    if (lesson) {
      const d = new Date(lesson.startAt);
      const mins = lesson.reminders.map((r) => r.minutesBefore);
      setSelectedIds(lesson.students.map((s) => s.studentId));
      const costs: Record<string, { cost: string; currency: string }> = {};
      for (const s of lesson.students) {
        if (s.cost != null) {
          costs[s.studentId] = { cost: String(s.cost), currency: s.currency || "USD" };
        }
      }
      setStudentCosts(costs);
      setCustomGroupCosts(lesson.students.length > 1 && Object.keys(costs).length > 0);
      setSubject(lesson.subject);
      setDate(format(d, "yyyy-MM-dd"));
      setTime(format(d, "HH:mm"));
      setDuration(lesson.durationMinutes);
      setCost(lesson.cost?.toString() || "");
      setCurrency(lesson.currency || "USD");
      setLink(lesson.link || "");
      setNotes(lesson.notes);
      setLessonNotesDraft({});
      setMaterials(lesson.materials || "");
      setMaterialsLink(lesson.materialsLink || "");
      setStatus(lesson.status);
      setPaymentStatus((lesson.paymentStatus || "unpaid") as PaymentStatus);
      setRecurrence(lesson.recurrenceRule ? "weekly" : "none");
      if (lesson.recurrenceRule) {
        const days = parseByday(lesson.recurrenceRule);
        setWeekdays(days.length > 0 ? days : [new Date(lesson.startAt).getDay()]);
        const until = parseUntil(lesson.recurrenceRule);
        const count = parseCount(lesson.recurrenceRule);
        if (count != null) {
          setRecurrenceEnd("count");
          setRecurrenceCount(String(count));
          setRecurrenceUntil("");
        } else if (until) {
          setRecurrenceEnd("until");
          setRecurrenceUntil(format(until, "yyyy-MM-dd"));
          setRecurrenceCount("10");
        } else {
          setRecurrenceEnd("none");
          setRecurrenceUntil("");
          setRecurrenceCount("10");
        }
      } else {
        setWeekdays([]);
        setRecurrenceEnd("none");
        setRecurrenceUntil("");
        setRecurrenceCount("10");
      }
      if (mins.length <= 1) {
        setReminderCount("1");
        setReminder1(String(mins[0] ?? 15));
      } else if (mins.length === 2) {
        setReminderCount("2");
        const sorted = [...mins].sort((a, b) => b - a);
        setReminder1(String(sorted[0]));
        setReminder2(String(sorted[1]));
      } else {
        setReminderCount("3");
        const sorted = [...mins].sort((a, b) => b - a);
        setReminder1(String(sorted[0]));
        setReminder2(String(sorted[1]));
        setReminder3(String(sorted[2]));
      }
    } else {
      const d = initialDate || new Date();
      const sorted = [...defaultReminders].sort((a, b) => b - a);
      setSelectedIds(initialStudentIds?.length ? [...initialStudentIds] : []);
      setStudentCosts({});
      setCustomGroupCosts(false);
      setSubject("");
      setDate(format(d, "yyyy-MM-dd"));
      setTime(format(d, "HH:mm"));
      setDuration(defaultDuration);
      setCost("");
      setCurrency("USD");
      setLink("");
      setNotes("");
      setLessonNotesDraft({});
      setMaterials("");
      setMaterialsLink("");
      setStatus("scheduled");
      setPaymentStatus("unpaid");
      setRecurrence("none");
      setWeekdays([]);
      setRecurrenceEnd("none");
      setRecurrenceUntil("");
      setRecurrenceCount("10");
      if (sorted.length <= 1) {
        setReminderCount("1");
        setReminder1(String(sorted[0] ?? 15));
      } else if (sorted.length === 2) {
        setReminderCount("2");
        setReminder1(String(sorted[0] ?? 1440));
        setReminder2(String(sorted[1] ?? 0));
      } else {
        setReminderCount("3");
        setReminder1(String(sorted[0] ?? 1440));
        setReminder2(String(sorted[1] ?? 15));
        setReminder3(String(sorted[2] ?? 0));
      }
    }
    setOverlapWarning(null);
  }, [open, lesson, initialDate, initialStudentIds, defaultDuration, defaultReminders]);

  const applyStudentDefaults = (ids: string[]) => {
    const picked = allStudents.filter((s) => ids.includes(s.id));
    if (picked.length === 1) {
      const s = picked[0];
      if (s.defaultDuration) setDuration(s.defaultDuration);
      if (s.defaultCost != null) setCost(String(s.defaultCost));
      if (s.defaultCurrency) setCurrency(s.defaultCurrency);
      if (s.defaultLink) setLink(s.defaultLink);
    } else if (picked.length > 1) {
      const first = picked[0];
      if (first.defaultDuration) setDuration(first.defaultDuration);
      if (first.defaultCost != null) setCost(String(first.defaultCost));
      if (first.defaultCurrency) setCurrency(first.defaultCurrency);
      if (first.defaultLink) setLink(first.defaultLink);
    }
  };

  const handlePickStudents = (ids: string[]) => {
    setSelectedIds(ids);
    if (!lesson) applyStudentDefaults(ids);
  };

  const buildStudentsInput = (): LessonStudentInput[] =>
    selectedIds.map((id) => {
      if (customGroupCosts && studentCosts[id]) {
        const sc = studentCosts[id];
        return {
          studentId: id,
          cost: sc.cost ? Number(sc.cost) : null,
          currency: sc.cost ? (sc.currency as LessonStudentInput["currency"]) : null,
          paymentStatus: null,
        };
      }
      return { studentId: id, cost: null, currency: null, paymentStatus: null };
    });

  const buildRecurrenceRule = (): string | null => {
    if (recurrence !== "weekly") return null;
    const days = weekdays.length > 0
      ? weekdays
      : date
        ? [parseLocalDateTime(date, time || "10:00").getDay()]
        : [];
    return buildWeeklyRule({
      bydays: days,
      until: recurrenceEnd === "until" && recurrenceUntil
        ? parseLocalDateTime(recurrenceUntil, "23:59")
        : null,
      count: recurrenceEnd === "count" ? Number(recurrenceCount) || null : null,
    });
  };

  const buildInput = (): LessonInput => {
    const startAt = parseLocalDateTime(date, time).toISOString();
    const recurrenceRule = buildRecurrenceRule();
    return {
      subject,
      startAt,
      durationMinutes: duration,
      cost: cost ? Number(cost) : null,
      currency: cost ? (currency as LessonInput["currency"]) : null,
      link: link || null,
      notes,
      materials,
      materialsLink: materialsLink || null,
      status: status as LessonInput["status"],
      paymentStatus,
      recurrenceRule,
      recurrenceParentId: lesson?.recurrenceParentId || null,
      recurrenceInstanceDate: lesson?.recurrenceInstanceDate || null,
      color: lesson?.color || null,
      students: buildStudentsInput(),
      reminders: reminderValues,
      force: false,
    };
  };

  const doSave = async (scope?: RecurrenceEditScope, payStatus?: PaymentStatus) => {
    if (selectedIds.length === 0) {
      setOverlapWarning(t("students.pickRequired"));
      return;
    }
    const input = { ...buildInput(), paymentStatus: payStatus ?? paymentStatus };
    const excludeId = !lesson
      ? undefined
      : scope === "all" || scope === "thisAndFuture"
        ? parentLessonId(lesson)
        : lesson.id;
    const overlaps = await api.checkOverlaps(
      input.startAt,
      input.durationMinutes,
      excludeId,
    );
    if (overlaps.length > 0 && !overlapWarning) {
      setOverlapWarning(
        `${t("lesson.overlap")}: ${overlaps.map((o) => o.studentName).join(", ")}. ${t("lesson.overlapConfirm")}`,
      );
      return;
    }
    if (overlaps.length > 0 || overlapWarning) {
      input.force = true;
    }

    if (lesson && !scope && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
      setScopeOpen(true);
      return;
    }

    if (lesson) {
      const id = realLessonId(lesson.id);
      const parentId = parentLessonId(lesson);
      const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;

      if (scope === "this" && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
        await api.createLesson({
          ...input,
          recurrenceRule: null,
          recurrenceParentId: parentId,
          recurrenceInstanceDate: instanceDate,
        });
      } else if (scope === "thisAndFuture" && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
        const parent = await api.getLesson(parentId);
        const until = new Date(instanceDate);
        await api.updateLesson(parentId, {
          ...lessonToInput(parent),
          recurrenceRule: withUntil(parent.recurrenceRule || WEEKLY_RULE, until),
        });
        await api.createLesson({
          ...input,
          recurrenceRule: buildRecurrenceRule() || WEEKLY_RULE,
          recurrenceParentId: null,
          recurrenceInstanceDate: null,
        });
      } else if (scope === "all" && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
        const parent = await api.getLesson(parentId);
        // Keep series anchor date; apply new time-of-day from the form.
        const parentStart = new Date(parent.startAt);
        const nextStart = new Date(input.startAt);
        parentStart.setHours(
          nextStart.getHours(),
          nextStart.getMinutes(),
          0,
          0,
        );
        // If weekday changed, shift the series to the new weekday.
        const dayDelta = nextStart.getDay() - new Date(instanceDate).getDay();
        if (dayDelta !== 0) {
          parentStart.setDate(parentStart.getDate() + dayDelta);
        }
        await api.updateLesson(parentId, {
          ...input,
          startAt: parentStart.toISOString(),
          recurrenceRule: input.recurrenceRule || parent.recurrenceRule || WEEKLY_RULE,
          recurrenceParentId: null,
          recurrenceInstanceDate: null,
        });
      } else if (isRecurrenceInstance(lesson) && !lesson.recurrenceParentId) {
        await api.createLesson({
          ...input,
          recurrenceRule: null,
          recurrenceParentId: parentId,
          recurrenceInstanceDate: instanceDate,
        });
      } else if (lesson.recurrenceParentId) {
        await api.updateLesson(lesson.id, input);
      } else {
        await api.updateLesson(id, input);
      }
    } else {
      await api.createLesson(input);
    }

    for (const s of selectedStudents) {
      const next = lessonNotesDraft[s.id] ?? s.notes ?? "";
      if (next === (s.notes ?? "")) continue;
      await api.updateStudent(s.id, { ...studentToInput(s), notes: next });
    }

    await invalidateAppData(queryClient);
    onSaved();
    onClose();
  };

  const save = async (scope?: RecurrenceEditScope) => {
    const becomingCompleted = status === "completed" && lesson?.status !== "completed";
    const hasBillableCost = Number(cost) > 0 || Object.values(studentCosts).some((item) => Number(item.cost) > 0);
    if (becomingCompleted && hasBillableCost && paymentStatus === "unpaid") {
      setPaymentPromptOpen(true);
      setPendingScope(scope ?? null);
      return;
    }
    await doSave(scope);
  };

  const handlePaymentChoice = async (paid: boolean) => {
    setPaymentPromptOpen(false);
    const ps: PaymentStatus = paid ? "paid" : "unpaid";
    setPaymentStatus(ps);
    await doSave(pendingScope ?? undefined, ps);
    setPendingScope(null);
  };

  const remove = async () => {
    if (!lesson) return;

    const snapshot = lessonToInput(lesson);
    const wasException = !!lesson.recurrenceParentId && !lesson.id.includes("::");
    const parentId = parentLessonId(lesson);
    const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;
    let deletedId: string | null = null;
    let createdCancelId: string | null = null;
    let cancelledExceptionId: string | null = null;

    if (isRecurrenceInstance(lesson)) {
      if (!window.confirm(t("lesson.confirmDeleteLesson"))) return;
      if (wasException) {
        // Keep the exception row as cancelled so the series slot stays suppressed.
        cancelledExceptionId = lesson.id;
        await api.updateLesson(lesson.id, { ...snapshot, status: "cancelled" });
      } else {
        const created = await api.createLesson({
          ...snapshot,
          recurrenceRule: null,
          recurrenceParentId: parentId,
          recurrenceInstanceDate: instanceDate,
          status: "cancelled",
          startAt: instanceDate,
        });
        createdCancelId = created.id;
      }
    } else if (lesson.recurrenceRule) {
      if (!window.confirm(t("lesson.deleteSeriesConfirm"))) return;
      deletedId = lesson.id;
      await api.deleteLesson(lesson.id);
    } else {
      if (!window.confirm(t("lesson.confirmDeleteLesson"))) return;
      deletedId = lesson.id;
      await api.deleteLesson(lesson.id);
    }

    await invalidateAppData(queryClient);
    onSaved();
    onClose();

    useToastStore.getState().info(t("lesson.deletedToast"), {
      label: t("common.undo"),
      onClick: () => {
        void (async () => {
          try {
            if (createdCancelId) {
              await api.deleteLesson(createdCancelId);
            } else if (cancelledExceptionId) {
              await api.updateLesson(cancelledExceptionId, snapshot);
            } else if (deletedId) {
              await api.createLesson({
                ...snapshot,
                recurrenceParentId: snapshot.recurrenceParentId ?? null,
                recurrenceInstanceDate: snapshot.recurrenceInstanceDate ?? null,
              });
            }
            await invalidateAppData(queryClient);
            onSaved();
          } catch {
            useToastStore.getState().error(t("lesson.undoFailed"));
          }
        })();
      },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => {
        if (!v && !pickerOpen && !paymentPromptOpen && !scopeOpen) onClose();
      }}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-hidden p-0">
          <div className="relative max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>{lesson ? t("lesson.edit") : t("lesson.new")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>{t("lesson.student")}</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => setPickerOpen(true)}
              >
                <Users className="mr-2 h-4 w-4" />
                {displayStudentName || t("students.pickTitle")}
              </Button>
              {selectedStudents.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedStudents.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2 py-1"
                    >
                      <StudentAvatar
                        photoPath={s.photoPath}
                        name={s.name}
                        color={s.color}
                        className="h-6 w-6"
                        textClassName="text-[10px]"
                      />
                      <span className="text-sm">{s.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedStudents.length > 1 && (
                <p className="mt-1 text-xs text-muted-foreground">{t("lesson.groupLesson")}</p>
              )}
            </div>

            {timezoneHints.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2 text-sm dark:bg-blue-950/20">
                {timezoneHints.map((h) => (
                  <p key={h.name}>
                    {t("lesson.studentTime", { name: h.name, time: h.time, tz: h.tz })}
                  </p>
                ))}
              </div>
            )}

            <div>
              <Label>{t("lesson.subject")}</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("lesson.date")}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>{t("lesson.time")}</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("lesson.duration")}</Label>
                <Input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              </div>
              <div>
                <Label>{t("lesson.recurrence")}</Label>
                <Select
                  value={recurrence}
                  onValueChange={(v) => {
                    setRecurrence(v);
                    if (v === "weekly" && weekdays.length === 0 && date) {
                      setWeekdays([parseLocalDateTime(date, time || "10:00").getDay()]);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("lesson.noRecurrence")}</SelectItem>
                    <SelectItem value="weekly">{t("lesson.weekly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {recurrence === "weekly" && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <div>
                  <Label className="mb-2 block text-xs text-muted-foreground">{t("lesson.weekdays")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { d: 1, key: "mon" },
                      { d: 2, key: "tue" },
                      { d: 3, key: "wed" },
                      { d: 4, key: "thu" },
                      { d: 5, key: "fri" },
                      { d: 6, key: "sat" },
                      { d: 0, key: "sun" },
                    ].map(({ d, key }) => {
                      const checked = weekdays.includes(d);
                      return (
                        <label
                          key={key}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setWeekdays((prev) =>
                                checked ? prev.filter((x) => x !== d) : [...prev, d],
                              );
                            }}
                          />
                          {t(`lesson.weekday.${key}`)}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block text-xs text-muted-foreground">{t("lesson.recurrenceEnd")}</Label>
                  <Select
                    value={recurrenceEnd}
                    onValueChange={(v) => setRecurrenceEnd(v as "none" | "until" | "count")}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("lesson.recurrenceNoEnd")}</SelectItem>
                      <SelectItem value="until">{t("lesson.recurrenceUntil")}</SelectItem>
                      <SelectItem value="count">{t("lesson.recurrenceCount")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {recurrenceEnd === "until" && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("lesson.untilDate")}</Label>
                    <Input
                      type="date"
                      value={recurrenceUntil}
                      onChange={(e) => setRecurrenceUntil(e.target.value)}
                    />
                  </div>
                )}
                {recurrenceEnd === "count" && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("lesson.countValue")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={recurrenceCount}
                      onChange={(e) => setRecurrenceCount(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("lesson.cost")}</Label>
                <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div>
                <Label>{t("lesson.currency")}</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedIds.length > 1 && (
              <div className="rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={customGroupCosts}
                    onChange={(e) => setCustomGroupCosts(e.target.checked)}
                  />
                  {t("lesson.individualCosts")}
                </label>
                {customGroupCosts && (
                  <div className="mt-2 space-y-2">
                    {selectedStudents.map((s) => (
                      <div key={s.id} className="grid grid-cols-3 gap-2 items-center">
                        <span className="text-sm truncate">{s.name}</span>
                        <Input
                          type="number"
                          placeholder={cost || t("lesson.cost")}
                          value={studentCosts[s.id]?.cost ?? ""}
                          onChange={(e) =>
                            setStudentCosts((prev) => ({
                              ...prev,
                              [s.id]: { cost: e.target.value, currency: prev[s.id]?.currency || currency },
                            }))
                          }
                        />
                        <Select
                          value={studentCosts[s.id]?.currency || currency}
                          onValueChange={(v) =>
                            setStudentCosts((prev) => ({
                              ...prev,
                              [s.id]: { cost: prev[s.id]?.cost ?? "", currency: v },
                            }))
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>{t("lesson.link")}</Label>
              <div className="flex gap-2">
                <Input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://meet.google.com/..."
                />
                {link.trim() && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openUrl(hrefFor(link.trim()))}
                  >
                    {t("lesson.openLink")}
                  </Button>
                )}
              </div>
            </div>
            {selectedStudents.length > 0 && (
              <div className="grid gap-3">
                {selectedStudents.map((s) => {
                  const value = lessonNotesDraft[s.id] ?? s.notes ?? "";
                  return (
                    <div key={s.id}>
                      <Label>
                        {selectedStudents.length > 1
                          ? `${t("students.notes")} — ${s.name}`
                          : t("students.notes")}
                      </Label>
                      <p className="mb-1 text-xs text-muted-foreground">{t("students.lessonNoteHint")}</p>
                      <Textarea
                        value={value}
                        onChange={(e) =>
                          setLessonNotesDraft((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                      />
                      {textHasLinks(value) && (
                        <LinkifiedText className="mt-1.5 text-sm" text={value} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div>
              <Label>{t("lesson.materials")}</Label>
              <Textarea value={materials} onChange={(e) => setMaterials(e.target.value)} />
              {textHasLinks(materials) && (
                <LinkifiedText className="mt-1.5 text-sm" text={materials} />
              )}
            </div>
            <div>
              <Label>{t("lesson.materialsLink")}</Label>
              <div className="flex gap-2">
                <Input
                  value={materialsLink}
                  onChange={(e) => setMaterialsLink(e.target.value)}
                  placeholder="https://..."
                />
                {materialsLink.trim() && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openUrl(hrefFor(materialsLink.trim()))}
                  >
                    {t("lesson.openLink")}
                  </Button>
                )}
              </div>
            </div>
            <div>
              <Label>{t("lesson.notes")}</Label>
              <p className="mb-1 text-xs text-muted-foreground">{t("lesson.notesHint")}</p>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              {textHasLinks(notes) && (
                <LinkifiedText className="mt-1.5 text-sm" text={notes} />
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <Label className="mb-2 block">{t("lesson.reminders")}</Label>
              <div className="mb-3">
                <Label className="text-xs text-muted-foreground">{t("lesson.reminderCount")}</Label>
                <Select value={reminderCount} onValueChange={(v) => setReminderCount(v as "1" | "2" | "3")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">{t("lesson.oneReminder")}</SelectItem>
                    <SelectItem value="2">{t("lesson.twoReminders")}</SelectItem>
                    <SelectItem value="3">{t("lesson.threeReminders")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {reminderCount === "1" ? t("lesson.reminderWhen") : t("lesson.reminderFirst")}
                  </Label>
                  <Select value={reminder1} onValueChange={setReminder1}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REMINDER_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(reminderCount === "2" || reminderCount === "3") && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("lesson.reminderSecond")}</Label>
                    <Select value={reminder2} onValueChange={setReminder2}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REMINDER_PRESETS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {reminderCount === "3" && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("lesson.reminderThird")}</Label>
                    <Select value={reminder3} onValueChange={setReminder3}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REMINDER_PRESETS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>{t("finance.payment")}</Label>
              <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">{t("finance.unpaid")}</SelectItem>
                  <SelectItem value="paid">{t("finance.paid")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t("lesson.status")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["scheduled", "completed", "cancelled", "no_show"] as const).map((s) => (
                    <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {overlapWarning && (
              <div className="space-y-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                <p>{overlapWarning}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => void save(pendingScope || undefined)}
                >
                  {t("lesson.saveAnyway")}
                </Button>
              </div>
            )}
            <div className="flex justify-between gap-2 pt-2">
              {lesson && (
                <Button variant="destructive" onClick={() => void remove()}>{t("lesson.delete")}</Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button onClick={() => void save(pendingScope || undefined)}>{t("lesson.save")}</Button>
              </div>
            </div>
          </div>

          <StudentPickerDialog
            embedded
            open={pickerOpen}
            students={allStudents}
            selectedIds={selectedIds}
            tutorTimezone={tutorTimezone}
            onClose={() => setPickerOpen(false)}
            onConfirm={handlePickStudents}
            onStudentCreated={() => {
              void invalidateAppData(queryClient);
            }}
          />
          </div>
        </DialogContent>
      </Dialog>

      <RecurrenceScopeDialog
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
        onSelect={(scope) => {
          setPendingScope(scope);
          setScopeOpen(false);
          void save(scope);
        }}
      />
      <PaymentCompleteDialog
        open={paymentPromptOpen}
        studentName={displayStudentName}
        onPaid={() => void handlePaymentChoice(true)}
        onUnpaid={() => void handlePaymentChoice(false)}
        onCancel={() => {
          setPaymentPromptOpen(false);
          setPendingScope(null);
        }}
      />
    </>
  );
}
