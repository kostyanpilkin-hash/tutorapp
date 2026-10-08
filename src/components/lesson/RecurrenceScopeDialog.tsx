import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RecurrenceEditScope } from "@/types/lesson";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (scope: RecurrenceEditScope) => void;
}

export function RecurrenceScopeDialog({ open, onClose, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("lesson.editScope")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => onSelect("this")}>
            {t("lesson.thisOnly")}
          </Button>
          <Button variant="outline" onClick={() => onSelect("thisAndFuture")}>
            {t("lesson.thisAndFuture")}
          </Button>
          <Button variant="outline" onClick={() => onSelect("all")}>
            {t("lesson.allSeries")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
