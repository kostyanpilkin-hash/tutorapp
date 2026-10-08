import type { Theme } from "@/types/lesson";
import { cn } from "@/lib/utils";

const STUDENT_COLORS = ["#3b82f6", "#22c55e", "#f59e0b"];

export function ThemePreview({ theme, className }: { theme: Theme; className?: string }) {
  const radius = theme === "contrast" ? 1 : 4;
  return (
    <div
      className={cn("theme-" + theme, "aspect-[3/2] overflow-hidden rounded-lg border", className)}
      style={{ background: "var(--bg)", color: "var(--fg)", borderColor: "var(--border)" }}
    >
      <div className="flex h-full">
        <div
          className="flex w-1/4 flex-col gap-1 p-1.5"
          style={{ background: "var(--card)", borderRight: "1px solid var(--border)" }}
        >
          <div style={{ background: "var(--primary)", height: 4, borderRadius: radius }} />
          <div style={{ background: "var(--muted-fg)", height: 2, borderRadius: radius, opacity: 0.8 }} />
          <div style={{ background: "var(--muted-fg)", height: 2, borderRadius: radius, opacity: 0.8, width: "80%" }} />
          <div style={{ background: "var(--muted-fg)", height: 2, borderRadius: radius, opacity: 0.8, width: "60%" }} />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-1.5">
          {STUDENT_COLORS.map((color) => (
            <div
              key={color}
              className="flex items-center gap-1"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: radius,
                padding: 2,
              }}
            >
              <div style={{ background: color, width: 3, alignSelf: "stretch", borderRadius: radius }} />
              <div className="flex flex-1 flex-col gap-0.5">
                <div style={{ background: "var(--fg)", height: 2, borderRadius: radius, width: "70%", opacity: 0.9 }} />
                <div style={{ background: "var(--muted-fg)", height: 2, borderRadius: radius, width: "45%" }} />
              </div>
            </div>
          ))}
          <div
            className="mt-auto self-start"
            style={{
              background: "var(--primary)",
              color: "var(--primary-fg)",
              height: 6,
              width: 22,
              borderRadius: radius,
            }}
          />
        </div>
      </div>
    </div>
  );
}
