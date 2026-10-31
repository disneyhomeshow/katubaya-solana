// What the game says back: Broto's line, the toast over the map, the green flashes in the task list
// and this session's entries in the log.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Mood } from "./assets";

export type Broto = { mood: Mood; text: string };
export type LogEntry = { at: number; text: string };

export function useFeedback(initial: Broto) {
  const [broto, setBrotoState] = useState<Broto>(initial);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [flashes, setFlashes] = useState<{ id: number; text: string }[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const say = useCallback((mood: Mood, text: string) => setBrotoState({ mood, text }), []);

  const showToast = useCallback(
    (text: string) => {
      const n = ++seq.current;
      setToast({ text, n });
      later(3100, () => setToast((t) => (t && t.n === n ? null : t)));
    },
    [later],
  );

  const flash = useCallback(
    (text: string) => {
      const id = ++seq.current;
      setFlashes((f) => [{ id, text }, ...f].slice(0, 2));
      later(2700, () => setFlashes((f) => f.filter((x) => x.id !== id)));
    },
    [later],
  );

  const addLog = useCallback((text: string) => setLog((l) => [{ at: Date.now() / 1000, text }, ...l].slice(0, 20)), []);

  return { broto, say, toast, showToast, flashes, flash, log, addLog, later };
}

export type Feedback = ReturnType<typeof useFeedback>;

/** "14:20" for today, "23 Oct" before. */
export function logTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Polls `reload` while the tab is visible, so customers' and farmers' moves reach the map. */
export function usePoll(reload: () => Promise<unknown>, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, ms);
    return () => clearInterval(timer);
  }, [reload, ms, enabled]);
}
