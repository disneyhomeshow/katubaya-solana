import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useDisconnect, type UiWallet } from "@wallet-standard/react";
import { Address, Badge, Button, Icon } from "../design-system";
import { CLUSTER, CLUSTER_LABEL } from "../config";
import { useSession } from "../state/session";
import { useTheme } from "../state/theme";
import { useWallet } from "../wallet/WalletProvider";

export type Area = "onboarding" | "customer" | "farmer";

type NavItem = { to: string; label: string; icon: "leaf" | "package" | "plus" | "wallet"; end?: boolean };

const NAV: Record<Area, NavItem[]> = {
  onboarding: [{ to: "/market", label: "Browse the market", icon: "leaf" }],
  customer: [
    { to: "/market", label: "Market", icon: "leaf" },
    { to: "/orders", label: "My orders", icon: "package" },
  ],
  farmer: [
    { to: "/farmer", label: "My offers", icon: "leaf", end: true },
    { to: "/farmer/publish", label: "Publish offer", icon: "plus" },
    { to: "/farmer/sales", label: "Sales and payouts", icon: "wallet" },
  ],
};

const WALLET_LABEL: Record<Area, string> = {
  onboarding: "New wallet",
  customer: "Customer wallet",
  farmer: "Farmer wallet",
};

function ThemeSwitch() {
  const [theme, toggle] = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button type="button" className="theme-btn" onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
        </svg>
      )}
    </button>
  );
}

function DisconnectButton({ wallet }: { wallet: UiWallet }) {
  const { select } = useWallet();
  const [busy, disconnect] = useDisconnect(wallet);
  return (
    <Button
      size="sm"
      variant="quiet"
      className="hide-phone"
      disabled={busy}
      onClick={async () => {
        try {
          await disconnect();
        } finally {
          select(undefined);
        }
      }}
    >
      Disconnect
    </Button>
  );
}

function WalletArea({ area }: { area: Area }) {
  const { account, wallets } = useWallet();
  if (!account) {
    return (
      <Link to="/connect" className="kb-btn kb-btn-secondary">
        Connect wallet
      </Link>
    );
  }
  const wallet = wallets.find((w) => w.accounts.some((a) => a.address === account.address));
  return (
    <>
      <span className="t-small muted hide-phone">{WALLET_LABEL[area]}</span>
      <div className="wallet-chip">
        <Icon name="wallet" size={18} />
        <Address value={account.address} />
      </div>
      {wallet ? <DisconnectButton wallet={wallet} /> : null}
    </>
  );
}

export function Layout({ area, children }: { area: Area; children: ReactNode }) {
  const { account } = useWallet();
  const { profile } = useSession();
  // The admin and warehouse operators also play the map and the yard; their way back is in the header.
  const games: NavItem[] = [
    ...(profile?.isAdmin ? [{ to: "/admin", label: "Program map", icon: "leaf" as const }] : []),
    ...(profile?.operated.length ? [{ to: "/warehouse", label: "Warehouse yard", icon: "package" as const }] : []),
  ];
  const nav = [...(area === "onboarding" || account ? NAV[area] : NAV.onboarding), ...games];
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-logo" aria-label="katūbayá, home">
          <img className="logo-light" src="/brand/katubaya-lockup.svg" alt="katūbayá" />
          <img className="logo-dark" src="/brand/katubaya-lockup-dark.svg" alt="katūbayá" />
        </Link>
        <nav aria-label="Main" className="app-nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-header-end">
          <span className="hide-phone">
            <Badge tone="muted">{CLUSTER_LABEL[CLUSTER]}</Badge>
          </span>
          <WalletArea area={area} />
          <ThemeSwitch />
        </div>
      </header>
      <main>{children}</main>
      <footer className="app-footer">
        <div className="band" aria-hidden="true" />
        <div className="app-footer-inner">
          <span>katūbayá — market rails for farmer-owned harvests</span>
          <span>Funds move only through escrow · {CLUSTER_LABEL[CLUSTER]}</span>
        </div>
      </footer>
      {nav.length > 1 ? (
        <nav aria-label="Main" className="tabbar">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
