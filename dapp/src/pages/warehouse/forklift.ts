// The yard's forklift: a small job queue that keeps it busy. Idle, it shuttles crates from storage to
// the trucks at the docks. While the operator signs mark_in_transit it drives to that truck ("stage"),
// and once the transaction lands it loads three crates ("load") before the truck may leave.
// It is the operator's hand on the map: nothing on-chain of its own.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Heading } from "../../game/assets";
import { bayX } from "./yardModel";

export type Fork = { x: number; z: number; head: Heading; loaded: boolean; dur: number; moving: boolean; lift: boolean };
export type Cargo = { from: [number, number, number]; to: [number, number, number]; n: number };
export type Loading = { id: string; bay: number; n: number };

type Job = { type: "stage" | "load"; bay: number; id: string; after?: () => void };
type Step =
  | { t: "move"; x: number; z: number }
  | { t: "back"; d: number }
  | { t: "face"; head: Heading }
  | { t: "wait"; ms: number }
  | { t: "pick" }
  | { t: "restock" }
  | { t: "drop"; bay: number; n?: number }
  | { t: "done" };

const V: Record<Heading, [number, number]> = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
// Lanes: x = −2.62 up to the storage spur, z = 1.72 across the front of the docks, and short spurs up
// the free side of a truck. The storage spot joins the lane through a spur at z = −0.1, between the
// crates and Dock 1, so the forklift never crosses the gate path or passes behind the counter.
const LANE = 1.72;
const STORE = { x: -3.3, z: -0.1, face: "nz" as Heading };
const JUNCTION: [number, number] = [-2.62, -0.1];
const PARK = { x: 2.25, z: 0.75, face: "nx" as Heading };

const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.02;

/**
 * `occupied()` returns the docks with a truck on them, parked or still pulling in or out; `signing()` whether a transaction
 * is waiting for the wallet, which is what keeps a "stage" job alive.
 */
export type Occupancy = Record<number, "parked" | "moving">;

export function useForklift(occupied: () => Occupancy, signing: () => boolean) {
  const [fork, setFork] = useState<Fork>({ x: 2.25, z: 0.75, head: "nx", loaded: false, dur: 0, moving: false, lift: false });
  const [cargo, setCargo] = useState<Cargo | null>(null);
  const [dips, setDips] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState<Loading | null>(null);

  const pos = useRef(fork);
  const queue = useRef<Step[]>([]);
  const job = useRef<Job | null>(null);
  const rr = useRef(0);
  const cargoN = useRef(0);
  const dead = useRef(false);
  const timer = useRef<number>();
  const occ = useRef(occupied);
  occ.current = occupied;
  const sig = useRef(signing);
  sig.current = signing;

  const set = (patch: Partial<Fork>) => {
    pos.current = { ...pos.current, ...patch };
    setFork(pos.current);
  };

  const spot = (bay: number) => {
    const o = occ.current();
    const bx = bayX(bay);
    if (bay === 3 || !(bay + 1 in o)) return { x: bx + 0.72, z: 0.7, face: "nx" as Heading };
    if (bay === 0 || !(bay - 1 in o)) return { x: bx - 0.72, z: 0.7, face: "px" as Heading };
    return { x: bx + 0.38, z: 2.12, face: "nz" as Heading };
  };

  const path = (to: { x: number; z: number }): Step[] => {
    const p = pos.current;
    let cur: [number, number] = [p.x, p.z];
    const dest: [number, number] = [to.x, to.z];
    const pts: [number, number][] = [];
    if (near(cur, [STORE.x, STORE.z])) {
      pts.push(JUNCTION);
      cur = JUNCTION;
    }
    const toStore = near(dest, [STORE.x, STORE.z]);
    const d2 = toStore ? JUNCTION : dest;
    if (Math.abs(cur[0] - d2[0]) < 0.01) pts.push(d2);
    else pts.push([cur[0], LANE], [d2[0], LANE], d2);
    if (toStore) pts.push(dest);
    const out: [number, number][] = [];
    for (const q of pts) {
      const last = out.length ? out[out.length - 1] : ([p.x, p.z] as [number, number]);
      if (!near(last, q)) out.push(q);
    }
    return out.map((q) => ({ t: "move", x: q[0], z: q[1] }));
  };

  const tip = (): [number, number, number] => {
    const v = V[pos.current.head];
    return [pos.current.x + v[0] * 0.42, 0.32, pos.current.z + v[1] * 0.42];
  };

  const throwCargo = (from: [number, number, number], to: [number, number, number], bay: number | null) => {
    const n = ++cargoN.current;
    setCargo({ from, to, n });
    if (bay != null) {
      window.setTimeout(() => !dead.current && setDips((d) => ({ ...d, [bay]: (d[bay] ?? 0) + 1 })), 480);
    }
  };

  const plan = (): Step[] => {
    let q: Step[] = [];
    const go = (s: { x: number; z: number; face: Heading }) => {
      q = q.concat(path(s));
      q.push({ t: "face", head: s.face });
    };
    if (job.current?.type === "stage" && !sig.current()) job.current = null;
    if (!pos.current.loaded) {
      go(STORE);
      q.push({ t: "pick" });
      return q;
    }
    const j = job.current;
    if (j) {
      const s = spot(j.bay);
      const here = Math.abs(pos.current.x - s.x) + Math.abs(pos.current.z - s.z) < 0.02;
      if (!here) {
        go(s);
        return q;
      }
      if (j.type === "stage") return [{ t: "wait", ms: 400 }];
      for (let n = 1; n <= 3; n++) {
        q.push({ t: "drop", bay: j.bay, n });
        if (n < 3) q.push({ t: "back", d: 0.32 }, { t: "restock" }, { t: "back", d: -0.32 });
      }
      q.push({ t: "done" });
      return q;
    }
    const o = occ.current();
    const bays = Object.keys(o)
      .map(Number)
      .filter((b) => o[b] === "parked")
      .sort();
    if (!bays.length) {
      go(PARK);
      q.push({ t: "wait", ms: 1600 });
      return q;
    }
    const b = bays[rr.current++ % bays.length];
    go(spot(b));
    q.push({ t: "drop", bay: b }, { t: "wait", ms: 300 });
    return q;
  };

  const run = useCallback(() => {
    if (dead.current) return;
    if (!queue.current.length) queue.current = plan();
    const a = queue.current.shift()!;
    let ms = 300;
    if (a.t === "move") {
      const dx = a.x - pos.current.x;
      const dz = a.z - pos.current.z;
      const d = Math.abs(dx) + Math.abs(dz);
      const head: Heading = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "px" : "nx") : dz > 0 ? "pz" : "nz";
      ms = Math.max(250, Math.round((d / 1.5) * 1000));
      set({ x: a.x, z: a.z, head, dur: ms, moving: true, lift: false });
      ms += 40;
    } else if (a.t === "back") {
      const v = V[pos.current.head];
      ms = 380;
      set({ x: pos.current.x - v[0] * a.d, z: pos.current.z - v[1] * a.d, dur: ms, moving: true, lift: false });
    } else if (a.t === "face") {
      set({ head: a.head, dur: 0, moving: false });
      ms = 260;
    } else if (a.t === "wait") {
      set({ moving: false, lift: false });
      ms = a.ms;
    } else if (a.t === "pick") {
      throwCargo([-3.25, 0.3, -0.95], tip(), null);
      set({ moving: false, lift: false });
      window.setTimeout(() => !dead.current && set({ loaded: true, lift: true }), 520);
      ms = 1000;
    } else if (a.t === "restock") {
      set({ loaded: true, lift: true, moving: false });
      ms = 420;
    } else if (a.t === "drop") {
      throwCargo(tip(), [bayX(a.bay), 0.8, 0.42], a.bay);
      set({ loaded: false, lift: true, moving: false });
      if (a.n && job.current) setLoading({ id: job.current.id, bay: a.bay, n: a.n });
      ms = 900;
    } else if (a.t === "done") {
      const j = job.current;
      job.current = null;
      setLoading(null);
      j?.after?.();
      ms = 200;
    }
    timer.current = window.setTimeout(run, ms);
    // plan and set only read refs, so the loop is stable for the component's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dead.current = false;
    timer.current = window.setTimeout(run, 600);
    return () => {
      dead.current = true;
      clearTimeout(timer.current);
    };
  }, [run]);

  const assign = useCallback((j: Job | null) => {
    job.current = j;
    queue.current = [];
  }, []);

  return {
    fork,
    cargo,
    dips,
    loading,
    /** Drive to the truck at `bay` while the wallet is open. */
    stage: (bay: number, id: string) => assign({ type: "stage", bay, id }),
    /** Load the truck at `bay`, then call `after`. */
    load: (bay: number, id: string, after: () => void) => assign({ type: "load", bay, id, after }),
    cancel: () => job.current?.type === "stage" && assign(null),
  };
}
