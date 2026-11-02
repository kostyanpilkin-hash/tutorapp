import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO, addMonths, subYears, startOfDay, endOfDay } from "date-fns";
import { ru, enUS, be as beLocale } from "date-fns/locale";
import {
  Archive,
  ArchiveRestore,
  Cake,
  CheckCircle2,
  Coins,
  Contact,
  Copy,
  ExternalLink,
  Globe,
  History,
  Mail,
  MessageCircle,
  NotebookText,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Search,
  TrendingUp,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Lesson } from "@/types/lesson";
import type { Student } from "@/types/student";
import { api } from "@/lib/api";
import { keys, invalidateAppData } from "@/lib/queryKeys";
import { applyTemplate, loadMessageTemplates } from "@/lib/messageTemplates";
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
  focusStudent?: { id: string; seq: number } | null;
}

function AmountBlock({
  title,
  items,
  className,
  locale,
  icon: Icon,
}: {
  title: string;
  items: { currency: string; amount: number }[];
  className?: string;
  locale: string;
  icon?: LucideIcon;
}) {
  const sorted = sortCurrencies(items.map((i) => i.currency))
    .map((currency) => items.find((i) => i.currency === currency)!)
    .filter(Boolean);

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </p>
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

function ContactRow({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
      {children && <div className="flex shrink-0 gap-1">{children}</div>}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  completed: "bg-green-500",
  no_show: "bg-amber-500",
  cancelled: "bg-muted-foreground/50",
  scheduled: "bg-blue-500",
};

export function StudentsPanel({ onOpenLesson, onCreateLesson, focusStudent }: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const tutorTimezone = useSettingsStore((s) => s.timezone);
  const toast = useToastStore(
    useShallow((s) => ({ error: s.error, info: s.info, success: s.success })),
  );
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"past" | "upcoming">("past");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [historyLimit, setHistoryLimit] = useState(HISTORY_STEP);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("__none__");
  const templatesQuery = useQuery({
    queryKey: keys.messageTemplates(),
    queryFn: () => loadMessageTemplates(),
    enabled: messageDialogOpen,
  });
  const messageTemplates = templatesQuery.data ?? [];
  const [historyWindow] = useState(() => {
    const now = new Date();
    return { from: startOfDay(subYears(now, 2)), to: endOfDay(addMonths(now, 2)) };
  });

  const studentsQuery = useQuery({
    queryKey: keys.students.all(showArchived),
    queryFn: () => api.getStudents(showArchived),
  });
  const students = studentsQuery.data ?? [];

  const detailEnabled = selectedId !== null;
  const lessonsQuery = useQuery({
    queryKey: keys.students.lessons(selectedId ?? ""),
    queryFn: () => api.getStudentLessons(selectedId!),
    enabled: detailEnabled,
  });
  const financeQuery = useQuery({
    queryKey: keys.students.finance(selectedId ?? ""),
    queryFn: () => api.getStudentFinance(selectedId!),
    enabled: detailEnabled,
  });
  const expandedQuery = useQuery({
    queryKey: keys.students.expanded(
      selectedId ?? "",
      historyWindow.from.toISOString(),
      historyWindow.to.toISOString(),
    ),
    queryFn: () => loadExpandedLessons(historyWindow.from, historyWindow.to),
    enabled: detailEnabled,
  });
  const lessons = lessonsQuery.data ?? [];
  const finance = financeQuery.data ?? null;
  const expandedLessons = useMemo(
    () =>
      (expandedQuery.data ?? []).filter((l) =>
        l.students.some((s) => s.studentId === selectedId),
      ),
    [expandedQuery.data, selectedId],
  );
  const loading =
    detailEnabled &&
    (lessonsQuery.isPending || financeQuery.isPending || expandedQuery.isPending);

  useEffect(() => {
    if (focusStudent) setSelectedId(focusStudent.id);
  }, [focusStudent]);

  useEffect(() => {
    if (selectedId && students.length > 0 && !students.find((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [students, selectedId]);

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

  const debtBadge = useMemo(() => {
    const localeTag = numberLocaleFromLang(i18n.language);
    return (finance?.debt ?? [])
      .filter((i) => i.amount > 0)
      .map((i) => formatMoney(i.amount, i.currency, localeTag))
      .join(" · ");
  }, [finance, i18n.language]);

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t("common.copied"));
  };

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
    await invalidateAppData(queryClient);
  };

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

  const quickComplete = async (lesson: Lesson, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await setLessonStatus(lesson, "completed");
      toast.info(t("today.markedCompleted"));
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
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-bold">{selected.name}</h3>
                    {selected.archived && (
                      <span className="text-sm text-muted-foreground">{t("students.archived")}</span>
                    )}
                  </div>
                  {nextLesson && (
                    <p className="text-sm text-muted-foreground">
                      {t("students.nextLessonAt", {
                        time: format(parseISO(nextLesson.startAt), "EEE d MMM, HH:mm", { locale }),
                      })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {debtBadge && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {t("finance.debt")}: {debtBadge}
                      </span>
                    )}
                    {selected.paidLessons != null && selected.paidLessons > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        {t("students.prepaidBadge", { count: selected.paidLessons })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => onCreateLesson?.(selected.id)}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t("students.newLesson")}
                </Button>
                {(selected.messenger || selected.phone) && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    title={t("students.openMessenger")}
                    onClick={openMessageDialog}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  title={t("students.edit")}
                  onClick={openEdit}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  title={selected.archived ? t("students.restore") : t("students.archive")}
                  onClick={() => void toggleArchive()}
                >
                  {selected.archived ? (
                    <ArchiveRestore className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {(selected.phone || selected.email || selected.messenger || selected.parentName ||
              selected.parentPhone || selected.parentMessenger || selected.parents ||
              selected.birthDate || selected.timezone) && (
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                  <Contact className="h-4 w-4 text-muted-foreground" />
                  {t("students.contacts")}
                </h4>
                <div className="grid gap-2 md:grid-cols-2">
                  {selected.phone && (
                    <ContactRow icon={Phone} label={t("students.phone")} value={selected.phone}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("students.call")}
                        onClick={() => void openUrl(`tel:${selected.phone!.replace(/[^+\d]/g, "")}`)}
                      >
                        <PhoneCall className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("common.copy")}
                        onClick={() => void copyText(selected.phone!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </ContactRow>
                  )}
                  {selected.messenger && (
                    <ContactRow icon={MessageCircle} label={t("students.messenger")} value={selected.messenger}>
                      {messengerUrl(selected.messenger) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title={t("lesson.openLink")}
                          onClick={() => void openUrl(messengerUrl(selected.messenger)!)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("common.copy")}
                        onClick={() => void copyText(selected.messenger!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </ContactRow>
                  )}
                  {selected.email && (
                    <ContactRow icon={Mail} label={t("students.email")} value={selected.email}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("lesson.openLink")}
                        onClick={() => void openUrl(`mailto:${selected.email}`)}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("common.copy")}
                        onClick={() => void copyText(selected.email!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </ContactRow>
                  )}
                  {selected.parentName && (
                    <ContactRow icon={Users} label={t("students.parentName")} value={selected.parentName} />
                  )}
                  {!selected.parentName && !selected.parentPhone && !selected.parentMessenger && selected.parents && (
                    <ContactRow icon={Users} label={t("students.parents")} value={selected.parents} />
                  )}
                  {selected.parentPhone && (
                    <ContactRow icon={Phone} label={t("students.parentPhone")} value={selected.parentPhone}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("students.call")}
                        onClick={() => void openUrl(`tel:${selected.parentPhone!.replace(/[^+\d]/g, "")}`)}
                      >
                        <PhoneCall className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("common.copy")}
                        onClick={() => void copyText(selected.parentPhone!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </ContactRow>
                  )}
                  {selected.parentMessenger && (
                    <ContactRow icon={MessageCircle} label={t("students.parentMessenger")} value={selected.parentMessenger}>
                      {messengerUrl(selected.parentMessenger) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title={t("lesson.openLink")}
                          onClick={() => void openUrl(messengerUrl(selected.parentMessenger)!)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={t("common.copy")}
                        onClick={() => void copyText(selected.parentMessenger!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </ContactRow>
                  )}
                  {selected.birthDate && (
                    <ContactRow icon={Cake} label={t("students.birthDate")} value={selected.birthDate} />
                  )}
                  {selected.timezone && (
                    <ContactRow icon={Globe} label={t("students.timezone")} value={selected.timezone} />
                  )}
                </div>
              </div>
            )}
            {selected.notes && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
                  <NotebookText className="h-4 w-4" />
                  {t("students.notes")}
                </p>
                <LinkifiedText text={selected.notes} />
              </div>
            )}

            {finance && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 font-medium">
                    <Coins className="h-4 w-4 text-muted-foreground" />
                    {t("students.finance")}
                  </h4>
                  {selected.paidLessons && selected.paidLessons > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api.applyPrepaidLessons(selected.id);
                          await invalidateAppData(queryClient);
                          toast.info(t("students.prepaidApplied"));
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
                  <AmountBlock title={t("finance.earned")} items={finance.earned} icon={TrendingUp} className="border-green-500/30 bg-green-500/10" locale={numberLocaleFromLang(i18n.language)} />
                  <AmountBlock title={t("finance.debt")} items={finance.debt} icon={Wallet} className="border-amber-500/30 bg-amber-500/10" locale={numberLocaleFromLang(i18n.language)} />
                  <AmountBlock title={t("finance.expected")} items={finance.expected} icon={Coins} className="border-blue-500/30 bg-blue-500/10" locale={numberLocaleFromLang(i18n.language)} />
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
                <h4 className="flex items-center gap-1.5 font-medium">
                  <History className="h-4 w-4 text-muted-foreground" />
                  {t("students.lessonHistory")}
                </h4>
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
                  {historyLessons.slice(0, historyLimit).map((l, idx, arr) => {
                    const paid = lessonPaymentStatus(l) === "paid";
                    const monthKey = format(parseISO(l.startAt), "yyyy-MM");
                    const prevMonthKey =
                      idx > 0 ? format(parseISO(arr[idx - 1].startAt), "yyyy-MM") : null;
                    return (
                      <div key={l.id} className="space-y-1">
                        {monthKey !== prevMonthKey && (
                          <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
                            {format(parseISO(l.startAt), "LLLL yyyy", { locale })}
                          </p>
                        )}
                        <div
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50",
                            nextLesson?.id === l.id && "border-primary/30 bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              STATUS_DOT[l.status] ?? "bg-muted-foreground/50",
                            )}
                          />
                          <button
                            type="button"
                            onClick={() => onOpenLesson?.(l)}
                            className={cn(
                              "min-w-0 flex-1 text-left",
                              l.status === "cancelled" && "text-muted-foreground line-through",
                            )}
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
          void invalidateAppData(queryClient);
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
