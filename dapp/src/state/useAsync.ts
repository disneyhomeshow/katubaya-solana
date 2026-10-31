import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export type AsyncState<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
};

/**
 * Loads `fn` when `deps` change and keeps the last result while reloading, so a refresh after a
 * transaction never blanks the page. `pollMs` re-runs it on an interval while the tab is visible.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, pollMs?: number): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useRef(0);

  const reload = useCallback(async () => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      if (id === run.current) setState({ data, error: undefined, loading: false });
    } catch (error) {
      if (id === run.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    setState({ data: undefined, error: undefined, loading: true });
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, reload]);

  return { ...state, reload };
}
