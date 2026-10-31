// The program map as data: every warehouse on a grid of plots, the roads between them and what each
// holds in escrow. Geometry follows the renders' camera at 60 px per world unit; a plot is 4 units wide.
import type { Account, Address } from "@solana/kit";
import { FulfillmentMode, OrderStatus, WarehouseCustomerStatus, type ProgramConfig, type Warehouse } from "../../generated";
import { isOpen, orderTotal } from "../../components/orders";
import { fetchConfig, fetchMint, listAllCustomerLinks, listAllFarmers, listAllOrders, listWarehouses } from "../../solana/accounts";
import { freshId } from "../../solana/format";
import { addMoney, type Totals } from "../warehouse/yardModel";

export const S = 4;
const RINGS = 6;

/** Plots around the origin, ring by ring: [0,0], then the 8 around it, and so on. */
export const CELLS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let ring = 0; ring <= RINGS; ring++)
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) if (Math.max(Math.abs(i), Math.abs(j)) === ring) out.push([i, j]);
  return out;
})();

// The program stores no map, so the plot a warehouse was founded on rides in its id: ids from this map
// are (seconds since 2026 << 8) | (plot + 1). Any other id (a small one from a script, say) takes the
// first free plot, ring by ring, in id order.
const PLOT_BITS = 8n;
const ENCODED_FROM = 1n << 16n;

export function warehouseIdFor(plot: number): bigint {
  return (freshId() << PLOT_BITS) | BigInt(plot + 1);
}

function plotOfId(id: bigint): number | null {
  if (id < ENCODED_FROM) return null;
  const p = Number(id & 0xffn) - 1;
  return p >= 0 && p < CELLS.length ? p : null;
}

export type MapWarehouse = {
  account: Account<Warehouse>;
  address: Address;
  id: bigint;
  name: string;
  i: number;
  j: number;
  farmers: number;
  customers: number;
  held: Totals;
  inTransit: number;
};

export type MapRoad = { id: string; from: MapWarehouse; to: MapWarehouse };

export type ProgramData = {
  config: Account<ProgramConfig> | null;
  warehouses: MapWarehouse[];
  roads: MapRoad[];
  held: Totals;
  farmers: number;
  /** The latest orders anywhere, for the program log. */
  orders: { id: string; warehouse: string; total: bigint; decimals: number; mint: Address; createdAt: bigint; pickup: boolean }[];
};

export async function loadProgram(): Promise<ProgramData> {
  const [config, warehouses, farmers, orders, links] = await Promise.all([
    fetchConfig(),
    listWarehouses(),
    listAllFarmers(),
    listAllOrders(),
    listAllCustomerLinks(),
  ]);
  const mints = new Map(
    (await Promise.all([...new Set(orders.map((o) => o.data.mint))].map((m) => fetchMint(m)))).filter((m) => !!m).map((m) => [m!.address as string, m!]),
  );
  const decimalsOf = (mint: string) => mints.get(mint)?.decimals ?? 6;

  // place: encoded plots first, then the rest in id order
  const sorted = [...warehouses].sort((a, b) => (a.data.warehouseId < b.data.warehouseId ? -1 : 1));
  const taken = new Set<number>();
  const plotOf = new Map<string, number>();
  for (const w of sorted) {
    const p = plotOfId(w.data.warehouseId);
    if (p != null && !taken.has(p)) {
      taken.add(p);
      plotOf.set(w.address, p);
    }
  }
  for (const w of sorted) {
    if (plotOf.has(w.address)) continue;
    const p = CELLS.findIndex((_, n) => !taken.has(n));
    taken.add(p);
    plotOf.set(w.address, p);
  }

  const held: Totals = new Map();
  const list: MapWarehouse[] = sorted.map((account) => {
    const [i, j] = CELLS[plotOf.get(account.address)!];
    const mine = orders.filter((o) => o.data.warehouse === account.address);
    const t: Totals = new Map();
    for (const o of mine) {
      if (!isOpen(o.data.status)) continue;
      addMoney(t, o.data.mint, orderTotal(o.data), decimalsOf(o.data.mint));
      addMoney(held, o.data.mint, orderTotal(o.data), decimalsOf(o.data.mint));
    }
    return {
      account,
      address: account.address,
      id: account.data.warehouseId,
      name: account.data.name,
      i,
      j,
      farmers: farmers.filter((f) => f.data.warehouse === account.address && f.data.warehouseApproved).length,
      customers: links.filter((l) => l.data.warehouse === account.address && l.data.status === WarehouseCustomerStatus.Confirmed).length,
      held: t,
      inTransit: mine.filter((o) => o.data.status === OrderStatus.InTransit && o.data.fulfillmentMode === FulfillmentMode.Delivery).length,
    };
  });

  // each warehouse after the first is reached by a road from the nearest one founded before it
  const roads: MapRoad[] = [];
  list.forEach((w, n) => {
    if (!n) return;
    let best = list[0];
    let bd = Infinity;
    for (const p of list.slice(0, n)) {
      const dist = Math.abs(p.i - w.i) + Math.abs(p.j - w.j);
      if (dist < bd) {
        bd = dist;
        best = p;
      }
    }
    roads.push({ id: `r${w.address}`, from: best, to: w });
  });

  const whName = new Map(list.map((w) => [w.address as string, w.name]));
  return {
    config,
    warehouses: list,
    roads,
    held,
    farmers: farmers.filter((f) => f.data.warehouseApproved).length,
    orders: orders.slice(0, 12).map((o) => ({
      id: o.data.orderId.toString(),
      warehouse: whName.get(o.data.warehouse) ?? "a warehouse",
      total: o.data.subtotalMinor,
      decimals: decimalsOf(o.data.mint),
      createdAt: o.data.createdAt,
      pickup: o.data.fulfillmentMode === FulfillmentMode.Pickup,
      mint: o.data.mint,
    })),
  };
}

// ---- Geometry

export function rawP(x: number, y: number, z: number): [number, number] {
  return [60 * (x * 0.848048 - z * 0.529919), -60 * (x * -0.232301 + y * 0.898794 + z * -0.37176)];
}

export type Bounds = { i0: number; i1: number; j0: number; j1: number };

export function boundsOf(ws: { i: number; j: number }[]): Bounds {
  if (!ws.length) return { i0: -1, i1: 1, j0: -1, j1: 1 };
  const is = ws.map((w) => w.i);
  const js = ws.map((w) => w.j);
  return { i0: Math.min(...is) - 1, i1: Math.max(...is) + 1, j0: Math.min(...js) - 1, j1: Math.max(...js) + 1 };
}

export function mapGeo(b: Bounds) {
  const x0 = (b.i0 - 0.5) * S;
  const x1 = (b.i1 + 0.5) * S;
  const z0 = (b.j0 - 0.5) * S;
  const z1 = (b.j1 + 0.5) * S;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [cx, cz] of [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ])
    for (const y of [-0.4, 2.6]) {
      const p = rawP(cx, y, cz);
      xs.push(p[0]);
      ys.push(p[1]);
    }
  const pad = 50;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { b, x0, x1, z0, z1, ox: pad - minX, oy: pad + 30 - minY, W: Math.round(maxX - minX + 2 * pad), H: Math.round(maxY - minY + 2 * pad + 30) };
}

export type Geo = ReturnType<typeof mapGeo>;

export function pts(list: [number, number, number][]): string {
  return list
    .map((q) => {
      const p = rawP(q[0], q[1], q[2]);
      return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    })
    .join(" ");
}

const routes = new Map<string, [number, number][]>();

/** The road between two plots: along the plot edges, corners rounded, resampled every 0.5 units so trucks move at a steady speed. */
export function routeFor(a: { i: number; j: number }, b: { i: number; j: number }): [number, number][] {
  const key = [a.i, a.j, b.i, b.j].join();
  const hit = routes.get(key);
  if (hit) return hit;
  const h = S / 2;
  const raw: [number, number][] = [
    [a.i * S, a.j * S + h],
    [b.i * S + h, a.j * S + h],
    [b.i * S + h, b.j * S + h],
    [b.i * S, b.j * S + h],
  ];
  const c: [number, number][] = [];
  for (const p of raw) {
    const q = c[c.length - 1];
    if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) > 1e-6) c.push(p);
  }
  // drop collinear corners
  for (let n = c.length - 2; n >= 1; n--) {
    const [u, m, w] = [c[n - 1], c[n], c[n + 1]];
    if (Math.abs((m[0] - u[0]) * (w[1] - m[1]) - (m[1] - u[1]) * (w[0] - m[0])) < 1e-6) c.splice(n, 1);
  }
  // round every corner with a quarter curve, radius up to 1.2 world units
  const poly: [number, number][] = [c[0]];
  for (let n = 1; n < c.length - 1; n++) {
    const [P0, P1, P2] = [c[n - 1], c[n], c[n + 1]];
    const l1 = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
    const l2 = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
    const rr = Math.min(1.2, l1 / 2, l2 / 2);
    const A: [number, number] = [P1[0] - ((P1[0] - P0[0]) / l1) * rr, P1[1] - ((P1[1] - P0[1]) / l1) * rr];
    const B: [number, number] = [P1[0] + ((P2[0] - P1[0]) / l2) * rr, P1[1] + ((P2[1] - P1[1]) / l2) * rr];
    poly.push(A);
    for (let q = 1; q < 8; q++) {
      const t = q / 8;
      const it = 1 - t;
      poly.push([it * it * A[0] + 2 * it * t * P1[0] + t * t * B[0], it * it * A[1] + 2 * it * t * P1[1] + t * t * B[1]]);
    }
    poly.push(B);
  }
  poly.push(c[c.length - 1]);
  const out: [number, number][] = [poly[0]];
  let acc = 0;
  const step = 0.5;
  for (let n = 1; n < poly.length; n++) {
    const [p0, p1] = [poly[n - 1], poly[n]];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    let d = step - acc;
    while (d <= L) {
      out.push([p0[0] + ((p1[0] - p0[0]) * d) / L, p0[1] + ((p1[1] - p0[1]) * d) / L]);
      d += step;
    }
    acc = L - (d - step);
  }
  const last = poly[poly.length - 1];
  const ol = out[out.length - 1];
  if (Math.hypot(last[0] - ol[0], last[1] - ol[1]) > 0.2) out.push(last);
  else out[out.length - 1] = last;
  routes.set(key, out);
  return out;
}

/** Plots a warehouse can be founded on: inside the map's bounds and not built on. An empty map has one, the centre. */
export function freeCells(ws: { i: number; j: number }[]): number[] {
  if (!ws.length) return [0];
  const b = boundsOf(ws);
  const used = new Set(ws.map((w) => `${w.i},${w.j}`));
  return CELLS.map((c, n) => [c, n] as const)
    .filter(([[i, j]]) => i >= b.i0 && i <= b.i1 && j >= b.j0 && j <= b.j1 && !used.has(`${i},${j}`))
    .map(([, n]) => n);
}

export function nearest<T extends { i: number; j: number }>(ws: T[], i: number, j: number): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const w of ws) {
    const d = Math.abs(w.i - i) + Math.abs(w.j - j);
    if (d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

/** "118, 1190" → zip prefixes; null when one is not 3 to 5 digits. */
export function parseZips(text: string): { prefix: number; len: number }[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean);
  if (parts.some((p) => p.length < 3 || p.length > 5)) return null;
  return [...new Set(parts)].map((p) => ({ prefix: Number(p), len: p.length }));
}

export function zipsText(w: Warehouse): string {
  return w.deliverZipPrefixes.map((z) => String(z.prefix).padStart(z.len, "0")).join(", ");
}
