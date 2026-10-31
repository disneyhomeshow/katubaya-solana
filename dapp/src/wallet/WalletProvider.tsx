import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { address, type Address, type TransactionSendingSigner } from "@solana/kit";
import {
  SelectedWalletAccountContextProvider,
  useSelectedWalletAccount,
  useWalletAccountTransactionSendingSigner,
} from "@solana/react";
import { getWalletFeature, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { CHAIN, CLUSTER } from "../config";

const STORAGE_KEY = "katubaya-wallet";

const stateSync = {
  getSelectedWallet: () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  storeSelectedWallet: (key: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* private window: the choice lasts this visit */
    }
  },
  deleteSelectedWallet: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing stored */
    }
  },
};

/** Wallets that can connect and sign-and-send Solana transactions. */
function filterWallets(wallet: UiWallet): boolean {
  return (
    wallet.chains.some((c) => c.startsWith("solana:")) &&
    wallet.features.includes("standard:connect") &&
    wallet.features.includes("solana:signAndSendTransaction")
  );
}

export type WalletSession = {
  wallets: UiWallet[];
  account: UiWalletAccount | undefined;
  address: Address | undefined;
  signer: TransactionSendingSigner | null;
  /** False when the connected account does not list this DApp's cluster. */
  onCluster: boolean;
  select: (account: UiWalletAccount | undefined) => void;
};

const SessionContext = createContext<WalletSession | null>(null);

type SessionBase = Omit<WalletSession, "signer">;

function SignerSession({ account, base, children }: { account: UiWalletAccount; base: SessionBase; children: ReactNode }) {
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const value = useMemo(() => ({ ...base, signer }), [base, signer]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<unknown> };

/**
 * After a reload the wallet lists no accounts until asked, so the saved wallet is asked again,
 * silently (no prompt). Until it answers, or 2.5 s pass, the app waits instead of showing "Connect".
 */
function useSilentReconnect(wallets: UiWallet[], account: UiWalletAccount | undefined): boolean {
  const [restoring, setRestoring] = useState(() => !!stateSync.getSelectedWallet());
  const attempted = useRef(false);
  useEffect(() => {
    if (!restoring) return;
    const timer = setTimeout(() => setRestoring(false), 2500);
    return () => clearTimeout(timer);
  }, [restoring]);
  useEffect(() => {
    if (!restoring) return;
    if (account) {
      setRestoring(false);
      return;
    }
    const name = stateSync.getSelectedWallet()?.split(":")[0];
    const wallet = wallets.find((w) => w.name.replace(":", "_") === name);
    if (!wallet || attempted.current) return;
    attempted.current = true;
    // Next tick: this effect runs before useWallets (in a parent) subscribes to the wallet's
    // change event, and a wallet answering synchronously would otherwise go unheard.
    setTimeout(() => {
      try {
        const feature = getWalletFeature(wallet, "standard:connect") as ConnectFeature;
        void feature
          .connect({ silent: true })
          .catch(() => undefined)
          .finally(() => setTimeout(() => setRestoring(false), 300));
      } catch {
        setRestoring(false);
      }
    }, 0);
  }, [restoring, account, wallets]);
  return restoring;
}

function Session({ children }: { children: ReactNode }) {
  const [account, setAccount, wallets] = useSelectedWalletAccount();
  const restoring = useSilentReconnect(wallets, account);
  const base = useMemo<SessionBase>(
    () => ({
      wallets,
      account,
      address: account ? address(account.address) : undefined,
      // Wallets rarely list localnet, so only a public cluster is checked.
      onCluster: !account || CLUSTER === "localnet" || account.chains.includes(CHAIN),
      select: (next: UiWalletAccount | undefined) => setAccount(next),
    }),
    [wallets, account, setAccount],
  );
  if (restoring) {
    return (
      <div className="app">
        <div className="page loading" role="status">
          <span className="kb-spinner" aria-hidden="true" />
          Reconnecting your wallet…
        </div>
      </div>
    );
  }
  if (account)
    return (
      <SignerSession key={account.address} account={account} base={base}>
        {children}
      </SignerSession>
    );
  return <SessionContext.Provider value={{ ...base, signer: null }}>{children}</SessionContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <SelectedWalletAccountContextProvider filterWallets={filterWallets} stateSync={stateSync}>
      <Session>{children}</Session>
    </SelectedWalletAccountContextProvider>
  );
}

export function useWallet(): WalletSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useWallet outside WalletProvider");
  return session;
}
