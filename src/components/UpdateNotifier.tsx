import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useUpdateStore } from "@/stores/updateStore";

const CHECK_DELAY_MS = 15_000;
const RECHECK_MS = 30 * 60_000;

/** Floating update card: checks shortly after launch, then every 30 min. */
export function UpdateNotifier() {
  const { t } = useTranslation();
  const { phase, version, progress, dismissedFor, checkNow, install, restart, dismiss } = useUpdateStore();

  useEffect(() => {
    const first = setTimeout(() => void checkNow(false), CHECK_DELAY_MS);
    const every = setInterval(() => void checkNow(false), RECHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkNow]);

  const visible =
    ["available", "downloading", "ready", "error"].includes(phase) && dismissedFor !== version;
  if (!visible) return null;

  return (
    <div className="animate-fade-up fixed bottom-4 right-4 z-50 w-80 space-y-3 rounded-2xl border border-border/80 bg-card/95 p-4 shadow-[var(--card-shadow)] backdrop-blur">
      {phase === "available" && (
        <>
          <div className="text-sm font-medium">{t("update.available", { version })}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void install()}>{t("update.install")}</Button>
            <Button size="sm" variant="outline" onClick={dismiss}>{t("update.later")}</Button>
          </div>
        </>
      )}
      {phase === "downloading" && (
        <>
          <div className="text-sm font-medium">{t("update.downloading", { percent: progress })}</div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}
      {phase === "ready" && (
        <>
          <div className="text-sm font-medium">{t("update.ready")}</div>
          <Button size="sm" onClick={() => void restart()}>{t("update.restart")}</Button>
        </>
      )}
      {phase === "error" && (
        <>
          <div className="text-sm font-medium text-destructive">{t("update.failed")}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void checkNow(true)}>{t("update.retry")}</Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>{t("update.later")}</Button>
          </div>
        </>
      )}
    </div>
  );
}
