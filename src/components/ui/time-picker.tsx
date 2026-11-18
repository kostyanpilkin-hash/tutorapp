import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseTimeInput } from "@/lib/timeInput";

export interface TimePickerProps {
  value: string; // "HH:mm"
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
}

const DIAL = 200;

function dialPos(index: number, radius: number) {
  const angle = ((index * 30 - 90) * Math.PI) / 180;
  return {
    left: `${DIAL / 2 + radius * Math.cos(angle)}px`,
    top: `${DIAL / 2 + radius * Math.sin(angle)}px`,
  };
}

export function TimePicker({ value, onChange, id, disabled }: TimePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"hours" | "minutes">("hours");
  const [draft, setDraft] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const [hh, mm] = value.split(":").map(Number);
  const hour = Number.isNaN(hh) ? 0 : hh;
  const minute = Number.isNaN(mm) ? 0 : mm;

  const emit = (h: number, m: number) => {
    const total = (((h * 60 + m) % 1440) + 1440) % 1440;
    onChange(
      `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
    );
  };

  const commitDraft = () => {
    const parsed = parseTimeInput(draft);
    if (parsed) onChange(parsed);
    else setDraft(value);
  };

  const dialButton = (
    key: string,
    label: string,
    selected: boolean,
    pos: { left: string; top: string },
    onPick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      style={pos}
      className={cn(
        "absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs transition-colors",
        selected
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted",
      )}
      onClick={onPick}
    >
      {label}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder="HH:mm"
        className="pr-8"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={t("timePicker.hours")}
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Clock className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 rounded-lg border border-border bg-card p-3 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          <div className="mb-2 inline-flex w-full rounded-lg border border-border bg-muted/40 p-0.5">
            {(["hours", "minutes"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn(
                  "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  mode === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setMode(m)}
              >
                {m === "hours" ? t("timePicker.hours") : t("timePicker.minutes")}
              </button>
            ))}
          </div>

          <div
            className="relative mx-auto rounded-full border border-border/60"
            style={{ width: DIAL, height: DIAL }}
          >
            {mode === "hours" ? (
              <>
                {Array.from({ length: 12 }, (_, i) => i + 12).map((h, i) =>
                  dialButton(`o${h}`, String(h), hour === h, dialPos(i, 80), () => {
                    emit(h, minute);
                    setMode("minutes");
                  }),
                )}
                {Array.from({ length: 12 }, (_, i) => i).map((h, i) =>
                  dialButton(`i${h}`, String(h).padStart(2, "0"), hour === h, dialPos(i, 50), () => {
                    emit(h, minute);
                    setMode("minutes");
                  }),
                )}
              </>
            ) : (
              Array.from({ length: 12 }, (_, i) => i * 5).map((m, i) =>
                dialButton(`m${m}`, String(m).padStart(2, "0"), minute === m, dialPos(i, 80), () => {
                  emit(hour, m);
                }),
              )
            )}
          </div>

          <div className="mt-2 flex items-center justify-center gap-1">
            {[-5, -1, 1, 5].map((delta) => (
              <Button
                key={delta}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => emit(hour, minute + delta)}
              >
                {delta < 0 ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {Math.abs(delta)}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setOpen(false)}
          >
            {t("timePicker.done")}
          </Button>
        </div>
      )}
    </div>
  );
}
