import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "uptodate"
  | "error";

interface UpdateState {
  phase: UpdatePhase;
  update: Update | null;
  version: string | null;
  progress: number;
  /** Version the user clicked "Later" on — it won't re-prompt, the next one will. */
  dismissedFor: string | null;
  /** `manual` surfaces "uptodate"/"error" so the settings button gives feedback. */
  checkNow: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  update: null,
  version: null,
  progress: 0,
  dismissedFor: null,
  checkNow: async (manual = false) => {
    set({ phase: "checking" });
    try {
      const update = await check();
      if (update) set({ phase: "available", update, version: update.version });
      else set({ phase: manual ? "uptodate" : "idle" });
    } catch (e) {
      console.warn("update check failed", e);
      set({ phase: manual ? "error" : "idle" });
    }
  },
  install: async () => {
    const update = get().update;
    if (!update) return;
    set({ phase: "downloading", progress: 0 });
    let total = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          if (total > 0) set({ progress: Math.min(99, Math.round((downloaded / total) * 100)) });
        } else if (e.event === "Finished") set({ progress: 100 });
      });
      set({ phase: "ready" });
    } catch {
      set({ phase: "error" });
    }
  },
  restart: () => relaunch(),
  dismiss: () => set({ dismissedFor: get().version }),
}));
