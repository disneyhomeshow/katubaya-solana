// Design: "Onboarding · Connect a wallet" (OnboardConnect).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConnect, type UiWallet } from "@wallet-standard/react";
import { Layout } from "../../components/Layout";
import { NetworkNotices } from "../../components/States";
import { Notice } from "../../design-system";
import { CHAIN } from "../../config";
import { useWallet } from "../../wallet/WalletProvider";

function WalletButton({ wallet, onError }: { wallet: UiWallet; onError: (message: string) => void }) {
  const { select } = useWallet();
  const navigate = useNavigate();
  const [connecting, connect] = useConnect(wallet);
  return (
    <button
      type="button"
      className="kb-btn kb-btn-secondary kb-btn-lg"
      style={{ justifyContent: "space-between" }}
      disabled={connecting}
      onClick={async () => {
        try {
          const accounts = await connect();
          const account = accounts.find((a) => a.chains.includes(CHAIN)) ?? accounts[0];
          if (!account) return onError(`${wallet.name} didn't share an account. Unlock it and try again.`);
          select(account);
          navigate("/");
        } catch {
          onError(`${wallet.name} didn't connect. Open it, unlock it and try again.`);
        }
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src={wallet.icon} alt="" width={24} height={24} style={{ borderRadius: 6 }} />
        {wallet.name}
      </span>
      <span className="t-small muted" style={{ fontWeight: 400 }}>
        {connecting ? "Connecting…" : "Detected"}
      </span>
    </button>
  );
}

export function Connect() {
  const { wallets } = useWallet();
  const [error, setError] = useState<string | null>(null);
  return (
    <Layout area="onboarding">
      <div className="page page-wide-top">
        <NetworkNotices />
        <div className="split split-wide">
          <section className="split-main stack gap-5" style={{ flexBasis: 520 }}>
            <h1 className="t-display-xl">harvest, routed</h1>
            <p className="t-lead">
              Farmers sell their harvest directly. A warehouse they trust delivers it. Your money waits in escrow until it arrives.
            </p>
            <p className="t-body muted" style={{ maxWidth: 560 }}>
              No rankings, no middlemen setting prices. Every offer, order and payout is a public record on Solana — except your
              address, which only your warehouse ever sees.
            </p>
          </section>
          <section id="wallets" aria-labelledby="connect-title" className="split-side card card-lg stack gap-4" style={{ flexBasis: 380 }}>
            <h2 id="connect-title" className="t-title">
              Connect a wallet
            </h2>
            <p className="t-body muted">
              Your wallet is your account. We show the screens that match what it holds: a farmer profile, a customer profile or a
              warehouse.
            </p>
            {error ? (
              <Notice tone="warning" title="Not connected">
                {error}
              </Notice>
            ) : null}
            {wallets.length ? (
              <div className="stack gap-2">
                {wallets.map((w) => (
                  <WalletButton key={w.name} wallet={w} onError={setError} />
                ))}
              </div>
            ) : (
              <Notice tone="info" title="No Solana wallet found in this browser">
                Install a wallet such as Phantom, Solflare or Backpack, then reload this page.
              </Notice>
            )}
            <span className="t-small muted">
              New to Solana wallets?{" "}
              <a href="https://solana.com/solana-wallets" target="_blank" rel="noreferrer">
                How to set one up
              </a>
            </span>
          </section>
        </div>
        <section aria-labelledby="how-title" className="stack gap-5 rule-top" style={{ paddingTop: 32 }}>
          <h2 id="how-title" className="t-title">
            Three people, one order
          </h2>
          <div className="three-up">
            <div className="stack gap-2">
              <h3 className="t-heading">Farmers</h3>
              <p className="t-body muted">
                Join a warehouse, publish offers with price and stock, and get paid when the order is delivered.
              </p>
            </div>
            <div className="stack gap-2">
              <h3 className="t-heading">Customers</h3>
              <p className="t-body muted">
                Get confirmed by a warehouse once, then order any offer it routes. Pay into escrow; it is released only on delivery.
              </p>
            </div>
            <div className="stack gap-2">
              <h3 className="t-heading">Warehouses</h3>
              <p className="t-body muted">
                Confirm customers off-chain, quote delivery, move the harvest and release the funds. A service fee pays for the work.
              </p>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
