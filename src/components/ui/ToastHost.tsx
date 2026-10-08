import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-2">
      {items.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "animate-pop pointer-events-auto rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur",
            toast.variant === "error" && "border-red-300",
            toast.variant === "success" && "border-green-300",
            toast.variant === "info" && "border-border",
          )}
          role="status"
        >
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              onClick={() => dismiss(toast.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {toast.action && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
