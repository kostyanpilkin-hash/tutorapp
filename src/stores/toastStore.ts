import { create } from "zustand";

export type ToastVariant = "info" | "error" | "success";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  durationMs: number;
}

interface ToastState {
  items: ToastItem[];
  push: (toast: Omit<ToastItem, "id" | "durationMs"> & { durationMs?: number }) => string;
  dismiss: (id: string) => void;
  error: (message: string) => void;
  info: (message: string, action?: ToastAction) => void;
  success: (message: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],

  push: (toast) => {
    const id = `toast-${Date.now()}-${seq++}`;
    const item: ToastItem = {
      id,
      message: toast.message,
      variant: toast.variant,
      action: toast.action,
      durationMs: toast.durationMs ?? (toast.variant === "error" ? 6000 : 4500),
    };
    set((s) => ({ items: [...s.items.slice(-4), item] }));
    window.setTimeout(() => get().dismiss(id), item.durationMs);
    return id;
  },

  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),

  error: (message) => {
    get().push({ message, variant: "error" });
  },

  info: (message, action) => {
    get().push({ message, variant: "info", action, durationMs: action ? 12000 : 4500 });
  },

  success: (message) => {
    get().push({ message, variant: "success" });
  },
}));
