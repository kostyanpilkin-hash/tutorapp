import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

let openSelectCount = 0;
let lastSelectCloseAt = 0;

function markSelectOpenChange(open: boolean) {
  if (open) {
    openSelectCount += 1;
    return;
  }
  openSelectCount = Math.max(0, openSelectCount - 1);
  lastSelectCloseAt = Date.now();
}

/** True while a Select is open, or in the same click that just dismissed it. */
export function shouldBlockDialogDismiss() {
  return openSelectCount > 0 || Date.now() - lastSelectCloseAt < 400;
}

export function Select({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return (
    <SelectPrimitive.Root
      {...props}
      onOpenChange={(open) => {
        markSelectOpenChange(open);
        onOpenChange?.(open);
      }}
    />
  );
}

export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  portal = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & { portal?: boolean }) {
  const content = (
    <SelectPrimitive.Content
      className={cn("z-[80] overflow-hidden rounded-md border border-border bg-card shadow-md", className)}
      position="popper"
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  );
  if (portal) {
    return <SelectPrimitive.Portal>{content}</SelectPrimitive.Portal>;
  }
  return content;
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none hover:bg-muted",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
