import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import type { Lesson, LessonInput, LessonStudentInput, RecurrenceEditScope } from "@/types/lesson";
import { lessonToInput } from "@/types/lesson";
import { studentToInput } from "@/types/student";
import { api, overlapNamesFromError } from "@/lib/api";
import { CURRENCIES } from "@/lib/money";
import { formatTimeInTimezone } from "@/lib/contacts";
import { parseLocalDateTime, realLessonId, isRecurrenceInstance, parentLessonId, WEEKLY_RULE, buildWeeklyRule, parseByday, parseUntil, parseCount } from "@/lib/recurrence";
import { hrefFor, textHasLinks } from "@/lib/linkify";
import { buildParticipantInputs, templateParticipants } from "@/lib/lessonMutation";
import { lessonEnd } from "@/lib/timeInput";
import { conflictFor, createGeneration, mayForce, overlapKey, singleFlight, type OverlapConflict, type OverlapPayload } from "@/lib/dialogOperation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import { useRescheduleStore } from "./RescheduleDialog";
import { PaymentCompleteDialog } from "./PaymentCompleteDialog";
import { StudentPickerDialog } from "@/components/students/StudentPickerDialog";
import { StudentAvatar } from "@/components/students/StudentAvatar";
import { LinkifiedText } from "@/components/LinkifiedText";
import type { PaymentStatus } from "@/types/lesson";
import { Bell, CalendarClock, Flag, Link2, Repeat, Users, Wallet, type LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";

const REMINDER_PRESETS = [
  { value: 1440, labelKey: "reminder.dayBefore" },
  { value: 120, labelKey: "reminder.hours2" },
  { value: 60, labelKey: "reminder.hourBefore" },
  { value: 30, labelKey: "reminder.min30" },
  { value: 15, labelKey: "reminder.min15" },
  { value: 5, labelKey: "reminder.min5" },
  { value: 0, labelKey: "reminder.atStart" },
] as const;

const STATUS_OPTIONS = [
  { value: "scheduled", active: "border-primary bg-primary text-primary-foreground" },
  { value: "completed", active: "border-green-600 bg-green-600 text-white" },
  { value: "cancelled", active: "border-border bg-muted text-muted-foreground line-through" },
  { value: "no_show", active: "border-amber-500 bg-amber-500 text-white" },
] as const;

function FormSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

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
  const [reminderMins, setReminderMins] = useState<number[]>([]);
  const [recurrence, setRecurrence] = useState("none");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [recurrenceEnd, setRecurrenceEnd] = useState<"none" | "until" | "count">("none");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [recurrenceCount, setRecurrenceCount] = useState("10");
  // Recurrence edited in this session: only then does "this and following" send a new rule.
  const [recurrenceTouched, setRecurrenceTouched] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<(OverlapConflict & { scope?: RecurrenceEditScope }) | null>(null);
  const [saving, setSaving] = useState(false);
  const confirmedRef = useRef<OverlapConflict | null>(null);
  const [session] = useState(createGeneration);
  const sessionRef = useRef(0);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [customGroupCosts, setCustomGroupCosts] = useState(false);

  const reminderValues = useMemo(
    () => [...new Set(reminderMins)].sort((a, b) => b - a),
    [reminderMins],
  );

  const reminderOptions = useMemo(() => {
    const options: { value: number; label: string }[] = REMINDER_PRESETS.map((p) => ({
      value: p.value,
      label: t(p.labelKey),
    }));
    for (const m of reminderMins) {
      if (!options.some((o) => o.value === m)) {
        options.push({ value: m, label: `${m} ${t("today.min")}` });
      }
    }
    return options.sort((a, b) => b.value - a.value);
  }, [reminderMins, t]);

  const [timePanelHost, setTimePanelHost] = useState<HTMLDivElement | null>(null);
  const [timeValid, setTimeValid] = useState(true);
  const endTimeLabel = useMemo(() => {
    const end = lessonEnd(time, duration);
    if (!end) return "";
    return end.dayOffset > 0 ? `${end.end} (${t("timePicker.nextDay")})` : end.end;
  }, [time, duration, t]);

  const toggleReminder = (mins: number) => {
    setReminderMins((prev) =>
      prev.includes(mins) ? prev.filter((m) => m !== mins) : [...prev, mins],
    );
  };

  const selectedStudents = useMemo(
    () => allStudents.filter((s) => selectedIds.includes(s.id)),
    [allStudents, selectedIds],
  );

  const displayStudentName = selectedStudents.map((s) => s.name).join(", ");

  const startAtIso = date && time ? parseLocalDateTime(date, time).toISOString() : "";
  // A conflict is shown only for the payload it was found for.
  const visibleConflict = conflict
    ? conflictFor(conflict, { startAt: startAtIso, durationMinutes: duration, scope: conflict.scope ?? null })
    : null;

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
      setReminderMins([...new Set(mins)].sort((a, b) => b - a));
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
      setReminderMins([...new Set(sorted)]);
    }
    setFieldError(null);
    setConflict(null);
    confirmedRef.current = null;
    setRecurrenceTouched(false);
    setTimeValid(true);
    setPendingScope(null);
    setScopeOpen(false);
    setPaymentPromptOpen(false);
    setPickerOpen(false);
  }, [open, lesson, initialDate, initialStudentIds, defaultDuration, defaultReminders]);

  useEffect(() => {
    sessionRef.current = session.begin();
  }, [open, lesson?.id, session]);

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

  const buildStudentsInput = (payStatus: PaymentStatus): LessonStudentInput[] =>
    buildParticipantInputs(
      { selectedIds, customGroupCosts, studentCosts, cost, currency, paymentStatus: payStatus },
      lesson ?? null,
    );

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

  const buildInput = (payStatus: PaymentStatus = paymentStatus): LessonInput => {
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
      paymentStatus: payStatus,
      recurrenceRule,
      recurrenceParentId: lesson?.recurrenceParentId || null,
      recurrenceInstanceDate: lesson?.recurrenceInstanceDate || null,
      color: lesson?.color || null,
      students: buildStudentsInput(payStatus),
      reminders: reminderValues,
      force: false,
    };
  };

  const overlapPayload = (startAt: string, durationMinutes: number, scope?: RecurrenceEditScope): OverlapPayload => ({
    startAt,
    durationMinutes,
    scope: scope ?? null,
  });

  const doSave = async (scope?: RecurrenceEditScope, payStatus?: PaymentStatus) => {
    const sid = sessionRef.current;
    const live = () => session.isCurrent(sid);
    if (selectedIds.length === 0) {
      setFieldError(t("students.pickRequired"));
      return;
    }
    setFieldError(null);
    const input = buildInput(payStatus ?? paymentStatus);
    const payload = overlapPayload(input.startAt, input.durationMinutes, scope);
    const showConflict = (names: string) => {
      confirmedRef.current = null;
      setConflict({ key: overlapKey(payload), names, confirmed: false, scope });
    };
    if (mayForce(confirmedRef.current, payload)) {
      input.force = true;
    } else {
      const excludeId = !lesson
        ? undefined
        : scope === "all" || scope === "thisAndFuture"
          ? parentLessonId(lesson)
          : lesson.id;
      const overlaps = await api.checkOverlaps(input.startAt, input.durationMinutes, excludeId);
      if (!live()) return;
      if (overlaps.length > 0) {
        showConflict(overlaps.map((o) => o.studentName).join(", "));
        return;
      }
      setConflict(null);
    }

    try {
      if (lesson) {
        const id = realLessonId(lesson.id);
        const parentId = parentLessonId(lesson);
        const instanceDate = lesson.recurrenceInstanceDate || lesson.startAt;

        if (scope === "this" && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
          if (lesson.recurrenceParentId && !lesson.id.includes("::")) {
            // Уже материализованная exception-строка — это обновление, не создание.
            await api.updateLesson(lesson.id, input);
          } else {
            await api.createLesson({
              ...input,
              recurrenceRule: null,
              recurrenceParentId: parentId,
              recurrenceInstanceDate: instanceDate,
            });
          }
        } else if (scope === "thisAndFuture" && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
          await api.splitLessonSeries(
            parentId,
            instanceDate,
            { ...input, students: templateParticipants(input.students), recurrenceParentId: null, recurrenceInstanceDate: null },
            recurrenceTouched ? buildRecurrenceRule() : null,
          );
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
            students: templateParticipants(input.students),
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
    } catch (e) {
      const names = overlapNamesFromError(e);
      if (names !== null) {
        if (live()) showConflict(names);
        return;
      }
      throw e;
    }

    // Committed: later failures must not invite a second save (a new lesson would be duplicated).
    for (const s of selectedStudents) {
      const next = lessonNotesDraft[s.id] ?? s.notes ?? "";
      if (next === (s.notes ?? "")) continue;
      await api.updateStudent(s.id, { ...studentToInput(s), notes: next }).catch(() => undefined);
    }
    try {
      await invalidateAppData(queryClient);
    } catch {
      useToastStore.getState().error(t("lesson.savedRefreshFailed"));
    }
    if (!live()) return;
    onSaved();
    onClose();
  };

  const [saveFlight] = useState(() =>
    singleFlight(async (run: () => Promise<void>) => {
      setSaving(true);
      try {
        await run();
      } catch {
        // api.call has already shown the error; the draft stays for a retry.
      } finally {
        setSaving(false);
      }
    }),
  );

  const save = async (scope?: RecurrenceEditScope) => {
    if (!timeValid || saveFlight.isRunning()) return;
    if (lesson && !scope && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
      setScopeOpen(true);
      return;
    }
    const becomingCompleted = status === "completed" && lesson?.status !== "completed";
    const hasBillableCost = Number(cost) > 0 || Object.values(studentCosts).some((item) => Number(item.cost) > 0);
    if (becomingCompleted && hasBillableCost && paymentStatus === "unpaid") {
      setPaymentPromptOpen(true);
      setPendingScope(scope ?? null);
      return;
    }
    await saveFlight(() => doSave(scope));
  };

  const confirmOverlap = () => {
    if (!conflict) return;
    confirmedRef.current = { ...conflict, confirmed: true };
    void save(conflict.scope);
  };

  const handlePaymentChoice = async (paid: boolean) => {
    setPaymentPromptOpen(false);
    const ps: PaymentStatus = paid ? "paid" : "unpaid";
    setPaymentStatus(ps);
    const scope = pendingScope ?? undefined;
    setPendingScope(null);
    await saveFlight(() => doSave(scope, ps));
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
          <div className="relative flex max-h-[90vh] flex-col">
          <div className="overflow-y-auto p-6 pb-4">
          <DialogHeader>
            <DialogTitle>{lesson ? t("lesson.edit") : t("lesson.new")}</DialogTitle>
          </DialogHeader>
          {timezoneHints.length > 0 && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-2 text-sm dark:bg-blue-950/20">
              {timezoneHints.map((h) => (
                <p key={h.name}>
                  {t("lesson.studentTime", { name: h.name, time: h.time, tz: h.tz })}
                </p>
              ))}
            </div>
          )}
          <Tabs defaultValue="main" className="mt-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="main">{t("lesson.tabMain")}</TabsTrigger>
              <TabsTrigger value="links">{t("lesson.sectionLinks")}</TabsTrigger>
              <TabsTrigger value="reminders">{t("lesson.reminders")}</TabsTrigger>
            </TabsList>
            <TabsContent value="main" className="grid gap-3">
            <FormSection icon={Users} title={t("lesson.sectionWho")}>
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

              <div>
                <Label htmlFor="lesson-subject">{t("lesson.subject")}</Label>
                <Input id="lesson-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="lesson-date">{t("lesson.date")}</Label>
                  <Input id="lesson-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="lesson-time">{t("lesson.time")}</Label>
                  <TimePicker
                    id="lesson-time"
                    value={time}
                    onChange={setTime}
                    panelHost={timePanelHost}
                    describedBy={endTimeLabel ? "lesson-end-time" : undefined}
                    onValidityChange={setTimeValid}
                  />
                </div>
                <div>
                  <Label htmlFor="lesson-duration">{t("lesson.duration")}</Label>
                  <Input id="lesson-duration" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                  {endTimeLabel && (
                    <p id="lesson-end-time" className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {time} → {endTimeLabel}
                    </p>
                  )}
                </div>
                <div ref={setTimePanelHost} className="col-span-3 empty:hidden" />
              </div>
            </FormSection>

            <FormSection icon={Repeat} title={t("lesson.recurrence")}>
              <Select
                value={recurrence}
                onValueChange={(v) => {
                  setRecurrence(v);
                  setRecurrenceTouched(true);
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
              {recurrence === "weekly" && (
                <div className="space-y-3">
                  <div>
                    <Label className="mb-2 block text-xs text-muted-foreground">{t("lesson.weekdays")}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { d: 1, key: "mon" },
                        { d: 2, key: "tue" },
                        { d: 3, key: "wed" },
                        { d: 4, key: "thu" },
                        { d: 5, key: "fri" },
                        { d: 6, key: "sat" },
                        { d: 0, key: "sun" },
                      ].map(({ d, key }) => {
                        const active = weekdays.includes(d);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={cn(
                              "h-8 w-8 rounded-full border text-xs font-medium transition-colors",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground hover:bg-muted",
                            )}
                            onClick={() => {
                              setRecurrenceTouched(true);
                              setWeekdays((prev) =>
                                active ? prev.filter((x) => x !== d) : [...prev, d],
                              );
                            }}
                          >
                            {t(`lesson.weekday.${key}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs text-muted-foreground">{t("lesson.recurrenceEnd")}</Label>
                    <Select
                      value={recurrenceEnd}
                      onValueChange={(v) => {
                        setRecurrenceTouched(true);
                        setRecurrenceEnd(v as "none" | "until" | "count");
                      }}
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
                      <Label htmlFor="lesson-until" className="text-xs text-muted-foreground">{t("lesson.untilDate")}</Label>
                      <Input
                        id="lesson-until"
                        type="date"
                        value={recurrenceUntil}
                        onChange={(e) => {
                          setRecurrenceTouched(true);
                          setRecurrenceUntil(e.target.value);
                        }}
                      />
                    </div>
                  )}
                  {recurrenceEnd === "count" && (
                    <div>
                      <Label htmlFor="lesson-count" className="text-xs text-muted-foreground">{t("lesson.countValue")}</Label>
                      <Input
                        id="lesson-count"
                        type="number"
                        min={1}
                        max={500}
                        value={recurrenceCount}
                        onChange={(e) => {
                          setRecurrenceTouched(true);
                          setRecurrenceCount(e.target.value);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </FormSection>

            <FormSection icon={Wallet} title={t("finance.payment")}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lesson-cost">{t("lesson.cost")}</Label>
                  <Input id="lesson-cost" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
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
                            aria-label={`${t("lesson.cost")}: ${s.name}`}
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
            </FormSection>

            <FormSection icon={Flag} title={t("lesson.sectionStatus")}>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">{t("lesson.status")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map((opt) => {
                    const active = status === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        title={t(`status.${opt.value}`)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          active
                            ? opt.active
                            : "border-border bg-card text-muted-foreground hover:bg-muted",
                        )}
                        onClick={() => setStatus(opt.value)}
                      >
                        {t(`lesson.statusChip.${opt.value}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">{t("finance.payment")}</Label>
                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                  {(["unpaid", "paid"] as const).map((v) => {
                    const active = paymentStatus === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        className={cn(
                          "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                          active
                            ? v === "paid"
                              ? "bg-green-600 text-white"
                              : "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setPaymentStatus(v)}
                      >
                        {t(v === "paid" ? "finance.paid" : "finance.unpaid")}
                      </button>
                    );
                  })}
                </div>
              </div>
            </FormSection>
            </TabsContent>

            <TabsContent value="links" className="grid gap-3">
            <FormSection icon={Link2} title={t("lesson.sectionLinks")}>
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
            </FormSection>

            </TabsContent>

            <TabsContent value="reminders" className="grid gap-3">
            <FormSection icon={Bell} title={t("lesson.reminders")}>
              <div className="flex flex-wrap gap-1.5">
                {reminderOptions.map((o) => {
                  const active = reminderMins.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => toggleReminder(o.value)}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </FormSection>

            </TabsContent>
          </Tabs>
          </div>
          <div className="border-t px-6 py-3">
            {fieldError && (
              <p role="alert" className="text-sm text-destructive">{fieldError}</p>
            )}
            {visibleConflict && (
              <div role="alert" className="space-y-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                <p>{`${t("lesson.overlap")}: ${visibleConflict.names}. ${t("lesson.overlapConfirm")}`}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  disabled={!timeValid || saving}
                  onClick={confirmOverlap}
                >
                  {t("lesson.saveAnyway")}
                </Button>
              </div>
            )}
            <div className="flex justify-between gap-2 pt-2">
              {lesson && (
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => void remove()}>{t("lesson.delete")}</Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      onClose();
                      useRescheduleStore.getState().open(lesson);
                    }}
                  >
                    <CalendarClock className="mr-2 h-4 w-4" />
                    {t("lesson.rescheduleAction")}
                  </Button>
                </div>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button disabled={!timeValid || saving} aria-busy={saving} onClick={() => void save()}>
                  {saving ? t("lesson.saving") : t("lesson.save")}
                </Button>
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
