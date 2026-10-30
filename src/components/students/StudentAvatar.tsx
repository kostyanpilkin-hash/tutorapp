import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { keys } from "@/lib/queryKeys";

interface Props {
  photoPath?: string | null;
  name: string;
  color?: string | null;
  className?: string;
  textClassName?: string;
}

export function StudentAvatar({ photoPath, name, color, className, textClassName }: Props) {
  const photoQuery = useQuery({
    queryKey: keys.students.photo(photoPath ?? ""),
    queryFn: () => api.getStudentPhotoDataUrl(photoPath!),
    enabled: !!photoPath,
  });
  const src = photoPath ? (photoQuery.data ?? null) : null;

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
