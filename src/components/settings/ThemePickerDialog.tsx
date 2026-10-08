import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { THEMES, type ThemeKind } from "@/lib/themes";
import { ThemePreview } from "./ThemePreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ThemePickerDialogProps {
  open: boolean;
  onClose: () => void;
}

const KINDS: ThemeKind[] = ["light", "dark"];

export function ThemePickerDialog({ open, onClose }: ThemePickerDialogProps) {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const previewTheme = useSettingsStore((s) => s.previewTheme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const initialTheme = useRef(theme);

  useEffect(() => {
    if (open) initialTheme.current = useSettingsStore.getState().theme;
  }, [open]);

  const cancel = () => {
    previewTheme(initialTheme.current);
    onClose();
  };

  const apply = async () => {
    await setTheme(useSettingsStore.getState().theme);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) cancel(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("settings.themePickerTitle")}</DialogTitle>
        </DialogHeader>
        {KINDS.map((kind) => (
          <div key={kind}>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              {t(`settings.themeKinds.${kind}`)}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {THEMES.filter((m) => m.kind === kind).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => previewTheme(m.id)}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border border-border p-2 text-left transition",
                    "hover:scale-[1.02] hover:border-ring",
                    m.id === theme && "ring-2 ring-primary",
                  )}
                >
                  <ThemePreview theme={m.id} className="w-full" />
                  <span className="text-sm font-medium">{t(`settings.themes.${m.id}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void apply()}>
            {t("settings.themeApply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
