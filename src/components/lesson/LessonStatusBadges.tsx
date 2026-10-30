import { Calendar, CheckCircle2, CircleDollarSign, CircleX, UserX, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Lesson, LessonStatus } from "@/types/lesson";
import { lessonPaymentStatus } from "@/lib/lessonActions";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<LessonStatus, typeof Calendar> = {
  scheduled: Calendar,
  completed: CheckCircle2,
  cancelled: CircleX,
  no_show: UserX,
};

const STATUS_CLASS: Record<LessonStatus, string> = {
  scheduled: "text-blue-600",
  completed: "text-green-600",
  cancelled: "text-muted-foreground",
  no_show: "text-amber-600",
};

interface Props {
  lesson: Lesson;
  size?: "sm" | "md";
  className?: string;
}

export function LessonStatusBadges({ lesson, size = "sm", className }: Props) {
  const { t } = useTranslation();
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const payment = lessonPaymentStatus(lesson);
  const statusKey = lesson.status as LessonStatus;
  const StatusIcon = STATUS_ICON[statusKey];
  const PaymentIcon = payment === "paid" ? CircleDollarSign : Wallet;

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", className)}>
      <span title={t(`payment.${payment}`)}>
        <PaymentIcon
          className={cn(iconSize, payment === "paid" ? "text-green-600" : "text-amber-500")}
          aria-label={t(`payment.${payment}`)}
        />
      </span>
      <span title={t(`status.${lesson.status}`)}>
        <StatusIcon
          className={cn(iconSize, STATUS_CLASS[statusKey])}
          aria-label={t(`status.${lesson.status}`)}
        />
      </span>
    </span>
  );
}
