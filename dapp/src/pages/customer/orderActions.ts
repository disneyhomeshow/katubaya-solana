// The customer's three order transactions: accept_delivery_fee, reject_delivery_fee and expire_order.
import { useCallback } from "react";
import type { Address } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { formatMinor } from "../../design-system";
import { getAcceptDeliveryFeeInstructionAsync, getExpireOrderInstructionAsync, getRejectDeliveryFeeInstructionAsync } from "../../generated";
import { mintSymbol } from "../../config";
import { escrowOf, tokenAccountOf, tokenBalance } from "../../solana/accounts";
import { NETWORK_FEE } from "../../solana/rent";
import { useTx } from "../../tx/TxProvider";
import { useWallet } from "../../wallet/WalletProvider";
import { orderQty, type OrderView } from "../../components/orders";

export function useOrderActions(view: OrderView | undefined, refresh: () => Promise<unknown>) {
  const run = useTx();
  const { address: wallet } = useWallet();

  const context = useCallback(async () => {
    if (!view || !view.mint || !wallet) return null;
    const customerTokenAccount = await tokenAccountOf(view.account.data.customer, view.mint);
    return { mint: view.mint, customerTokenAccount, wallet };
  }, [view, wallet]);

  const name = view?.warehouse?.data.name ?? "the warehouse";
  const symbol = view ? mintSymbol(view.account.data.mint) : "";
  const decimals = view?.mint?.decimals ?? 6;
  const o = view?.account.data;

  const accept = useCallback(async () => {
    const ctx = await context();
    if (!ctx || !view || !o) return;
    run({
      title: "Accept delivery fee",
      instruction: "accept_delivery_fee",
      description: `${formatMinor(o.deliveryFeeMinor, decimals)} ${symbol} joins the ${formatMinor(o.subtotalMinor, decimals)} ${symbol} already in this order’s escrow. ${name} then prepares the delivery.`,
      lines: [
        { label: "Delivery fee, to escrow", minor: o.deliveryFeeMinor, decimals, symbol, escrow: true, note: `Quoted by ${name}` },
        { label: "Held in escrow after this", minor: o.subtotalMinor + o.deliveryFeeMinor, decimals, symbol, total: true },
        { label: "Network fee", value: NETWORK_FEE },
      ],
      preflight: async () => {
        const balance = (await tokenBalance(ctx.customerTokenAccount)) ?? 0n;
        if (balance < o.deliveryFeeMinor) {
          return {
            title: `Not enough ${symbol}`,
            message: `Your wallet has ${formatMinor(balance, decimals)} ${symbol}; the delivery fee is ${formatMinor(o.deliveryFeeMinor, decimals)} ${symbol}. Add funds and try again, or reject the quote to get your subtotal back.`,
          };
        }
        return null;
      },
      build: async (signer) => [
        await getAcceptDeliveryFeeInstructionAsync({
          order: view.account.address,
          mint: ctx.mint.address,
          customerTokenAccount: ctx.customerTokenAccount,
          customer: signer,
          tokenProgram: ctx.mint.tokenProgram,
        }),
      ],
      onConfirmed: () => refresh().then(() => undefined),
    });
  }, [context, view, o, run, name, symbol, decimals, refresh]);

  const refundLines = useCallback(
    async (address: Address) => {
      const held = (await tokenBalance(await escrowOf(address))) ?? 0n;
      return [
        { label: "Back to your wallet", minor: held, decimals, symbol, note: "Everything held in this order’s escrow" },
        { label: "Escrow account rent", value: "Returned", note: "The emptied escrow account closes" },
        { label: "Network fee", value: NETWORK_FEE },
      ];
    },
    [decimals, symbol],
  );

  const reject = useCallback(async () => {
    const ctx = await context();
    if (!ctx || !view || !o || !view.offer) return;
    run({
      title: "Reject and refund",
      instruction: "reject_delivery_fee",
      description: `The order is canceled and the ${formatMinor(o.subtotalMinor, decimals)} ${symbol} subtotal comes back to you. The ${orderQty(view)} go back on the farmer’s offer.`,
      lines: await refundLines(view.account.address),
      build: async (signer) => [
        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: ctx.wallet, mint: ctx.mint.address, tokenProgram: ctx.mint.tokenProgram }),
        await getRejectDeliveryFeeInstructionAsync({
          order: view.account.address,
          offer: o.offer,
          mint: ctx.mint.address,
          customerTokenAccount: ctx.customerTokenAccount,
          customer: signer,
          tokenProgram: ctx.mint.tokenProgram,
        }),
      ],
      onConfirmed: () => refresh().then(() => undefined),
    });
  }, [context, view, o, run, refundLines, symbol, decimals, refresh]);

  const close = useCallback(async () => {
    const ctx = await context();
    if (!ctx || !view || !o) return;
    run({
      title: "Close and refund",
      instruction: "expire_order",
      description: `The order passed its deadline. Closing it returns everything in escrow to your wallet and the ${orderQty(view)} to the farmer’s offer.`,
      lines: await refundLines(view.account.address),
      build: async (signer) => [
        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: o.customer, mint: ctx.mint.address, tokenProgram: ctx.mint.tokenProgram }),
        await getExpireOrderInstructionAsync({
          order: view.account.address,
          offer: o.offer,
          mint: ctx.mint.address,
          customerTokenAccount: ctx.customerTokenAccount,
          customer: o.customer,
          tokenProgram: ctx.mint.tokenProgram,
        }),
      ],
      onConfirmed: () => refresh().then(() => undefined),
    });
  }, [context, view, o, run, refundLines, refresh]);

  return { accept, reject, close };
}
