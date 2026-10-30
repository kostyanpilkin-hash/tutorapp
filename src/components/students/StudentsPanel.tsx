import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO, addMonths, subYears, startOfDay, endOfDay } from "date-fns";
import { ru, enUS, be as beLocale } from "date-fns/locale";
import { Archive, ArchiveRestore, CheckCircle2, Plus, Search, User, Wallet } from "lucide-react";
import type { Lesson } from "@/types/lesson";
import type { Student, StudentFinance } from "@/types/student";
import { api } from "@/lib/api";
import { applyTemplate, loadMessageTemplates } from "@/lib/messageTemplates";
import type { MessageTemplate } from "@/lib/messageTemplates";
import { messengerUrl } from "@/lib/contacts";
import { openUrl } from "@tauri-apps/plugin-opener";
import { lessonPaymentStatus, setLessonPaid, setLessonStatus } from "@/lib/lessonActions";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import { LinkifiedText } from "@/components/LinkifiedText";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StudentFormDialog } from "./StudentFormDialog";
import { StudentAvatar } from "./StudentAvatar";
import { formatMoney, numberLocaleFromLang, sortCurrencies } from "@/lib/money";
import { loadExpandedLessons } from "@/lib/recurrence";
import { cn } from "@/lib/utils";

const locales = { ru, en: enUS, be: beLocale };
const HISTORY_STEP = 50;

interface Props {
  onOpenLesson?: (lesson: Lesson) => void;
  onCreateLesson?: (studentId: string) => void;
}

function AmountBlock({
  title,
  items,
  className,
  locale,
}: {
  title: string;
  items: { currency: string; amount: number }[];
  className?: string;
  locale: string;
}) {
  const sorted = sortCurrencies(items.map((i) => i.currency))
    .map((currency) => items.find((i) => i.currency === currency)!)
    .filter(Boolean);

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      {sorted.length === 0 ? (
        <p className="font-semibold">—</p>
      ) : (
        sorted.map((i) => (
          <p key={i.currency} className="font-semibold tabular-nums">
            {formatMoney(i.amount, i.currency, locale)}
          </p>
        ))
      )}
    </div>
  );
}

export function StudentsPanel({ onOpenLesson, onCreateLesson }: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const tutorTimezone = useSettingsStore((s) => s.timezone);
  const toast = useToastStore(
    useShallow((s) => ({ error: s.error, info: s.info, success: s.success })),
  );
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [expandedLessons, setExpandedLessons] = useState<Lesson[]>([]);
  const [finance, setFinance] = useState<StudentFinance | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"past" | "upcoming">("past");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [historyLimit, setHistoryLimit] = useState(HISTORY_STEP);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("__none__");

  const loadStudents = useCallback(async () => {
    const data = await api.getStudents(showArchived);
    setStudents(data);
    if (selectedId && !data.find((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [showArchived, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const now = new Date();
      const [ls, fin, expanded] = await Promise.all([
        api.getStudentLessons(id),
        api.getStudentFinance(id),
        loadExpandedLessons(startOfDay(subYears(now, 2)), endOfDay(addMonths(now, 2))),
      ]);
      setLessons(ls);
      setFinance(fin);
      setExpandedLessons(expanded.filter((l) => l.students.some((s) => s.studentId === id)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setLessons([]);
      setExpandedLessons([]);
      setFinance(null);
    }
  }, [selectedId, loadDetail]);

  useEffect(() => {
    setHistoryLimit(HISTORY_STEP);
    setPaymentFilter("all");
    setSubjectFilter("all");
  }, [selectedId, historyFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  const selected = students.find((s) => s.id === selectedId) ?? null;

  const upcomingLessons = useMemo(() => {
    const now = new Date();
    const from = startOfDay(now).getTime();
    const to = endOfDay(addMonths(now, 2)).getTime();
    return expandedLessons
      .filter((l) => {
        const t = new Date(l.startAt).getTime();
        return t >= from && t <= to && l.status === "scheduled";
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [expandedLessons]);

  const historyLessons = useMemo(() => {
    const now = new Date();
    let list: Lesson[];
    if (historyFilter === "past") {
      const to = endOfDay(now).getTime();
      list = expandedLessons
        .filter(
          (l) =>
            new Date(l.startAt).getTime() <= to &&
            (l.status === "completed" || l.status === "no_show" || l.status === "cancelled"),
        )
        .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
    } else {
      list = upcomingLessons;
    }
    if (paymentFilter !== "all") {
      list = list.filter((l) => lessonPaymentStatus(l) === paymentFilter);
    }
    if (subjectFilter !== "all") {
      list = list.filter((l) => (l.subject || "") === subjectFilter);
    }
    return list;
  }, [expandedLessons, historyFilter, upcomingLessons, paymentFilter, subjectFilter]);

  const subjectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of lessons) {
      if (l.subject?.trim()) set.add(l.subject.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [lessons]);

  const selectedTemplate = useMemo(
    () => messageTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [messageTemplates, selectedTemplateId],
  );

  const nextLesson = upcomingLessons[0] ?? null;

  const openCreate = () => {
    setEditStudent(null);
    setFormOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setEditStudent(selected);
    setFormOpen(true);
  };

  const toggleArchive = async () => {
    if (!selected) return;
    if (!selected.archived && !window.confirm(t("students.confirmArchiveStudent"))) return;
    await api.archiveStudent(selected.id, !selected.archived);
    await loadStudents();
  };

  useEffect(() => {
    if (!messageDialogOpen) return;
    void loadMessageTemplates()
      .then((templates) => setMessageTemplates(templates))
      .catch(() => setMessageTemplates([]));
  }, [messageDialogOpen]);

  const openMessageDialog = () => {
    setSelectedTemplateId("__none__");
    setMessageDialogOpen(true);
  };

  const contactStudent = async () => {
    if (!selected) return;
    const url = messengerUrl(selected.messenger, selected.phone);
    if (!url) return;

    const text = selectedTemplate
      ? applyTemplate(selectedTemplate.body, {
          name: selected.name,
          parentName: selected.parentName || selected.parents,
          link: nextLesson?.link,
          subject: nextLesson?.subject,
          time: nextLesson ? format(parseISO(nextLesson.startAt), "d MMM yyyy, HH:mm", { locale }) : null,
        }).trim()
      : "";

    if (text) {
      await navigator.clipboard.writeText(text);
      toast.success(t("students.templateCopied"));
    }

    await openUrl(url);
    setMessageDialogOpen(false);
  };

  const refreshHistory = async () => {
    if (!selectedId) return;
    await loadDetail(selectedId);
  };

  const refreshFinance = async () => {
    if (!selectedId) return;
    const data = await api.getStudentFinance(selectedId);
    setFinance(data);
  };

  const quickComplete = async (lesson: Lesson, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await setLessonStatus(lesson, "completed");
      toast.info(t("today.markedCompleted"));
      await refreshHistory();
    } catch {
      // api toasts
    }
  };

  const quickPaid = async (lesson: Lesson, e: React.MouseEvent) => {
    e.stopPropagation();
    const paid = lessonPaymentStatus(lesson) === "paid";
    try {
      await setLessonPaid(lesson, !paid);
      toast.info(paid ? t("today.markedUnpaid") : t("today.markedPaid"));
      await refreshHistory();
    } catch {
      // api toasts
    }
  };

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      <div className="flex w-72 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{t("students.title")}</h2>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("students.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? t("students.hideArchived") : t("students.showArchived")}
        </Button>
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              data-student-card
              onClick={() => setSelectedId(s.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm",
                selectedId === s.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                s.archived && "opacity-60",
              )}
            >
              <StudentAvatar
                photoPath={s.photoPath}
                name={s.name}
                color={s.color}
                className="h-8 w-8"
                textClassName="text-xs"
              />
              <span className="truncate font-medium">{s.name}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="animate-fade-up py-8 text-center">
              <p className="font-display text-base font-semibold">{t("students.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.addStudent")}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card p-4">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <User className="mb-2 h-12 w-12 opacity-40" />
            <p>{t("students.selectHint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <StudentAvatar
                  photoPath={selected.photoPath}
                  name={selected.name}
                  color={selected.color}
                  className="h-16 w-16"
                  textClassName="text-xl"
                />
                <div>
                  <h3 className="text-2xl font-bold">{selected.name}</h3>
                  {selected.archived && (
                    <span className="text-sm text-muted-foreground">{t("students.archived")}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onCreateLesson?.(selected.id)}>
                  {t("students.newLesson")}
                </Button>
                <Button size="sm" variant="outline" onClick={openEdit}>{t("students.edit")}</Button>
                {(selected.messenger || selected.phone) && (
                  <Button size="sm" variant="outline" onClick={openMessageDialog}>
                    {t("students.openMessenger")}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => void toggleArchive()}>
                  {selected.archived ? (
                    <><ArchiveRestore className="mr-1 h-4 w-4" />{t("students.restore")}</>
                  ) : (
                    <><Archive className="mr-1 h-4 w-4" />{t("students.archive")}</>
                  )}
                </Button>
              </div>
            </div>

            <div className="grid gap-2 text-sm md:grid-cols-2">
              {selected.phone && <p><span className="text-muted-foreground">{t("students.phone")}:</span> {selected.phone}</p>}
              {selected.email && <p><span className="text-muted-foreground">{t("students.email")}:</span> {selected.email}</p>}
              {selected.messenger && <p><span className="text-muted-foreground">{t("students.messenger")}:</span> {selected.messenger}</p>}
              {selected.parentName && <p><span className="text-muted-foreground">{t("students.parentName")}:</span> {selected.parentName}</p>}
              {selected.parentPhone && <p><span className="text-muted-foreground">{t("students.parentPhone")}:</span> {selected.parentPhone}</p>}
              {selected.parentMessenger && <p><span className="text-muted-foreground">{t("students.parentMessenger")}:</span> {selected.parentMessenger}</p>}
              {!selected.parentName && !selected.parentPhone && !selected.parentMessenger && selected.parents && (
                <p><span className="text-muted-foreground">{t("students.parents")}:</span> {selected.parents}</p>
              )}
              {selected.birthDate && <p><span className="text-muted-foreground">{t("students.birthDate")}:</span> {selected.birthDate}</p>}
              {selected.timezone && <p><span className="text-muted-foreground">{t("students.timezone")}:</span> {selected.timezone}</p>}
            </div>
            {selected.notes && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="mb-1 font-medium text-muted-foreground">{t("students.notes")}</p>
                <LinkifiedText text={selected.notes} />
              </div>
            )}

            {finance && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-medium">{t("students.finance")}</h4>
                  {selected.paidLessons && selected.paidLessons > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api.applyPrepaidLessons(selected.id);
                          toast.info(t("students.prepaidApplied"));
                          await refreshFinance();
                          await refreshHistory();
                        } catch {
                          // api toasts
                        }
                      }}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                      {t("students.applyPrepaid")}
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <AmountBlock title={t("finance.earned")} items={finance.earned} className="border-green-200" locale={numberLocaleFromLang(i18n.language)} />
                  <AmountBlock title={t("finance.debt")} items={finance.debt} className="border-amber-200" locale={numberLocaleFromLang(i18n.language)} />
                  <AmountBlock title={t("finance.expected")} items={finance.expected} className="border-blue-200" locale={numberLocaleFromLang(i18n.language)} />
                </div>
                {selected.paidLessons && selected.paidLessons > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("students.prepaidInfo", { count: selected.paidLessons })}
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">{t("students.lessonHistory")}</h4>
                <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5">
                  <Button
                    size="sm"
                    variant={historyFilter === "past" ? "default" : "ghost"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setHistoryFilter("past")}
                  >
                    {t("students.historyPast")}
                  </Button>
                  <Button
                    size="sm"
                    variant={historyFilter === "upcoming" ? "default" : "ghost"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setHistoryFilter("upcoming")}
                  >
                    {t("students.historyUpcoming")}
                  </Button>
                </div>
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as "all" | "paid" | "unpaid")}>
                  <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("students.filterPaymentAll")}</SelectItem>
                    <SelectItem value="paid">{t("payment.paid")}</SelectItem>
                    <SelectItem value="unpaid">{t("payment.unpaid")}</SelectItem>
                  </SelectContent>
                </Select>
                {subjectOptions.length > 0 && (
                  <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                    <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("students.filterSubjectAll")}</SelectItem>
                      {subjectOptions.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {loading ? (
                <p className="text-sm text-muted-foreground">{t("finance.loading")}</p>
              ) : historyLessons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {historyFilter === "past" ? t("students.historyEmptyPast") : t("students.historyEmptyUpcoming")}
                </p>
              ) : (
                <div className="space-y-1">
                  {historyLessons.slice(0, historyLimit).map((l) => {
                    const paid = lessonPaymentStatus(l) === "paid";
                    return (
                      <div
                        key={l.id}
                        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenLesson?.(l)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="font-medium">{format(parseISO(l.startAt), "d MMM yyyy, HH:mm", { locale })}</span>
                          {l.subject && <span className="ml-2 text-muted-foreground">— {l.subject}</span>}
                          <span className="ml-2 text-muted-foreground">{t(`status.${l.status}`)}</span>
                        </button>
                        <div className="flex shrink-0 gap-1">
                          {l.status !== "completed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              title={t("status.completed")}
                              onClick={(e) => void quickComplete(l, e)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title={paid ? t("payment.unpaid") : t("payment.paid")}
                            onClick={(e) => void quickPaid(l, e)}
                          >
                            <Wallet className={cn("h-4 w-4", paid && "text-green-600")} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {historyLessons.length > historyLimit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full"
                      onClick={() => setHistoryLimit((n) => n + HISTORY_STEP)}
                    >
                      {t("students.showMore")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <StudentFormDialog
        open={formOpen}
        student={editStudent}
        tutorTimezone={tutorTimezone}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void loadStudents();
          void useSettingsStore.getState().setOnboardingDone();
        }}
      />
      <Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("students.messageDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("students.messageTemplate")}</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("students.messageWithoutTemplate")}</SelectItem>
                  {messageTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTemplate && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("students.messagePreview")}</p>
                <p className="whitespace-pre-wrap">
                  {applyTemplate(selectedTemplate.body, {
                    name: selected?.name,
                    parentName: selected?.parentName || selected?.parents,
                    link: nextLesson?.link,
                    subject: nextLesson?.subject,
                    time: nextLesson ? format(parseISO(nextLesson.startAt), "d MMM yyyy, HH:mm", { locale }) : null,
                  }) || "—"}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("students.messageHint")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMessageDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="outline" onClick={() => void contactStudent()}>
                {t("students.sendToMessenger")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
