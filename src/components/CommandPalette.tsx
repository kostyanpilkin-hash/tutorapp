import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, subDays } from "date-fns";
import { ru, enUS, be as beLocale } from "date-fns/locale";
import { Search } from "lucide-react";
import type { Lesson, Theme } from "@/types/lesson";
import { lessonStudentNames } from "@/types/lesson";
import type { Student } from "@/types/student";
import { api } from "@/lib/api";
import { loadExpandedLessons } from "@/lib/recurrence";
import { THEMES } from "@/lib/themes";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PalettePage =
  | "home"
  | "calendar"
  | "students"
  | "reminders"
  | "finance"
  | "history"
  | "settings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (page: PalettePage) => void;
  onNewLesson: () => void;
  onGoToday: () => void;
  onOpenLesson: (lesson: Lesson) => void;
  onOpenStudent: (studentId: string) => void;
  onSetTheme: (theme: Theme) => void;
}

const locales = { ru, en: enUS, be: beLocale };

interface Item {
  id: string;
  section: "commands" | "students" | "lessons" | "themes";
  label: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onNewLesson,
  onGoToday,
  onOpenLesson,
  onOpenStudent,
  onSetTheme,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = locales[i18n.language as keyof typeof locales] || ru;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const studentsQuery = useQuery({
    queryKey: ["palette", "students"],
    queryFn: () => api.getStudents(false),
    enabled: open,
  });
  const lessonsQuery = useQuery({
    queryKey: ["palette", "lessons"],
    queryFn: () => loadExpandedLessons(subDays(new Date(), 30), addMonths(new Date(), 3)),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const pages: { page: PalettePage; label: string }[] = [
      { page: "home", label: t("app.today") },
      { page: "calendar", label: t("app.calendar") },
      { page: "students", label: t("app.students") },
      { page: "reminders", label: t("app.reminders") },
      { page: "finance", label: t("app.finance") },
      { page: "history", label: t("app.history") },
      { page: "settings", label: t("app.settings") },
    ];
    const commands: Item[] = [
      {
        id: "cmd-new",
        section: "commands",
        label: t("palette.newLesson"),
        keywords: "новое занятие new lesson создать create ctrl+n",
        run: onNewLesson,
      },
      {
        id: "cmd-today",
        section: "commands",
        label: t("palette.goToday"),
        keywords: "сегодня today сейчас now",
        run: onGoToday,
      },
      ...pages.map((p) => ({
        id: `cmd-page-${p.page}`,
        section: "commands" as const,
        label: p.label,
        keywords: `открыть open перейти go ${p.page} ${p.label}`,
        run: () => onNavigate(p.page),
      })),
    ];
    const students: Item[] = (studentsQuery.data ?? []).map((s: Student) => ({
      id: `student-${s.id}`,
      section: "students",
      label: s.name,
      keywords: `ученик student ${s.name}`,
      run: () => onOpenStudent(s.id),
    }));
    const lessons: Item[] = (lessonsQuery.data ?? []).map((l) => {
      const when = format(new Date(l.startAt), "d MMM HH:mm", { locale });
      return {
        id: `lesson-${l.id}-${l.startAt}`,
        section: "lessons",
        label: `${lessonStudentNames(l)} — ${when}`,
        hint: l.subject || undefined,
        keywords: `занятие lesson ${lessonStudentNames(l)} ${l.subject ?? ""}`,
        run: () => onOpenLesson(l),
      };
    });
    const themes: Item[] = THEMES.map((th) => ({
      id: `theme-${th.id}`,
      section: "themes",
      label: `${t("settings.theme")}: ${t(`settings.themes.${th.id}`)}`,
      keywords: `тема theme оформление ${th.id} ${t(`settings.themes.${th.id}`)}`,
      run: () => onSetTheme(th.id),
    }));
    return [...commands, ...students, ...lessons, ...themes];
  }, [
    t,
    locale,
    studentsQuery.data,
    lessonsQuery.data,
    onNavigate,
    onNewLesson,
    onGoToday,
    onOpenStudent,
    onOpenLesson,
    onSetTheme,
  ]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return items.filter((i) => i.section === "commands");
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q),
    );
  }, [items, q]);

  useEffect(() => {
    setActive(0);
  }, [q, open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runItem = (item: Item) => {
    onOpenChange(false);
    item.run();
  };

  const sections: { key: Item["section"]; title: string }[] = [
    { key: "commands", title: t("palette.commands") },
    { key: "students", title: t("app.students") },
    { key: "lessons", title: t("palette.lessons") },
    { key: "themes", title: t("palette.themes") },
  ];

  let flatIdx = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[18%] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0"
        aria-label={t("palette.title")}
      >
        <div className="flex items-center gap-2 border-b border-border pl-4 pr-10 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (visible.length ? (a + 1) % visible.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) =>
                  visible.length ? (a - 1 + visible.length) % visible.length : 0,
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = visible[active];
                if (item) runItem(item);
              }
            }}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {visible.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("palette.empty")}
            </p>
          )}
          {sections.map(({ key, title }) => {
            const sectionItems = visible.filter((i) => i.section === key);
            if (sectionItems.length === 0) return null;
            return (
              <div key={key} className="mb-1">
                <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {title}
                </div>
                {sectionItems.map((item) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => runItem(item)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm",
                        idx === active ? "bg-primary/10 text-foreground" : "text-foreground/90",
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.hint && (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
