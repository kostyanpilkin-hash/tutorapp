import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface Props {
  photoPath?: string | null;
  name: string;
  color?: string | null;
  className?: string;
  textClassName?: string;
}

export function StudentAvatar({ photoPath, name, color, className, textClassName }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!photoPath) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    void api.getStudentPhotoDataUrl(photoPath).then((url) => {
      if (!cancelled) setSrc(url);
    }).catch(() => {
      if (!cancelled) setSrc(null);
    });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  const initials = name.slice(0, 2).toUpperCase() || "?";

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        data-student-avatar
        className={cn("relative rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      data-student-avatar
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        className,
        textClassName,
      )}
      style={{ backgroundColor: color || "#3b82f6" }}
    >
      {initials}
    </span>
  );
}
