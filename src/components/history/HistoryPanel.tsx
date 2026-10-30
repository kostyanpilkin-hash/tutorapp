import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  History,
  Plus,
  Trash2,
  ArrowRightLeft,
  CheckCircle,
  CreditCard,
  User,
  Settings,
  Wallet,
  Undo2,
} from "lucide-react";
import { api } from "@/lib/api";
import { keys, invalidateAppData } from "@/lib/queryKeys";
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";
import type { ActivityLogEntry } from "@/types/student";

const CATEGORIES = ["all", "lesson", "finance", "student", "settings"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

const ACTION_ICONS: Record<string, typeof Calendar> = {
  created: Plus,
  deleted: Trash2,
  series_deleted_from: Trash2,
  series_deleted: Trash2,
  restored: Undo2,
  rescheduled: ArrowRightLeft,
  updated: ArrowRightLeft,
  status_changed: CheckCircle,
  payment_changed: CreditCard,
  debt_paid: Wallet,
  prepaid_applied: CreditCard,
  settings_changed: Settings,
  archived: User,
};

const CATEGORY_COLORS: Record<string, string> = {
  lesson: "text-blue-500 bg-blue-500/10",
  finance: "text-emerald-500 bg-emerald-500/10",
  student: "text-violet-500 bg-violet-500/10",
  settings: "text-amber-500 bg-amber-500/10",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAGE = 100;

function fmtShortDate(v: string, locale: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function HistoryPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const logQuery = useInfiniteQuery({
    queryKey: keys.activity(filter),
    queryFn: ({ pageParam }) =>
      api.getActivityLog(filter === "all" ? undefined : filter, PAGE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE ? allPages.length * PAGE : undefined,
  });
  const entries = logQuery.data?.pages.flat() ?? [];
  const hasMore = !!logQuery.hasNextPage;

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 6,
    getItemKey: (index) => entries[index].id,
  });

  const fmtValue = (v: string | undefined, field?: string): string => {
    if (!v) return "—";
    if (field === "start_at") return fmtShortDate(v, i18n.language);
    if (field === "status") return t(`history.status.${v}`, { defaultValue: v });
    if (field === "payment_status") return t(`history.pay.${v}`, { defaultValue: v });
    return v;
  };

  const undo = async (entry: ActivityLogEntry) => {
    if (!entry.details) return;
    try {
      await api.restoreLessonArchive(entry.details);
      await invalidateAppData(queryClient);
    } catch {
      useToastStore.getState().error(t("lesson.undoFailed"));
    }
  };

  const title = (e: ActivityLogEntry): string => {
    const name = e.entityName || t("history.unknown");
    const key = `history.action.${e.action}`;
    const label = t(key, { defaultValue: e.action });
    return `${name} — ${label}`;
  };

  const sub = (e: ActivityLogEntry): string | null => {
    const parts: string[] = [];
    if (e.field) parts.push(t(`history.field.${e.field}`, { defaultValue: e.field }));
    if (e.oldValue || e.newValue) {
      parts.push(`${fmtValue(e.oldValue, e.field)} → ${fmtValue(e.newValue, e.field)}`);
    }
    return parts.length ? parts.join(" · ") : null;
  };

  const UNDOABLE = new Set(["deleted", "series_deleted", "series_deleted_from"]);
  const canUndo = (e: ActivityLogEntry) => UNDOABLE.has(e.action) && !!e.details;
  // For lesson-level entries `details` holds the instance date (not an archive id).
  const lessonDate = (e: ActivityLogEntry) => {
    if (e.category !== "lesson" || UNDOABLE.has(e.action) || !e.details) return null;
    return Number.isNaN(new Date(e.details).getTime()) ? null : e.details;
  };

  return (
    <div className="flex h-full flex-col gap-4 p-1">
      <div className="flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-2xl font-semibold">
          <History className="h-6 w-6 text-primary" />
          {t("history.title")}
        </h2>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={cn(
              "rounded-full px-3 py-1 text-sm transition",
              filter === c
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {t(`history.category.${c}`)}
          </button>
        ))}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 && (
          <div className="animate-fade-up rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {t("history.empty")}
          </div>
        )}
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
          const e = entries[vi.index];
          const Icon = ACTION_ICONS[e.action] || Calendar;
          const colors = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.settings;
          const opened = openId === e.id;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-2"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
            <div className="animate-fade-up rounded-xl border border-border bg-card p-3">
              <button
                className="flex w-full items-center gap-3 text-left"
                onClick={() => setOpenId(opened ? null : e.id)}
              >
                <div className={cn("rounded-lg p-2", colors)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{title(e)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {sub(e) && <span>{sub(e)} · </span>}
                    {fmtDateTime(e.createdAt)}
                  </div>
                </div>
              </button>
              {opened && (
                <div className="mt-3 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
                  <div><span className="text-muted-foreground">{t("history.detailWho")}: </span>{e.entityName || "—"}</div>
                  <div><span className="text-muted-foreground">{t("history.detailAction")}: </span>{t(`history.action.${e.action}`, { defaultValue: e.action })}</div>
                  {e.field && (
                    <div><span className="text-muted-foreground">{t("history.detailField")}: </span>{t(`history.field.${e.field}`, { defaultValue: e.field })}</div>
                  )}
                  {(e.oldValue || e.newValue) && (
                    <div><span className="text-muted-foreground">{t("history.detailChange")}: </span>{fmtValue(e.oldValue, e.field)} → {fmtValue(e.newValue, e.field)}</div>
                  )}
                  {lessonDate(e) && (
                    <div><span className="text-muted-foreground">{t("history.detailLesson")}: </span>{fmtValue(lessonDate(e)!, "start_at")}</div>
                  )}
                  <div><span className="text-muted-foreground">{t("history.detailWhen")}: </span>{fmtDateTime(e.createdAt)}</div>
                  {canUndo(e) && (
                    <button
                      onClick={() => void undo(e)}
                      className="mt-1 flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      {t("common.undo")}
                    </button>
                  )}
                </div>
              )}
            </div>
            </div>
          );
          })}
        </div>
        {hasMore && (
          <button
            onClick={() => void logQuery.fetchNextPage()}
            className="mx-auto mt-2 block rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {t("history.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
