// The operator's transactions, as the yard asks the wallet for them. Each returns the dialog's copy and
// lines plus how to build it; the yard adds what happens on the map before, during and after.
import type { Account, Address, Instruction, TransactionSendingSigner } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { formatMinor, type TransactionLine } from "../../design-system";
import {
  getCompleteOrderInstructionAsync,
  getConfirmCustomerInstruction,
  getExpireOrderInstructionAsync,
  getMarkInTransitInstruction,
  getQuoteDeliveryFeeInstruction,
  getRefuseDeliveryInstructionAsync,
  getRevokeCustomerInstruction,
  getSetFarmerWarehouseInstruction,
  type ProgramConfig,
  type Warehouse,
} from "../../generated";
import { accountExists, escrowOf, tokenAccountOf, tokenBalance } from "../../solana/accounts";
import { formatFeeBps } from "../../solana/format";
import { rpc } from "../../solana/rpc";
import { formatSol, NETWORK_FEE, rentOf, SIZE } from "../../solana/rent";
import type { Failure } from "../../solana/errors";
import { tail, type GateCustomer, type GateFarmer, type YardOrder } from "./yardModel";

export type YardTx = {
  title: string;
  instruction: string;
  description: string;
  lines: TransactionLine[];
  build: (signer: TransactionSendingSigner) => Promise<Instruction[]>;
  preflight?: () => Promise<Failure | null>;
};

type Ctx = { warehouse: Account<Warehouse>; config: Account<ProgramConfig> | null };

const network: TransactionLine = { label: "Network fee", value: NETWORK_FEE };

export function confirmCustomerTx({ warehouse }: Ctx, c: GateCustomer): YardTx {
  return {
    title: `Confirm customer ${tail(c.wallet)}`,
    instruction: "confirm_customer",
    description: `${warehouse.data.name} confirms this wallet. They can order any lot routed through the yard. No money moves.`,
    lines: [{ label: "Customer", value: `${c.wallet.slice(0, 4)}${tail(c.wallet)}` }, network],
    build: async (signer) => [
      getConfirmCustomerInstruction({ warehouseCustomer: c.link.address, warehouse: warehouse.address, operator: signer, notesHash: null }),
    ],
  };
}

export function turnAwayTx({ warehouse }: Ctx, c: GateCustomer): YardTx {
  return {
    title: `Turn away ${tail(c.wallet)}`,
    instruction: "revoke_customer",
    description: `The request closes. This wallet can't order through ${warehouse.data.name}. No money moves.`,
    lines: [{ label: "Customer", value: `${c.wallet.slice(0, 4)}${tail(c.wallet)}` }, network],
    build: async (signer) => [getRevokeCustomerInstruction({ warehouseCustomer: c.link.address, warehouse: warehouse.address, operator: signer })],
  };
}

export function acceptFarmerTx({ warehouse }: Ctx, f: GateFarmer): YardTx {
  return {
    title: `Accept ${f.name}`,
    instruction: "set_farmer_warehouse",
    description: `${f.name} joins ${warehouse.data.name}. Their lots will route through this yard. No money moves.`,
    lines: [{ label: "Farmer", value: `${f.wallet.slice(0, 4)}${tail(f.wallet)}` }, network],
    build: async (signer) => [
      getSetFarmerWarehouseInstruction({ farmerProfile: f.profile.address, warehouse: warehouse.address, operator: signer }),
    ],
  };
}

export function quoteTx({ warehouse }: Ctx, o: YardOrder, fee: bigint): YardTx {
  return {
    title: `Quote ${fmt(fee, o)} for #${o.id}`,
    instruction: "quote_delivery_fee",
    description: "The customer sees this fee and accepts it into escrow or rejects it for a full refund. No money moves now.",
    lines: [{ label: "Delivery fee quoted", minor: fee, decimals: o.decimals, symbol: o.symbol }, network],
    build: async (signer) => [
      getQuoteDeliveryFeeInstruction({ order: o.address, warehouse: warehouse.address, operator: signer, deliveryFeeMinor: fee }),
    ],
  };
}

export function sendOutTx({ warehouse }: Ctx, o: YardOrder): YardTx {
  const pickup = !o.delivery;
  return {
    title: pickup ? `Hand #${o.id} over at the counter` : `Send #${o.id} out`,
    instruction: "mark_in_transit",
    description: pickup
      ? "The customer takes the order at the counter. From now on it can no longer be canceled. No money moves yet."
      : "The truck leaves the yard. From now on the order can no longer be canceled or refused. No money moves yet.",
    lines: [
      { label: "Held in escrow", minor: o.held, decimals: o.decimals, symbol: o.symbol, escrow: true, note: "Stays held until you complete the order" },
      network,
    ],
    build: async (signer) => [getMarkInTransitInstruction({ order: o.address, warehouse: warehouse.address, operator: signer })],
  };
}

export async function completeTx({ warehouse, config }: Ctx, o: YardOrder, wallet: Address): Promise<YardTx> {
  const mint = o.view.mint;
  if (!mint || !config) throw new Error("The order's mint or the program config could not be read.");
  const data = o.view.account.data;
  const escrow = await escrowOf(o.address);
  const [farmerAta, logisticsAta, held, escrowLamports] = await Promise.all([
    tokenAccountOf(data.farmer, mint),
    tokenAccountOf(config.data.logisticsWallet, mint),
    tokenBalance(escrow),
    rpc.getBalance(escrow).send(),
  ]);
  const [farmerHas, logisticsHas] = await Promise.all([accountExists(farmerAta), accountExists(logisticsAta)]);
  const missing = (farmerHas ? 0 : 1) + (logisticsHas ? 0 : 1);
  const ataRent = missing ? await rentOf(mint.tokenProgram === TOKEN_PROGRAM_ADDRESS ? SIZE.tokenAccount : SIZE.tokenAccount2022) : 0n;
  const farmerGets = o.sub - o.service;
  const total = held ?? o.held;
  return {
    title: `Complete #${o.id} and release`,
    instruction: "complete_order",
    description: "The escrow opens: the farmer is paid, the service and delivery fees go to the logistics wallet, and the escrow account closes.",
    lines: [
      { label: `To ${o.farmer}`, minor: farmerGets, decimals: o.decimals, symbol: o.symbol },
      {
        label: "To the logistics wallet",
        minor: total - farmerGets,
        decimals: o.decimals,
        symbol: o.symbol,
        note: `${formatFeeBps(warehouse.data.feeBps)} service fee${o.fee ? " + delivery fee" : ""}`,
      },
      { label: "Escrow rent", value: formatSol(escrowLamports.value), note: "Back to the customer" },
      ...(missing
        ? [{ label: missing === 2 ? "Two payout accounts" : "Payout account", value: formatSol(ataRent * BigInt(missing)), note: "Created now, rent paid by you" }]
        : []),
      { label: "Released in total", minor: total, decimals: o.decimals, symbol: o.symbol, total: true },
    ],
    build: async (signer) => [
      ...(farmerHas ? [] : [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: data.farmer, mint: mint.address, tokenProgram: mint.tokenProgram })]),
      ...(logisticsHas
        ? []
        : [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: config.data.logisticsWallet, mint: mint.address, tokenProgram: mint.tokenProgram })]),
      await getCompleteOrderInstructionAsync({
        order: o.address,
        warehouse: warehouse.address,
        mint: mint.address,
        farmerTokenAccount: farmerAta,
        logisticsTokenAccount: logisticsAta,
        customer: data.customer,
        operator: signer,
        tokenProgram: mint.tokenProgram,
      }),
    ],
    preflight: async () =>
      wallet === warehouse.data.operator
        ? null
        : { title: "This wallet doesn't run the warehouse", message: "Only the warehouse's operator wallet can release an order." },
  };
}

async function refundContext(o: YardOrder) {
  const mint = o.view.mint;
  if (!mint) throw new Error("The order's mint could not be read.");
  const data = o.view.account.data;
  const [customerAta, held] = await Promise.all([tokenAccountOf(data.customer, mint), tokenBalance(await escrowOf(o.address))]);
  return { mint, data, customerAta, held: held ?? o.held };
}

export async function refuseTx({ warehouse }: Ctx, o: YardOrder): Promise<YardTx> {
  const { mint, data, customerAta, held } = await refundContext(o);
  return {
    title: `Refuse delivery of #${o.id}`,
    instruction: "refuse_delivery",
    description: "The order closes as refused. Everything in escrow goes back to the customer and the stock returns to the farmer’s lot.",
    lines: [
      { label: "Back to the customer", minor: held, decimals: o.decimals, symbol: o.symbol },
      { label: "Back on the lot", value: o.qty },
      { label: "Network fee", value: NETWORK_FEE, note: "Paid by you" },
    ],
    build: async (signer) => [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: data.customer, mint: mint.address, tokenProgram: mint.tokenProgram }),
      await getRefuseDeliveryInstructionAsync({
        order: o.address,
        warehouse: warehouse.address,
        offer: data.offer,
        mint: mint.address,
        customerTokenAccount: customerAta,
        customer: data.customer,
        operator: signer,
        tokenProgram: mint.tokenProgram,
      }),
    ],
  };
}

export async function expireTx(o: YardOrder): Promise<YardTx> {
  const { mint, data, customerAta, held } = await refundContext(o);
  return {
    title: `Close #${o.id} as expired`,
    instruction: "expire_order",
    description: "The order passed its deadline. Closing it returns everything in escrow to the customer and the stock to the farmer’s lot.",
    lines: [
      { label: "Back to the customer", minor: held, decimals: o.decimals, symbol: o.symbol },
      { label: "Back on the lot", value: o.qty },
      { label: "Network fee", value: NETWORK_FEE, note: "Paid by you" },
    ],
    build: async (signer) => [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: data.customer, mint: mint.address, tokenProgram: mint.tokenProgram }),
      await getExpireOrderInstructionAsync({
        order: o.address,
        offer: data.offer,
        mint: mint.address,
        customerTokenAccount: customerAta,
        customer: data.customer,
        tokenProgram: mint.tokenProgram,
      }),
    ],
  };
}

function fmt(minor: bigint, o: YardOrder): string {
  return `${formatMinor(minor, o.decimals)} ${o.symbol}`;
}
