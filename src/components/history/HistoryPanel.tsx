import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useToastStore } from "@/stores/toastStore";
import { cn } from "@/lib/utils";
import type { ActivityLogEntry } from "@/types/student";

const CATEGORIES = ["all", "lesson", "finance", "student", "settings"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

const ACTION_ICONS: Record<string, typeof Calendar> = {
  created: Plus,
  deleted: Trash2,
  series_deleted_from: Trash2,
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

export function HistoryPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>("all");

  const load = useCallback(async () => {
    const rows = await api.getActivityLog(
      filter === "all" ? undefined : filter,
      500,
    );
    setEntries(rows);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (entry: ActivityLogEntry) => {
    if (!entry.details) return;
    try {
      await api.restoreLessonArchive(entry.details);
      await load();
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
      parts.push(
        `${e.oldValue || t("history.empty")} → ${e.newValue || t("history.empty")}`,
      );
    }
    return parts.length ? parts.join(" · ") : null;
  };

  const canUndo = (e: ActivityLogEntry) =>
    (e.action === "deleted" || e.action === "series_deleted_from") && !!e.details;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-1">
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

      <div className="flex flex-col gap-2">
        {entries.length === 0 && (
          <div className="animate-fade-up rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {t("history.empty")}
          </div>
        )}
        {entries.map((e) => {
          const Icon = ACTION_ICONS[e.action] || Calendar;
          const colors = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.settings;
          return (
            <div
              key={e.id}
              className="animate-fade-up flex items-center gap-3 rounded-xl border border-border bg-card p-3"
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
              {canUndo(e) && (
                <button
                  onClick={() => void undo(e)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {t("common.undo")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
