import type { Theme } from "@/types/lesson";

export type ThemeKind = "light" | "dark";

export interface ThemeMeta {
  id: Theme;
  kind: ThemeKind;
}

export const THEMES: readonly ThemeMeta[] = [
  { id: "light", kind: "light" },
  { id: "mint", kind: "light" },
  { id: "ink", kind: "light" },
  { id: "forest", kind: "light" },
  { id: "sand", kind: "light" },
  { id: "rose", kind: "light" },
  { id: "ocean", kind: "light" },
  { id: "colorful", kind: "light" },
  { id: "contrast", kind: "light" },
  { id: "lavender", kind: "light" },
  { id: "peach", kind: "light" },
  { id: "dark", kind: "dark" },
  { id: "indigo", kind: "dark" },
  { id: "graphite", kind: "dark" },
  { id: "midnight", kind: "dark" },
  { id: "ember", kind: "dark" },
  { id: "pine", kind: "dark" },
  { id: "plum", kind: "dark" },
];

export const THEME_IDS = THEMES.map((t) => t.id);

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEME_IDS as string[]).includes(v);
}
