/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_CLUSTER?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_MINT_SYMBOLS?: string;
}

// The Codama client reads process.env.NODE_ENV to pick verbose error messages; vite.config.ts defines it.
declare const process: { env: { NODE_ENV?: string } };
