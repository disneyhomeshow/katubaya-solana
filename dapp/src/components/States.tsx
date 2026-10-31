// The states every screen handles (design: "System · Errors and blocked states").
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, Notice } from "../design-system";
import { CLUSTER, NETWORK_NAME } from "../config";
import { useSession } from "../state/session";
import { useWallet } from "../wallet/WalletProvider";

export function Loading({ label = "Reading from Solana…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="kb-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return (
    <Notice
      tone="danger"
      title="Couldn't read from Solana"
      action={onRetry ? <Button size="sm" onClick={onRetry}>Check again</Button> : undefined}
    >
      The network didn't answer. Check your connection and try again.{detail ? ` (${detail})` : ""}
    </Notice>
  );
}

/** Shown on every screen, before any action: wrong cluster, program missing, market paused. */
export function NetworkNotices({ showPaused = false }: { showPaused?: boolean }) {
  const { onCluster } = useWallet();
  const { profile, loading, reload } = useSession();
  const notices: ReactNode[] = [];
  if (!onCluster) {
    notices.push(
      <Notice key="net" tone="danger" title={`Your wallet doesn't offer ${NETWORK_NAME[CLUSTER]}`} action={<Button size="sm" onClick={() => void reload()}>Check again</Button>}>
        Katūbayá runs on Solana {NETWORK_NAME[CLUSTER].toLowerCase()} for now. Switch your wallet to {NETWORK_NAME[CLUSTER]} to continue.
      </Notice>,
    );
  }
  if (!loading && profile && !profile.config) {
    notices.push(
      <Notice key="config" tone="danger" title={`Katūbayá isn't set up on ${NETWORK_NAME[CLUSTER]} yet`}>
        The program has no configuration account on this network, so nothing can be read or ordered here. Check the RPC endpoint the DApp uses.
      </Notice>,
    );
  }
  if (showPaused && profile?.config?.data.paused) {
    notices.push(
      <Notice key="paused" tone="danger" title="New orders are paused">
        The program admin has paused the market. Orders already in escrow keep their funds and continue.
      </Notice>,
    );
  }
  return notices.length ? <>{notices}</> : null;
}

export function ConnectFirst({ title, children }: { title: string; children: ReactNode }) {
  return (
    <EmptyState
      icon="wallet"
      title={title}
      action={
        <Link to="/connect" className="kb-btn kb-btn-secondary">
          Connect wallet
        </Link>
      }
    >
      {children}
    </EmptyState>
  );
}
