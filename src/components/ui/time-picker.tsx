import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  /**
   * In-flow container for the clock panel, e.g. a full-width row under the
   * field. Without it the panel opens right below the input. The panel is
   * never absolutely positioned, so scroll containers cannot clip it.
   */
  panelHost?: HTMLElement | null;
  /** Extra ids for aria-describedby (hints such as the end time). */
  describedBy?: string;
  /** Reports whether the typed text is a valid time; invalid text is kept as typed. */
  onValidityChange?: (valid: boolean) => void;
}

const TARGET = 32; // px, dial button size
const DIAL = 248;
const OUTER = 104;
const INNER = 68; // 2π·68/12 ≈ 35.6px between centers ≥ TARGET: no overlap

function dialPos(index: number, radius: number) {
  const angle = ((index * 30 - 90) * Math.PI) / 180;
  return {
    left: `${DIAL / 2 + radius * Math.cos(angle)}px`,
    top: `${DIAL / 2 + radius * Math.sin(angle)}px`,
    width: TARGET,
    height: TARGET,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function TimePicker({ value, onChange, id, disabled, panelHost, describedBy, onValidityChange }: TimePickerProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const inputId = id ?? `time-${autoId}`;
  const panelId = `${inputId}-panel`;
  const errorId = `${inputId}-error`;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"hours" | "minutes">("hours");
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollIntoView({ block: "nearest" });
    panelRef.current?.querySelector<HTMLButtonElement>('[data-dial][aria-pressed="true"], [data-dial]')?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const [hh, mm] = value.split(":").map(Number);
  const hour = Number.isNaN(hh) ? 0 : hh;
  const minute = Number.isNaN(mm) ? 0 : mm;

  const setValidity = (valid: boolean) => {
    setInvalid(!valid);
    onValidityChange?.(valid);
  };

  const emit = (h: number, m: number) => {
    const total = (((h * 60 + m) % 1440) + 1440) % 1440;
    const next = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    setDraft(next);
    setValidity(true);
    onChange(next);
  };

  const commitDraft = () => {
    const parsed = parseTimeInput(draft);
    if (!parsed) {
      setValidity(false);
      return;
    }
    setDraft(parsed);
    setValidity(true);
    if (parsed !== value) onChange(parsed);
  };

  // First Escape closes the clock only; the dialog sees data-dismiss-guard.
  const onEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  const dialButton = (key: string, label: string, aria: string, selected: boolean, index: number, radius: number, onPick: () => void) => (
    <button
      key={key}
      type="button"
      data-dial=""
      aria-pressed={selected}
      aria-label={aria}
      style={dialPos(index, radius)}
      className={cn(
        "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
      )}
      onClick={onPick}
    >
      {label}
    </button>
  );

  const panel = open && (
    <div
      ref={panelRef}
      id={panelId}
      role="group"
      aria-label={t("timePicker.open")}
      data-dismiss-guard=""
      className="mt-2 w-full max-w-[18rem] rounded-lg border border-border bg-card p-3 shadow-sm"
      onKeyDown={onEscape}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums" aria-live="polite">
          {pad(hour)}:{pad(minute)}
        </span>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["hours", "minutes"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode(m)}
            >
              {m === "hours" ? t("timePicker.hours") : t("timePicker.minutes")}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mx-auto rounded-full border border-border/60" style={{ width: DIAL, height: DIAL }}>
        {mode === "hours" ? (
          <>
            {Array.from({ length: 12 }, (_, i) => i + 12).map((h, i) =>
              dialButton(`o${h}`, String(h), `${t("timePicker.hours")}: ${h}`, hour === h, i, OUTER, () => {
                emit(h, minute);
                setMode("minutes");
              }),
            )}
            {Array.from({ length: 12 }, (_, i) => i).map((h, i) =>
              dialButton(`i${h}`, pad(h), `${t("timePicker.hours")}: ${pad(h)}`, hour === h, i, INNER, () => {
                emit(h, minute);
                setMode("minutes");
              }),
            )}
          </>
        ) : (
          Array.from({ length: 12 }, (_, i) => i * 5).map((m, i) =>
            dialButton(`m${m}`, pad(m), `${t("timePicker.minutes")}: ${pad(m)}`, minute === m, i, OUTER, () => emit(hour, m)),
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
            className="h-8 px-2 text-xs"
            aria-label={`${delta < 0 ? "−" : "+"}${Math.abs(delta)} ${t("timePicker.minutes")}`}
            onClick={() => emit(hour, minute + delta)}
          >
            {delta < 0 ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {Math.abs(delta)}
          </Button>
        ))}
      </div>
      <Button type="button" size="sm" className="mt-2 w-full" onClick={() => close(true)}>
        {t("timePicker.done")}
      </Button>
    </div>
  );

  return (
    <div ref={wrapRef} data-dismiss-guard={open ? "" : undefined} onKeyDown={onEscape}>
      <div className="relative">
        <Input
          id={inputId}
          value={draft}
          disabled={disabled}
          placeholder="HH:mm"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={[invalid ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined}
          className={cn("pr-9 tabular-nums", invalid && "border-destructive focus-visible:ring-destructive")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
        />
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label={t("timePicker.open")}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>
      {invalid && (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {t("timePicker.invalid")}
        </p>
      )}
      {panelHost ? panel && createPortal(panel, panelHost) : panel}
    </div>
  );
}
