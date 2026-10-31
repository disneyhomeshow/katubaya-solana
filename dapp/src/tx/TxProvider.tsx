import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Instruction, Signature, TransactionSendingSigner } from "@solana/kit";
import { Button, Transaction, type TransactionLine } from "../design-system";
import { explorerUrl } from "../config";
import type { Failure } from "../solana/errors";
import { describeFailure } from "../solana/errors";
import { sendInstructions, TxFailure, TxRejected } from "../solana/transactions";
import { useWallet } from "../wallet/WalletProvider";

export type TxRequest = {
  title: string;
  /** Program instruction shown in mono under the title: "create_order". */
  instruction: string;
  description?: ReactNode;
  lines?: TransactionLine[];
  build: (signer: TransactionSendingSigner) => Promise<Instruction[]>;
  /** Checks that need no wallet (balances, stock); a Failure stops before the wallet opens. */
  preflight?: () => Promise<Failure | null>;
  /** Extra actions next to "Try again" when it fails ("Change quantity"). */
  failedAction?: { label: string; onClick: () => void };
  /** Runs as soon as the transaction is confirmed: refresh what the page shows. */
  onConfirmed?: (signature: Signature) => void | Promise<void>;
  /** Runs when the person closes the confirmed dialog: move on to the next screen. */
  onDone?: (signature: Signature) => void;
  doneLabel?: string;
};

type TxState = "sign" | "sending" | "confirmed" | "failed" | "rejected";

type Running = { request: TxRequest; state: TxState; signature?: Signature; failure?: Failure };

const TxContext = createContext<((request: TxRequest) => void) | null>(null);

export function TxProvider({ children }: { children: ReactNode }) {
  const { signer } = useWallet();
  const [running, setRunning] = useState<Running | null>(null);
  const attempt = useRef(0);

  const start = useCallback(
    async (request: TxRequest) => {
      const id = ++attempt.current;
      const update = (patch: Partial<Running>) =>
        setRunning((r) => (r && id === attempt.current ? { ...r, ...patch } : r));
      setRunning({ request, state: "sign" });
      if (!signer) {
        update({ state: "failed", failure: { title: "No wallet connected", message: "Connect a wallet and try again." } });
        return;
      }
      try {
        const blocked = await request.preflight?.();
        if (blocked) {
          update({ state: "failed", failure: blocked });
          return;
        }
        const instructions = await request.build(signer);
        const signature = await sendInstructions(signer, instructions, {
          onSent: (sig) => update({ state: "sending", signature: sig }),
        });
        update({ state: "confirmed", signature });
        await request.onConfirmed?.(signature);
      } catch (error) {
        if (error instanceof TxRejected) update({ state: "rejected" });
        else if (error instanceof TxFailure) update({ state: "failed", failure: error.failure });
        else update({ state: "failed", failure: describeFailure(error, [], []) });
      }
    },
    [signer],
  );

  const close = useCallback(() => {
    setRunning((r) => {
      if (r?.state === "confirmed" && r.signature) r.request.onDone?.(r.signature);
      return null;
    });
  }, []);

  const run = useCallback((request: TxRequest) => void start(request), [start]);

  return (
    <TxContext.Provider value={run}>
      {children}
      {running ? <TxDialog running={running} onClose={close} onRetry={() => run(running.request)} /> : null}
    </TxContext.Provider>
  );
}

function TxDialog({ running, onClose, onRetry }: { running: Running; onClose: () => void; onRetry: () => void }) {
  const { request, state, signature, failure } = running;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = ref.current?.querySelector<HTMLElement>("[role=dialog]");
    dialog?.setAttribute("tabindex", "-1");
    dialog?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state !== "sending") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  let actions: ReactNode = null;
  if (state === "confirmed") {
    actions = (
      <Button variant="primary" onClick={onClose}>
        {request.doneLabel ?? "Done"}
      </Button>
    );
  } else if (state === "failed") {
    actions = (
      <>
        {request.failedAction ? (
          <Button
            onClick={() => {
              onClose();
              request.failedAction!.onClick();
            }}
          >
            {request.failedAction.label}
          </Button>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  } else if (state === "rejected") {
    actions = (
      <>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  }

  return (
    <div className="kb-scrim" ref={ref} onClick={(e) => e.target === e.currentTarget && state !== "sending" && onClose()}>
      <Transaction
        title={request.title}
        instruction={request.instruction}
        state={state}
        lines={request.lines}
        signature={signature}
        explorerHref={signature ? explorerUrl("tx", signature) : undefined}
        errorTitle={failure?.title}
        error={failure?.message}
        actions={actions}
        onClose={onClose}
      >
        {request.description}
      </Transaction>
    </div>
  );
}

export function useTx(): (request: TxRequest) => void {
  const run = useContext(TxContext);
  if (!run) throw new Error("useTx outside TxProvider");
  return run;
}
