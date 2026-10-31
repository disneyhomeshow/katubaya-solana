import { address, type Address } from "@solana/kit";

export type Cluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";

const env = import.meta.env;

export const CLUSTER: Cluster = (["devnet", "testnet", "mainnet-beta", "localnet"] as const).includes(
  env.VITE_SOLANA_CLUSTER as Cluster,
)
  ? (env.VITE_SOLANA_CLUSTER as Cluster)
  : "devnet";

const DEFAULT_RPC: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  localnet: "http://127.0.0.1:8899",
};

export const RPC_URL: string = env.VITE_RPC_URL || DEFAULT_RPC[CLUSTER];

/** Wallet Standard chain id the wallet signs for. */
export const CHAIN = `solana:${CLUSTER === "mainnet-beta" ? "mainnet" : CLUSTER}` as const;

export const CLUSTER_LABEL: Record<Cluster, string> = {
  devnet: "Solana devnet",
  testnet: "Solana testnet",
  "mainnet-beta": "Solana mainnet",
  localnet: "Solana localnet",
};

export const NETWORK_NAME: Record<Cluster, string> = {
  devnet: "Devnet",
  testnet: "Testnet",
  "mainnet-beta": "Mainnet",
  localnet: "Localnet",
};

export function explorerUrl(kind: "tx" | "address", value: string): string {
  const query =
    CLUSTER === "mainnet-beta"
      ? ""
      : CLUSTER === "localnet"
        ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`
        : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/${kind}/${value}${query}`;
}

function parseSymbols(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

const MINT_SYMBOLS: Record<string, string> = {
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  ...parseSymbols(env.VITE_MINT_SYMBOLS),
};

/** The symbol shown after amounts of this mint; a shortened address when the mint is unknown. */
export function mintSymbol(mint: Address | string): string {
  const key = String(mint);
  return MINT_SYMBOLS[key] ?? `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
