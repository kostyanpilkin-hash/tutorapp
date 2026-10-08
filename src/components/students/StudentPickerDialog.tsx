import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Search, Check, X, Plus } from "lucide-react";
import type { Student } from "@/types/student";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StudentAvatar } from "./StudentAvatar";
import { StudentFormDialog } from "./StudentFormDialog";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  students: Student[];
  selectedIds: string[];
  tutorTimezone: string;
  multiple?: boolean;
  /** Внутри родительского диалога — иначе Radix блокирует клики */
  embedded?: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  /** Обновить список учеников после создания нового */
  onStudentCreated?: (student: Student) => void;
}

export function StudentPickerDialog({
  open,
  students,
  selectedIds,
  tutorTimezone,
  multiple = true,
  embedded = false,
  onClose,
  onConfirm,
  onStudentCreated,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(selectedIds);
      setQuery("");
      setCreateOpen(false);
    }
  }, [open, selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  if (!open) return null;

  const toggle = (id: string) => {
    if (!multiple) {
      setPicked([id]);
      return;
    }
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleConfirm = () => {
    onConfirm(picked);
    onClose();
  };

  const handleCreated = (student: Student) => {
    onStudentCreated?.(student);
    setPicked((prev) => (multiple ? (prev.includes(student.id) ? prev : [...prev, student.id]) : [student.id]));
    setQuery("");
  };

  const panel = (
    <div
      className={cn(
        "flex items-center justify-center",
        embedded ? "absolute inset-0 z-[60] rounded-lg p-2" : "fixed inset-0 z-[100] p-4",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label={t("students.cancel")}
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[min(80vh,520px)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-card p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("students.pickTitle")}</h2>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("students.new")}
            </Button>
            <button type="button" className="rounded-sm p-1 opacity-70 hover:opacity-100" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("students.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {students.length === 0 ? t("students.empty") : t("students.emptySearch")}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("students.new")}
              </Button>
            </div>
          ) : (
            filtered.map((s) => {
              const active = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                    active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  <StudentAvatar
                    photoPath={s.photoPath}
                    name={s.name}
                    color={s.color}
                    className="h-8 w-8"
                    textClassName="text-xs"
                  />
                  <span className="flex-1 font-medium">{s.name}</span>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose}>{t("students.cancel")}</Button>
          <Button disabled={picked.length === 0} onClick={handleConfirm}>
            {t("students.confirm")}
          </Button>
        </div>
      </div>

      <StudentFormDialog
        elevated
        open={createOpen}
        student={null}
        tutorTimezone={tutorTimezone}
        onClose={() => setCreateOpen(false)}
        onSaved={handleCreated}
      />
    </div>
  );

  if (embedded) return panel;
  return createPortal(panel, document.body);
}
