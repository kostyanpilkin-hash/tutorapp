import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // Tauri-команды дёшевы, но фокус на десктопе частый —
      // рефетч по фокусу делаем вручную через invalidateQueries в App.
      refetchOnWindowFocus: false,
    },
  },
});
