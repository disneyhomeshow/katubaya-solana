// Rent of the accounts a transaction creates, so the wallet prompt holds no surprise.
import { getOrderSize } from "../generated";
import { rentFor } from "./accounts";

// Account sizes as the program allocates them: 8-byte discriminator + InitSpace (Vec/String at max_len).
export const SIZE = {
  customerProfile: 8 + 32 + 1 + 4 + 200,
  warehouseCustomer: 8 + 32 + 32 + 1 + 9 + 33,
  farmerProfile: 8 + 32 + 32 + 1 + (4 + 100) + (4 + 200),
  lotOffer: 8 + 32 + 32 + 8 + 33 + (4 + 100) + (1 + 4 + 100) + 2 + 9 + (1 + 4 + 500) + 32 + 8 + 8 + 1 + 8,
  order: getOrderSize(),
  warehouse: 8 + 8 + 32 + (4 + 100) + (4 + 500) + 2 + (1 + 4 + 200) + (4 + 100 * 5),
  /** SPL Token account; Token-2022 adds the ImmutableOwner extension. */
  tokenAccount: 165,
  tokenAccount2022: 170,
};

export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  return `${sol.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 5 })} SOL`;
}

export async function rentOf(bytes: number): Promise<bigint> {
  return rentFor(bytes);
}

export const NETWORK_FEE = "≈ 0.000005 SOL";
