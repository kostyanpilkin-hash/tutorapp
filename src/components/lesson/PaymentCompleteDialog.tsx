import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  studentName: string;
  onPaid: () => void;
  onUnpaid: () => void;
  onCancel: () => void;
}

export function PaymentCompleteDialog({
  open,
  studentName,
  onPaid,
  onUnpaid,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("finance.paymentPromptTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("finance.paymentPromptBody", { name: studentName })}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={onPaid}>{t("finance.paid")}</Button>
          <Button variant="outline" onClick={onUnpaid}>{t("finance.unpaid")}</Button>
          <Button variant="ghost" onClick={onCancel}>{t("finance.later")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
