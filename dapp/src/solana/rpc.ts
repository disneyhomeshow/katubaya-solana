import { createSolanaRpc } from "@solana/kit";
import { RPC_URL } from "../config";

export const rpc = createSolanaRpc(RPC_URL);
export type Rpc = typeof rpc;
