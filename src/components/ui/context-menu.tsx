import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  separator?: boolean;
  onSelect?: () => void;
  children?: ContextMenuItem[];
}

interface ContextMenuApi {
  open: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  close: () => void;
}

const Ctx = createContext<ContextMenuApi | null>(null);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const width = 220;
    const height = Math.min(items.length * 36 + 16, 360);
    const x = Math.min(e.clientX, window.innerWidth - width - pad);
    const y = Math.min(e.clientY, window.innerHeight - height - pad);
    setMenu({ x: Math.max(pad, x), y: Math.max(pad, y), items });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    const onScroll = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  const api = useMemo(() => ({ open, close }), [open, close]);

  const flipSubLeft = menu !== null && menu.x + 200 + 200 > window.innerWidth;

  const renderItem = (item: ContextMenuItem) => {
    if (item.separator) {
      return <div key={item.id} className="my-1 h-px bg-border" />;
    }
    if (item.children && item.children.length > 0) {
      return (
        <div key={item.id} className="group relative">
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              item.destructive
                ? "text-destructive hover:bg-destructive/10"
                : "hover:bg-muted",
              item.disabled && "pointer-events-none opacity-40",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            <span className="ml-auto text-muted-foreground">›</span>
          </button>
          <div
            className={cn(
              "absolute top-0 hidden min-w-[180px] rounded-xl border border-border bg-card p-1 shadow-xl group-hover:block",
              flipSubLeft ? "right-full pr-1" : "left-full pl-1",
            )}
          >
            {item.children.map((sub) =>
              sub.separator ? (
                <div key={sub.id} className="my-1 h-px bg-border" />
              ) : (
                <button
                  key={sub.id}
                  type="button"
                  role="menuitem"
                  disabled={sub.disabled}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    sub.destructive
                      ? "text-destructive hover:bg-destructive/10"
                      : "hover:bg-muted",
                    sub.disabled && "pointer-events-none opacity-40",
                  )}
                  onClick={() => {
                    close();
                    sub.onSelect?.();
                  }}
                >
                  {sub.icon}
                  <span>{sub.label}</span>
                </button>
              ),
            )}
          </div>
        </div>
      );
    }
    return (
      <button
        key={item.id}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
          item.destructive
            ? "text-destructive hover:bg-destructive/10"
            : "hover:bg-muted",
          item.disabled && "pointer-events-none opacity-40",
        )}
        onClick={() => {
          close();
          item.onSelect?.();
        }}
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {menu &&
        createPortal(
          <div className="fixed inset-0 z-[120]" onMouseDown={close} onContextMenu={(e) => e.preventDefault()}>
            <div
              role="menu"
              className="animate-pop absolute min-w-[200px] rounded-xl border border-border bg-card p-1 shadow-xl"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {menu.items.map(renderItem)}
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

export function useContextMenu() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContextMenu must be used within ContextMenuProvider");
  return ctx;
}
