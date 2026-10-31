// Errors say what happened and what to do next, in the person's words, never the program's.
import type { Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  FARMER_CORE_ERROR__ALREADY_CONFIRMED,
  FARMER_CORE_ERROR__ALREADY_REVOKED,
  FARMER_CORE_ERROR__CUSTOMER_NOT_CONFIRMED,
  FARMER_CORE_ERROR__FARMER_NOT_APPROVED,
  FARMER_CORE_ERROR__FEE_BPS_TOO_HIGH,
  FARMER_CORE_ERROR__INSUFFICIENT_STOCK,
  FARMER_CORE_ERROR__INVALID_EXPIRY,
  FARMER_CORE_ERROR__INVALID_ORDER_STATUS,
  FARMER_CORE_ERROR__INVALID_PRICE,
  FARMER_CORE_ERROR__INVALID_QUANTITY,
  FARMER_CORE_ERROR__INVALID_ZIP_PREFIX_LEN,
  FARMER_CORE_ERROR__MINT_EXTENSION_NOT_ALLOWED,
  FARMER_CORE_ERROR__MINT_NOT_ALLOWED,
  FARMER_CORE_ERROR__NAME_TOO_LONG,
  FARMER_CORE_ERROR__NOTES_TOO_LONG,
  FARMER_CORE_ERROR__OFFER_EXPIRED,
  FARMER_CORE_ERROR__OFFER_INACTIVE,
  FARMER_CORE_ERROR__ORDER_NOT_EXPIRED,
  FARMER_CORE_ERROR__PROGRAM_PAUSED,
  FARMER_CORE_ERROR__TOO_MANY_ALLOWED_MINTS,
  FARMER_CORE_ERROR__TOO_MANY_ZIP_PREFIXES,
  FARMER_CORE_ERROR__UNAUTHORIZED_ADMIN,
  FARMER_CORE_ERROR__UNAUTHORIZED_OPERATOR,
  FARMER_CORE_ERROR__URI_TOO_LONG,
  FARMER_CORE_PROGRAM_ADDRESS,
  getFarmerCoreErrorMessage,
  type FarmerCoreError,
} from "../generated";

export type Failure = { title: string; message: string };

const PROGRAM_ERRORS: Partial<Record<FarmerCoreError, Failure>> = {
  [FARMER_CORE_ERROR__PROGRAM_PAUSED]: {
    title: "New orders are paused",
    message: "The program admin has paused the market. Nothing was charged; try again once it reopens.",
  },
  [FARMER_CORE_ERROR__FARMER_NOT_APPROVED]: {
    title: "Your warehouse hasn't approved you yet",
    message: "You can publish once the warehouse approves your profile.",
  },
  [FARMER_CORE_ERROR__CUSTOMER_NOT_CONFIRMED]: {
    title: "The warehouse hasn't confirmed you",
    message: "Ordering opens once the warehouse confirms you. Nothing was charged.",
  },
  [FARMER_CORE_ERROR__OFFER_INACTIVE]: {
    title: "This offer is no longer available",
    message: "The farmer stopped selling it while you were ordering. Nothing was charged.",
  },
  [FARMER_CORE_ERROR__OFFER_EXPIRED]: {
    title: "This offer has expired",
    message: "It can't be ordered any more. Nothing was charged.",
  },
  [FARMER_CORE_ERROR__INSUFFICIENT_STOCK]: {
    title: "Not enough stock",
    message: "Another order reserved it while you were choosing. Reduce the quantity or pick another offer.",
  },
  [FARMER_CORE_ERROR__INVALID_QUANTITY]: { title: "Check the quantity", message: "The quantity must be more than zero." },
  [FARMER_CORE_ERROR__INVALID_PRICE]: { title: "Check the price", message: "The price must be more than zero." },
  [FARMER_CORE_ERROR__INVALID_EXPIRY]: { title: "Check the expiry date", message: "The expiry date must be in the future." },
  [FARMER_CORE_ERROR__NAME_TOO_LONG]: { title: "A name is too long", message: "Shorten it to 100 bytes or fewer and try again." },
  [FARMER_CORE_ERROR__NOTES_TOO_LONG]: { title: "The notes are too long", message: "Shorten them to 500 bytes or fewer." },
  [FARMER_CORE_ERROR__URI_TOO_LONG]: { title: "The link is too long", message: "Use a link of 200 bytes or fewer." },
  [FARMER_CORE_ERROR__MINT_NOT_ALLOWED]: {
    title: "This token isn't accepted",
    message: "The program only takes payment in the mints its admin allowed. Pick one from the list.",
  },
  [FARMER_CORE_ERROR__MINT_EXTENSION_NOT_ALLOWED]: {
    title: "This token can't be held in escrow",
    message: "It carries a token extension that could strand escrowed funds. Pick another mint.",
  },
  [FARMER_CORE_ERROR__INVALID_ORDER_STATUS]: {
    title: "The order changed",
    message: "It moved on while you were looking at it. Reload the page to see where it stands.",
  },
  [FARMER_CORE_ERROR__ORDER_NOT_EXPIRED]: {
    title: "Not past its deadline yet",
    message: "The order can be closed as expired once its deadline passes.",
  },
  [FARMER_CORE_ERROR__UNAUTHORIZED_OPERATOR]: {
    title: "This wallet doesn't run the warehouse",
    message: "Only the warehouse's operator wallet can do this. The admin may have handed it to another wallet.",
  },
  [FARMER_CORE_ERROR__UNAUTHORIZED_ADMIN]: {
    title: "This wallet doesn't hold the program key",
    message: "Only the program admin can do this. Connect the admin wallet and try again.",
  },
  [FARMER_CORE_ERROR__ALREADY_CONFIRMED]: { title: "Already confirmed", message: "This customer is already in. Reload to see the gate as it is." },
  [FARMER_CORE_ERROR__ALREADY_REVOKED]: { title: "Already turned away", message: "This request was already closed. Reload to see the gate as it is." },
  [FARMER_CORE_ERROR__FEE_BPS_TOO_HIGH]: { title: "The fee is too high", message: "A service fee can be at most 100%." },
  [FARMER_CORE_ERROR__INVALID_ZIP_PREFIX_LEN]: {
    title: "Check the CEP prefixes",
    message: "Each prefix has 3 to 5 digits, like 119 or 11950.",
  },
  [FARMER_CORE_ERROR__TOO_MANY_ZIP_PREFIXES]: { title: "Too many CEP prefixes", message: "A warehouse can list up to 100 prefixes." },
  [FARMER_CORE_ERROR__TOO_MANY_ALLOWED_MINTS]: { title: "Too many mints", message: "The program accepts up to 30 mints." },
};

const GENERIC: Failure = {
  title: "The transaction failed",
  message: "Solana rejected it and nothing moved. Try again in a moment.",
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

/** Explains a transaction error from simulation, a confirmed status or a send failure. */
export function describeFailure(err: unknown, programs: Address[], logs: readonly string[]): Failure {
  if (typeof err === "string") {
    if (err === "InsufficientFundsForFee") return { title: "Not enough SOL", message: "Your wallet needs a little SOL to pay the network fee." };
    if (err === "AccountNotFound") return { title: "Not enough SOL", message: "This wallet has no SOL yet. Add some to pay the network fee and account rent." };
    return GENERIC;
  }
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if ("InsufficientFundsForRent" in e) {
      return { title: "Not enough SOL", message: "Your wallet needs a little more SOL to pay the rent of the new accounts." };
    }
    if (Array.isArray(e.InstructionError)) {
      const [index, detail] = e.InstructionError as [unknown, unknown];
      const program = programs[asNumber(index) ?? -1];
      const custom = detail && typeof detail === "object" ? asNumber((detail as Record<string, unknown>).Custom) : null;
      if (custom != null && (program === undefined || program === FARMER_CORE_PROGRAM_ADDRESS) && custom >= 6000) {
        return (
          PROGRAM_ERRORS[custom as FarmerCoreError] ?? {
            title: GENERIC.title,
            message: `${getFarmerCoreErrorMessage(custom as FarmerCoreError)}. Nothing moved.`,
          }
        );
      }
      if (custom === 1 && (program === TOKEN_PROGRAM_ADDRESS || program === TOKEN_2022_PROGRAM_ADDRESS)) {
        return { title: "Not enough funds", message: "Your token account doesn't hold enough for this. Add funds or reduce the amount." };
      }
      if (custom === 0 && logs.some((l) => l.includes("already in use"))) {
        return { title: "Already done", message: "That account already exists on Solana. Reload the page to see it." };
      }
      if (custom === 1 && logs.some((l) => /insufficient lamports/i.test(l))) {
        return { title: "Not enough SOL", message: "Your wallet needs a little more SOL to pay the account rent and network fee." };
      }
    }
  }
  if (err instanceof Error && err.message) return { title: GENERIC.title, message: err.message };
  return GENERIC;
}

/** The person closed or declined the wallet prompt. */
export function isWalletRejection(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const o = e as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (o.code === 4001 || o.code === "ACTION_REJECTED") return true;
    if (typeof o.name === "string" && /reject/i.test(o.name)) return true;
    if (typeof o.message === "string" && /(user )?(rejected|declined|denied|cancell?ed)/i.test(o.message)) return true;
    e = o.cause;
  }
  return false;
}
