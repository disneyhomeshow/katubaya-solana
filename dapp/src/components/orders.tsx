// Orders as the screens show them: the on-chain Order plus its offer, farmer, warehouse and mint.
import type { Account, Address } from "@solana/kit";
import type { OrderStatusCode } from "../design-system";
import { formatQty } from "../design-system";
import {
  FulfillmentMode,
  OrderStatus,
  fetchAllMaybeLotOffer,
  type FarmerProfile,
  type LotOffer,
  type Order,
  type Warehouse,
} from "../generated";
import { fetchFarmerProfiles, fetchMint, fetchWarehouses, type MintInfo } from "../solana/accounts";
import { nowSeconds } from "../solana/format";
import { rpc } from "../solana/rpc";
import { asUnitCode } from "../solana/units";
import { cropTitle } from "./offers";

export const STATUS_CODE: Record<OrderStatus, OrderStatusCode> = {
  [OrderStatus.EscrowedPickup]: "ESCROWED_PICKUP",
  [OrderStatus.PendingDeliveryQuote]: "PENDING_DELIVERY_QUOTE",
  [OrderStatus.DeliveryQuoted]: "DELIVERY_QUOTED",
  [OrderStatus.EscrowedReady]: "ESCROWED_READY",
  [OrderStatus.InTransit]: "IN_TRANSIT",
  [OrderStatus.Fulfilled]: "FULFILLED",
  [OrderStatus.Refused]: "REFUSED",
  [OrderStatus.Canceled]: "CANCELED",
  [OrderStatus.Expired]: "EXPIRED",
};

/** Statuses `expire_order` accepts: escrow still held and the order not yet moving. */
const PRE_TRANSIT = new Set([
  OrderStatus.EscrowedPickup,
  OrderStatus.PendingDeliveryQuote,
  OrderStatus.DeliveryQuoted,
  OrderStatus.EscrowedReady,
]);

export function isPreTransit(status: OrderStatus): boolean {
  return PRE_TRANSIT.has(status);
}

/** Funds are still in escrow. */
export function isOpen(status: OrderStatus): boolean {
  return PRE_TRANSIT.has(status) || status === OrderStatus.InTransit;
}

/** `expires_at` is inclusive: the order can be expired from that instant on. */
export function isPastDeadline(order: Order, now = nowSeconds()): boolean {
  return isPreTransit(order.status) && now >= order.expiresAt;
}

export type OrderView = {
  account: Account<Order>;
  offer: Account<LotOffer> | undefined;
  farmer: Account<FarmerProfile> | undefined;
  warehouse: Account<Warehouse> | undefined;
  mint: MintInfo | null;
};

export async function enrichOrders(orders: Account<Order>[]): Promise<OrderView[]> {
  const offerAddresses = [...new Set(orders.map((o) => o.data.offer))];
  const [offers, farmers, warehouses, mints] = await Promise.all([
    offerAddresses.length ? fetchAllMaybeLotOffer(rpc, offerAddresses) : Promise.resolve([]),
    fetchFarmerProfiles(orders.map((o) => o.data.farmer)),
    fetchWarehouses(orders.map((o) => o.data.warehouse)),
    Promise.all([...new Set(orders.map((o) => o.data.mint))].map((m) => fetchMint(m as Address))),
  ]);
  const offerBy = new Map(offers.filter((o) => o.exists).map((o) => [o.address as string, o as Account<LotOffer>]));
  const mintBy = new Map(mints.filter((m): m is MintInfo => !!m).map((m) => [m.address as string, m]));
  return orders.map((account) => ({
    account,
    offer: offerBy.get(account.data.offer),
    farmer: farmers.get(account.data.farmer),
    warehouse: warehouses.get(account.data.warehouse),
    mint: mintBy.get(account.data.mint) ?? null,
  }));
}

export function orderQty(view: OrderView): string {
  return view.offer ? formatQty(view.account.data.qty.toString(), asUnitCode(view.offer.data.unitCode)) : view.account.data.qty.toString();
}

/** "Banana Prata, 25 kg" */
export function orderTitle(view: OrderView): string {
  return view.offer ? `${cropTitle(view.offer.data)}, ${orderQty(view)}` : `Order, ${orderQty(view)}`;
}

export function modeLabel(order: Order): string {
  return order.fulfillmentMode === FulfillmentMode.Delivery ? "Delivery" : "Pickup";
}

/** Statuses in which the quoted delivery fee was accepted into escrow (and, once fulfilled, paid out). */
const FEE_ACCEPTED = new Set([OrderStatus.EscrowedReady, OrderStatus.InTransit, OrderStatus.Fulfilled]);

/** What the customer paid in: the subtotal, plus the delivery fee only once it was accepted. */
export function orderTotal(order: Order): bigint {
  return order.subtotalMinor + (FEE_ACCEPTED.has(order.status) ? order.deliveryFeeMinor : 0n);
}
