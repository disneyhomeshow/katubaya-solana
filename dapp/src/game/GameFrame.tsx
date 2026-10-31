// The frame both games share: the HUD on top, a list on the left, the map in the middle with Broto,
// the zoom controls and the toast, and the selected thing on the right. Both side panels fold away.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDisconnect, type UiWallet } from "@wallet-standard/react";
import { Address, Badge, Button } from "../design-system";
import { CLUSTER, CLUSTER_LABEL } from "../config";
import { useSession } from "../state/session";
import { useTxState } from "../tx/TxProvider";
import { useWallet } from "../wallet/WalletProvider";
import { AVATAR, BROTO } from "./assets";
import type { Broto } from "./feedback";
import type { Stage } from "./useStage";
import "./game.css";

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function HudLogo() {
  return (
    <Link to="/" className="hud-logo" aria-label="katūbayá, home">
      <img src="/brand/katubaya-lockup.svg" alt="katūbayá" />
    </Link>
  );
}

export function NetworkBadge() {
  return <Badge tone="muted">{CLUSTER_LABEL[CLUSTER]}</Badge>;
}

function DisconnectItem({ wallet }: { wallet: UiWallet }) {
  const { select } = useWallet();
  const [busy, disconnect] = useDisconnect(wallet);
  return (
    <button
      type="button"
      className="menu-item"
      disabled={busy}
      onClick={async () => {
        try {
          await disconnect();
        } finally {
          select(undefined);
        }
      }}
    >
      Disconnect wallet
    </button>
  );
}

/** The player's token: name, what they are doing right now, and a menu to the other places they can play. */
export function HudMe({ role, name, idle }: { role: "operator" | "admin"; name: string; idle: string }) {
  const tx = useTxState();
  const signing = tx === "sign" || tx === "sending";
  const { account, wallets } = useWallet();
  const { profile } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const wallet = account && wallets.find((w) => w.accounts.some((a) => a.address === account.address));
  return (
    <div className="hud-end" ref={box}>
      <NetworkBadge />
      <button type="button" className="hud-me" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <span className="hud-me-text">
          <span className="hud-me-name">{name}</span>
          <span className={`hud-me-state${signing ? " signing" : ""}`}>{signing ? "Signing in wallet" : idle}</span>
        </span>
        <span className={`ring${role === "admin" ? " admin" : ""}${signing ? " signing" : ""}`}>
          <img src={AVATAR[role]} alt="" />
        </span>
      </button>
      {open ? (
        <div className="hud-menu" role="menu">
          {account ? <Address value={account.address} /> : null}
          <hr />
          {profile?.isAdmin && role !== "admin" ? <Link to="/admin">The program map</Link> : null}
          {profile?.operated.map((w) => (
            <Link key={w.address} to={`/warehouse/${w.address}`} onClick={() => setOpen(false)}>
              {w.data.name} yard
            </Link>
          ))}
          {profile?.farmer ? <Link to="/farmer">My offers, as a farmer</Link> : null}
          {profile?.confirmed.length ? <Link to="/market">The market, as a customer</Link> : null}
          {wallet ? (
            <>
              <hr />
              <DisconnectItem wallet={wallet} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  variant: "yard" | "map";
  hud: ReactNode;
  left: ReactNode;
  leftLabel: string;
  /** Shown on the folded left tab: how many things wait. */
  leftCount: string;
  right: ReactNode;
  rightOpen: boolean;
  onRightOpen: (open: boolean) => void;
  stage: Stage;
  /** The pieces on the stage, in stage pixels. */
  scene: ReactNode;
  /** Over the whole viewport, above the stage (an empty or loading state). */
  overlay?: ReactNode;
  hint: string;
  broto: Broto;
  toast: { text: string; n: number } | null;
};

export function GameFrame({ variant, hud, left, leftLabel, leftCount, right, rightOpen, onRightOpen, stage, scene, overlay, hint, broto, toast }: Props) {
  const [leftOpen, setLeftOpen] = useState(true);
  const leftTab = leftOpen ? "Hide the left panel" : "Show the left panel";
  const rightTab = rightOpen ? "Hide the details panel" : "Show the details panel";
  return (
    <div className={`kb-game kb-game-${variant === "map" ? "admin" : "yard"}`} data-theme="light">
      <div className="game">
        <header className="hud">{hud}</header>
        <div className="game-body">
          {leftOpen ? (
            <aside className="side-l" aria-label={leftLabel}>
              {left}
            </aside>
          ) : null}
          <div className={`viewport${stage.dragging ? " dragging" : ""}`} ref={stage.viewport} {...stage.handlers}>
            <div className={`stage${stage.dragging ? " nodrag" : ""}`} style={stage.stageStyle}>
              {scene}
            </div>
            {toast ? (
              <div className="toast" role="status" key={toast.n}>
                <CheckIcon size={18} />
                <span>{toast.text}</span>
              </div>
            ) : null}
            <span className="vp-hint">{hint}</span>
            <button type="button" className="vp-tab vp-tab-l" aria-label={leftTab} title={leftTab} onClick={() => setLeftOpen((o) => !o)}>
              <span>{leftOpen ? "‹" : "›"}</span>
              <span>{leftCount}</span>
            </button>
            <button type="button" className="vp-tab vp-tab-r" aria-label={rightTab} title={rightTab} onClick={() => onRightOpen(!rightOpen)}>
              <span>{rightOpen ? "›" : "‹"}</span>
            </button>
            <div className="vp-broto">
              <img src={BROTO[broto.mood]} alt="Broto, the guide" />
              <div key={broto.text} aria-live="polite">
                <b>Broto</b>
                <span>{broto.text}</span>
              </div>
            </div>
            <div className="vp-zoom">
              <Button size="sm" variant="quiet" aria-label="Zoom out" onClick={stage.zoomOut}>
                −
              </Button>
              <span>{stage.zoomLabel}</span>
              <Button size="sm" variant="quiet" aria-label="Zoom in" onClick={stage.zoomIn}>
                +
              </Button>
              <Button size="sm" variant="quiet" onClick={stage.fit}>
                Fit
              </Button>
            </div>
            {overlay}
          </div>
          {rightOpen ? (
            <aside className="side-r" aria-label="Selected">
              {right}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** A stand-in for the whole game while it loads or when the wallet cannot play it. */
export function GameGate({ variant, hud, children }: { variant: "yard" | "map"; hud: ReactNode; children: ReactNode }) {
  return (
    <div className={`kb-game kb-game-${variant === "map" ? "admin" : "yard"}`} data-theme="light">
      <div className="game">
        <header className="hud">{hud}</header>
        <div className="game-body">
          <div className="viewport" style={{ cursor: "default" }}>
            <div className="vp-empty">
              <div>{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
