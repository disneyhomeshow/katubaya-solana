// The warehouse yard as data: what the chain holds for one warehouse, and where each piece stands on
// the 1200 × 640 render. World x runs along the docks, z toward the road; proj() is the renders' camera.
import type { Account, Address } from "@solana/kit";
import { formatMinor, type OrderStatusCode } from "../../design-system";
import {
  FulfillmentMode,
  OrderStatus,
  WarehouseCustomerStatus,
  type FarmerProfile,
  type ProgramConfig,
  type Warehouse,
  type WarehouseCustomer,
} from "../../generated";
import { mintSymbol } from "../../config";
import { cropImage, YARD, type YardSprite } from "../../game/assets";
import { enrichOrders, isOpen, orderQty, orderTotal, STATUS_CODE, type OrderView } from "../../components/orders";
import { cropTitle } from "../../components/offers";
import { fetchConfig, fetchWarehouse, listCustomerLinksByWarehouse, listFarmersByWarehouse, listOrdersByWarehouse } from "../../solana/accounts";
import { shortKey } from "../../solana/format";

// ---- Geometry

export const YARD_W = 1200;
export const YARD_H = 640;
/** The yard's content inside the render; Fit frames this box so the map fills more of the viewport. */
export const YARD_BOX = { x0: 40, y0: 44, x1: 1168, y1: 612 };
export const DOCKS = 4;

export function proj(x: number, y: number, z: number): [number, number] {
  const dy = y - 0.28;
  return [600 + 95 * (x * 0.848048 + z * -0.529919), 320 - 95 * (x * -0.232301 + dy * 0.898794 + z * -0.37176)];
}

export function bayX(i: number): number {
  return [-1.8, -0.75, 0.3, 1.35][i];
}

/** A sprite standing at (x, z): its box on the stage, drawn front to back by its ground line. */
export function place(k: YardSprite, x: number, z: number) {
  const [w, , ax, ay] = YARD[k].meta;
  const [sx, sy] = proj(x, 0, z);
  return { left: sx - ax / 2, top: sy - ay / 2, width: w / 2, zIndex: Math.round(sy + 10) };
}

// ---- Money, per mint

export type Money = { minor: bigint; decimals: number; symbol: string };
export type Totals = Map<string, Money>;

export function addMoney(totals: Totals, mint: string, minor: bigint, decimals: number) {
  const t = totals.get(mint);
  totals.set(mint, { minor: (t?.minor ?? 0n) + minor, decimals, symbol: mintSymbol(mint as Address) });
}

export function moneyText(totals: Totals, fallbackSymbol = ""): string {
  if (!totals.size) return `0.00${fallbackSymbol ? ` ${fallbackSymbol}` : ""}`;
  return [...totals.values()].map((m) => `${formatMinor(m.minor, m.decimals)} ${m.symbol}`).join(" + ");
}

// ---- Orders as the yard shows them

export type YardOrder = {
  address: Address;
  /** "1043": the order_id. */
  id: string;
  crop: string;
  qty: string;
  farmer: string;
  delivery: boolean;
  status: OrderStatus;
  code: OrderStatusCode;
  sub: bigint;
  /** The delivery fee quoted (0 until quoted). */
  fee: bigint;
  service: bigint;
  /** What sits in escrow now. */
  held: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  thumb: string;
  decimals: number;
  symbol: string;
  view: OrderView;
};

export const AT_DOCK = new Set([OrderStatus.PendingDeliveryQuote, OrderStatus.DeliveryQuoted, OrderStatus.EscrowedReady]);

export function toYardOrder(view: OrderView): YardOrder {
  const o = view.account.data;
  const crop = view.offer ? cropTitle(view.offer.data) : "Order";
  return {
    address: view.account.address,
    id: o.orderId.toString(),
    crop,
    qty: orderQty(view),
    farmer: view.farmer?.data.displayName || shortKey(o.farmer),
    delivery: o.fulfillmentMode === FulfillmentMode.Delivery,
    status: o.status,
    code: STATUS_CODE[o.status],
    sub: o.subtotalMinor,
    fee: o.deliveryFeeMinor,
    service: o.serviceFeeMinor,
    held: isOpen(o.status) ? orderTotal(o) : 0n,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    thumb: cropImage(view.offer?.data.cropName ?? ""),
    decimals: view.mint?.decimals ?? 6,
    symbol: mintSymbol(o.mint),
    view,
  };
}

// ---- The warehouse, its gate and its orders

export type GateCustomer = { kind: "customer"; key: string; link: Account<WarehouseCustomer>; wallet: Address };
export type GateFarmer = { kind: "farmer"; key: string; profile: Account<FarmerProfile>; wallet: Address; name: string };
export type Visitor = GateCustomer | GateFarmer;

export type YardData = {
  warehouse: Account<Warehouse>;
  config: Account<ProgramConfig> | null;
  orders: YardOrder[];
  customers: GateCustomer[];
  farmers: GateFarmer[];
  approvedFarmers: number;
  confirmedCustomers: number;
};

export async function loadYard(address: Address): Promise<YardData> {
  const [warehouse, config, orders, links, farmers] = await Promise.all([
    fetchWarehouse(address),
    fetchConfig(),
    listOrdersByWarehouse(address),
    listCustomerLinksByWarehouse(address),
    listFarmersByWarehouse(address),
  ]);
  if (!warehouse) throw new Error("This warehouse is not on Solana any more.");
  const views = await enrichOrders(orders);
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  return {
    warehouse,
    config,
    orders: views.map(toYardOrder),
    customers: links
      .filter((l) => l.data.status === WarehouseCustomerStatus.Pending)
      .map((link) => ({ kind: "customer" as const, key: link.address, link, wallet: link.data.customer }))
      .sort(byKey),
    farmers: farmers
      .filter((f) => !f.data.warehouseApproved)
      .map((profile) => ({ kind: "farmer" as const, key: profile.address, profile, wallet: profile.data.authority, name: profile.data.displayName }))
      .sort(byKey),
    approvedFarmers: farmers.filter((f) => f.data.warehouseApproved).length,
    confirmedCustomers: links.filter((l) => l.data.status === WarehouseCustomerStatus.Confirmed).length,
  };
}

/** "…ab12" */
export function tail(key: string): string {
  return `…${key.slice(-4)}`;
}
