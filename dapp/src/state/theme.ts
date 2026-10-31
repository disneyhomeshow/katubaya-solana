import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "katubaya-theme";

function current(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme lives on the page root (`data-theme`), set before first paint in index.html. */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, current);
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private window: the switch lasts this visit */
    }
    listeners.forEach((l) => l());
  }, []);
  return [theme, toggle];
}
