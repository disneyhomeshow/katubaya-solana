// Design: "Play · operator · the yard" (Katūbayá gamificado, Round 2). The warehouse operator runs the
// yard: the gate (confirm_customer, set_farmer_warehouse), the docks (quote_delivery_fee,
// mark_in_transit, refuse_delivery), the counter for pickups and the road (complete_order), with the
// escrow vault in the corner. Every piece mirrors an account on Solana; the forklift, the trucks
// driving off and Broto's lines are the map's way of showing what a transaction just did.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Address as Addr } from "@solana/kit";
import { Address, Amount, Badge, Button, Field, Lifecycle, Notice, OrderStatus as Status, formatMinor } from "../../design-system";
import { OrderStatus } from "../../generated";
import { mintSymbol } from "../../config";
import { CRATE, FORKLIFT, YARD, YARD_BG, forkliftSrc, type Mood, type YardSprite } from "../../game/assets";
import { useFeedback, logTime, usePoll } from "../../game/feedback";
import { CheckIcon, GameFrame, GameGate, HudLogo, HudMe, NetworkBadge } from "../../game/GameFrame";
import { useStage } from "../../game/useStage";
import { LoadError, Loading } from "../../components/States";
import { isPastDeadline, isPreTransit } from "../../components/orders";
import { describeFailure } from "../../solana/errors";
import { formatDayTime, formatFeeBps, formatTime, nowSeconds } from "../../solana/format";
import { parseDecimal } from "../../solana/units";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useTx, useTxState } from "../../tx/TxProvider";
import { useWallet } from "../../wallet/WalletProvider";
import { useForklift, type Occupancy } from "./forklift";
import {
  acceptFarmerTx,
  completeTx,
  confirmCustomerTx,
  expireTx,
  quoteTx,
  refuseTx,
  sendOutTx,
  turnAwayTx,
  type YardTx,
} from "./yardTx";
import {
  AT_DOCK,
  DOCKS,
  YARD_BOX,
  YARD_H,
  YARD_W,
  addMoney,
  bayX,
  loadYard,
  moneyText,
  place,
  proj,
  tail,
  type GateCustomer,
  type GateFarmer,
  type Totals,
  type Visitor,
  type YardData,
  type YardOrder,
} from "./yardModel";

// ---- Gate: the wallet must operate the warehouse it opens

export function WarehouseYard() {
  const { warehouse: param } = useParams();
  const { wallet, profile, loading, error, reload } = useSession();
  const hud = (
    <>
      <HudLogo />
      <span style={{ marginLeft: "auto" }}>
        <NetworkBadge />
      </span>
    </>
  );
  if (!wallet) {
    return (
      <GameGate variant="yard" hud={hud}>
        <h2 className="h-panel">Connect the operator wallet</h2>
        <p className="muted">The yard opens for the wallet that runs a warehouse. Katūbayá never holds your keys.</p>
        <div>
          <Link to="/connect" className="kb-btn kb-btn-primary">
            Connect wallet
          </Link>
        </div>
      </GameGate>
    );
  }
  if (loading || !profile) {
    return (
      <GameGate variant="yard" hud={hud}>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Reading the yard from Solana…" />}
      </GameGate>
    );
  }
  const target = param ? profile.operated.find((w) => w.address === param) : profile.operated[0];
  if (!target) {
    return (
      <GameGate variant="yard" hud={hud}>
        <h2 className="h-panel">This wallet doesn't run {param ? "this" : "a"} warehouse</h2>
        <p className="muted">
          The program admin names each warehouse's operator. Ask them to hand you the keys, or connect the operator wallet.
        </p>
        <div className="actions">
          <Link to="/" className="kb-btn kb-btn-secondary">
            Go to my screens
          </Link>
        </div>
      </GameGate>
    );
  }
  return <Yard key={target.address} address={target.address} />;
}

// ---- The yard

type Phase = "hold" | "arriving" | "pullout" | "road1" | "road2";
type Anim = { phase: Phase; bay: number; order: YardOrder };
type Walker = Visitor & { to: [number, number] };

const QUEUE: [number, number][] = [
  [-4.7, 1.05],
  [-4.7, 1.5],
  [-4.7, 1.95],
];
const FARMER_AT: [number, number] = [-4.65, 2.45];
const INSIDE_CUSTOMER: [number, number] = [-3.2, 1.45];
const INSIDE_FARMER: [number, number] = [-3.3, 1.1];
const OUTSIDE: [number, number] = [-5.6, 1.6];
const DOCK_COLOR = { ask: "#d79a2b", wait: "#857c66", go: "#2d5a28" };
const SELECTED_GLOW = " drop-shadow(0 0 7px rgba(45, 90, 40, 0.95))";
const TERMINAL = new Set([OrderStatus.Fulfilled, OrderStatus.Refused, OrderStatus.Canceled, OrderStatus.Expired]);

function useNow(ms: number) {
  const [now, setNow] = useState(nowSeconds());
  useEffect(() => {
    const t = setInterval(() => setNow(nowSeconds()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function dueLabel(at: bigint): string {
  const d = new Date(Number(at) * 1000);
  return d.toDateString() === new Date().toDateString() ? formatTime(at) : formatDayTime(at);
}

function Money({ totals, escrow, empty }: { totals: Totals; escrow?: boolean; empty: { decimals: number; symbol: string } }) {
  if (!totals.size) return <Amount minor={0} decimals={empty.decimals} symbol={empty.symbol} escrow={escrow} />;
  return (
    <>
      {[...totals.entries()].map(([mint, m]) => (
        <Amount key={mint} minor={m.minor} decimals={m.decimals} symbol={m.symbol} escrow={escrow} />
      ))}
    </>
  );
}

function Yard({ address }: { address: Addr }) {
  const navigate = useNavigate();
  const { profile } = useSession();
  const { address: wallet } = useWallet();
  const data = useAsync(() => loadYard(address), [address]);
  usePoll(data.reload, 6000);
  const fb = useFeedback({ mood: "talk", text: "Reading the yard from Solana…" });
  const run = useTx();
  const txState = useTxState();
  const txRef = useRef(txState);
  txRef.current = txState;
  const stage = useStage({ W: YARD_W, H: YARD_H, box: YARD_BOX, pad: 8 });
  const now = useNow(20000);

  const [sel, setSel] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, [boolean, boolean]>>({});
  const [vaultOpen, setVaultOpen] = useState(false);
  const [anim, setAnim] = useState<Record<string, Anim>>({});
  const [walkers, setWalkers] = useState<Record<string, Walker>>({});
  const [counterGone, setCounterGone] = useState<YardOrder | null>(null);
  const [, setTick] = useState(0);
  const own = useRef(new Set<string>());

  const d: YardData | undefined = data.data;
  const name = d?.warehouse.data.name ?? "The warehouse";

  // ---- Docks: a delivery order parks at a free dock and keeps it until it leaves
  const bays = useRef(new Map<string, number>());
  const seen = useRef<Set<string> | null>(null);
  const arriving = useRef(new Set<string>());
  const docks = useMemo(() => {
    const map = bays.current;
    const orders = d?.orders ?? [];
    const waiting = orders
      .filter((o) => o.delivery && AT_DOCK.has(o.status) && !anim[o.address])
      .sort((a, b) => Number(a.createdAt - b.createdAt));
    const keep = new Set([...waiting.map((o) => o.address as string), ...Object.keys(anim)]);
    for (const k of [...map.keys()]) if (!keep.has(k)) map.delete(k);
    for (const [k, a] of Object.entries(anim)) if (a.bay >= 0) map.set(k, a.bay);
    const queue: YardOrder[] = [];
    for (const o of waiting) {
      if (map.has(o.address)) continue;
      const used = new Set(map.values());
      const free = [0, 1, 2, 3].find((i) => !used.has(i));
      if (free === undefined) queue.push(o);
      else map.set(o.address, free);
    }
    // A truck that shows up after the first read drives in from the road.
    if (d) {
      if (seen.current) for (const o of waiting) if (!seen.current.has(o.address) && map.has(o.address)) arriving.current.add(o.address);
      seen.current = new Set(orders.map((o) => o.address));
    }
    return { bayOf: new Map(map), queue };
  }, [d, anim]);
  useEffect(() => {
    if (!arriving.current.size) return;
    const t = setTimeout(() => {
      arriving.current.clear();
      setTick((n) => n + 1);
    }, 60);
    return () => clearTimeout(t);
  });

  // ---- What changed on Solana since the last read, said by Broto and the toast
  const prev = useRef<{ status: Map<string, OrderStatus>; gate: Set<string> } | null>(null);
  useEffect(() => {
    if (!d) return;
    const status = new Map(d.orders.map((o) => [o.address as string, o.status]));
    const gate = new Set([...d.customers, ...d.farmers].map((v) => v.key));
    const before = prev.current;
    prev.current = { status, gate };
    if (!before) {
      fb.say(...openingLine(d, now));
      return;
    }
    const arrived = d.orders
      .filter((o) => !before.status.has(o.address) && !TERMINAL.has(o.status) && !own.current.has(o.address))
      .sort((a, b) => Number(a.createdAt - b.createdAt));
    if (arrived.length > 1) {
      const quote = arrived.find((o) => o.status === OrderStatus.PendingDeliveryQuote);
      fb.showToast(`${arrived.length} new orders · ${arrived.map((o) => `#${o.id}`).join(", ")}`);
      fb.say("talk", `${count(arrived.length, "order", "orders")} came in.${quote ? ` The first quote, for #${quote.id}, is due by ${dueLabel(quote.expiresAt)}.` : ""}`);
    } else if (arrived.length === 1) {
      const o = arrived[0];
      if (o.delivery) {
        const bay = docks.bayOf.get(o.address);
        fb.showToast(`New order #${o.id} · ${bay !== undefined ? `parked at Dock ${bay + 1}` : "waiting for a free dock"}`);
        fb.say("talk", `A new delivery order drove in: #${o.id}${bay !== undefined ? ` parked at Dock ${bay + 1}` : ""}. It needs a quote by ${dueLabel(o.expiresAt)}.`);
      } else {
        fb.showToast(`New pickup order #${o.id} · at the counter`);
        fb.say("talk", `#${o.id} is a pickup order. Hand it over at the counter when the customer comes.`);
      }
    }
    for (const o of d.orders) {
      if (own.current.has(o.address)) continue;
      const was = before.status.get(o.address);
      if (was === undefined) continue;
      if (was === OrderStatus.DeliveryQuoted && o.status === OrderStatus.EscrowedReady) {
        fb.showToast(`#${o.id} · fee accepted into escrow`);
        fb.addLog(`Customer accepted #${o.id}’s fee into escrow`);
        fb.say("talk", `The customer accepted the ${money(o.fee, o)} fee. #${o.id} is ready to send out.`);
      } else if (was !== undefined && was !== o.status && (o.status === OrderStatus.Canceled || o.status === OrderStatus.Expired)) {
        const bay = bays.current.get(o.address) ?? docks.bayOf.get(o.address);
        if (o.delivery && bay !== undefined && AT_DOCK.has(was)) leave({ ...o, status: was }, bay);
        const why = o.status === OrderStatus.Canceled ? "the customer rejected the fee" : "it passed its deadline";
        fb.showToast(`#${o.id} closed · ${why}`);
        fb.addLog(`#${o.id} closed, ${money(o.sub + (was === OrderStatus.EscrowedReady ? o.fee : 0n), o)} refunded`);
        fb.say("idle", `#${o.id} closed because ${why}. The customer got their money back${bay !== undefined ? ` and Dock ${bay + 1} is free again` : ""}.`);
      }
    }
    const fresh = [...d.customers, ...d.farmers].filter((v) => !before.gate.has(v.key) && !own.current.has(v.key));
    if (fresh.length) {
      const first = fresh[0];
      fb.showToast(first.kind === "farmer" ? `${first.name} asked to join` : `A customer asked to join · ${tail(first.wallet)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  // ---- Map animations driven by transactions
  // A truck pulls out of its dock, turns onto the road and drives off: 2.4 s, then it is gone.
  function leave(o: YardOrder, bay: number) {
    setAnim((a) => ({ ...a, [o.address]: { phase: "pullout", bay, order: o } }));
    const step = (phase: Phase | null) => () =>
      setAnim((a) => {
        const cur = a[o.address];
        if (!cur) return a;
        if (!phase) {
          const { [o.address]: _, ...rest } = a;
          return rest;
        }
        return { ...a, [o.address]: { ...cur, phase } };
      });
    fb.later(900, step("road1"));
    fb.later(1400, step("road2"));
    fb.later(2400, step(null));
  }

  // The forklift reads the docks through refs: its loop outlives every render.
  const occupancy = useRef<Occupancy>({});
  const fork = useForklift(
    () => occupancy.current,
    () => txRef.current === "sign" || txRef.current === "sending",
  );

  const pick = (key: string | null) => () => {
    if (stage.wasDrag()) return;
    setSel(key);
    setRightOpen(true);
  };

  // ---- Transactions
  const act = async (
    make: () => YardTx | Promise<YardTx>,
    o: {
      before: string;
      keys?: string[];
      onStart?: () => void;
      onConfirmed: () => void;
      onStopped?: () => void;
    },
  ) => {
    let tx: YardTx;
    try {
      tx = await make();
    } catch (e) {
      fb.say("alert", describeFailure(e, [], []).message);
      return;
    }
    o.keys?.forEach((k) => own.current.add(k));
    fb.say("talk", o.before);
    o.onStart?.();
    run({
      ...tx,
      game: true,
      doneLabel: "Back to the yard",
      onConfirmed: async () => {
        fb.showToast(`Confirmed on Solana · ${tx.title}`);
        o.onConfirmed();
        await data.reload();
      },
      onRejected: () => {
        o.onStopped?.();
        fb.say("idle", "Nothing was sent. The yard is as you left it.");
      },
      onFailed: (f) => {
        o.onStopped?.();
        fb.say("alert", `${f.title}. ${f.message}`);
      },
    });
  };

  const ctx = d ? { warehouse: d.warehouse, config: d.config } : null;

  const confirmCustomer = (c: GateCustomer) =>
    ctx &&
    act(() => confirmCustomerTx(ctx, c), {
      before: "Confirming only links their wallet to the warehouse. Their address stays in your records.",
      keys: [c.key],
      onConfirmed: () => {
        setWalkers((w) => ({ ...w, [c.key]: { ...c, to: INSIDE_CUSTOMER } }));
        fb.later(1200, () => setWalkers(({ [c.key]: _, ...w }) => w));
        setSel("gate");
        fb.addLog(`Customer ${tail(c.wallet)} confirmed`);
        fb.say("celebrate", `Customer ${tail(c.wallet)} is in. They can order through ${name} now.`);
        fb.flash(`Customer ${tail(c.wallet)} welcomed`);
      },
    });

  const turnAway = (c: GateCustomer) =>
    ctx &&
    act(() => turnAwayTx(ctx, c), {
      before: "Turning someone away closes their request. They can ask another warehouse.",
      keys: [c.key],
      onConfirmed: () => {
        setWalkers((w) => ({ ...w, [c.key]: { ...c, to: OUTSIDE } }));
        fb.later(1200, () => setWalkers(({ [c.key]: _, ...w }) => w));
        setSel("gate");
        fb.addLog(`Customer ${tail(c.wallet)} turned away`);
        fb.say("idle", `The request from ${tail(c.wallet)} is closed.`);
      },
    });

  const acceptFarmer = (f: GateFarmer) =>
    ctx &&
    act(() => acceptFarmerTx(ctx, f), {
      before: "Accepting a farmer lets them publish lots here. Talk to them first; nothing is rushed.",
      keys: [f.key],
      onConfirmed: () => {
        setWalkers((w) => ({ ...w, [f.key]: { ...f, to: INSIDE_FARMER } }));
        fb.later(1200, () => setWalkers(({ [f.key]: _, ...w }) => w));
        setSel("gate");
        fb.addLog(`${f.name} joined ${name}`);
        fb.say("celebrate", `${f.name} joined the yard. Their first lots will land in storage.`);
        fb.flash(`${f.name} accepted`);
      },
    });

  const sendQuote = (o: YardOrder) => {
    const fee = parseDecimal(quotes[o.address] ?? "", o.decimals);
    if (!fee || fee <= 0n) {
      fb.say("alert", "Type a delivery fee above zero first.");
      return;
    }
    if (!ctx) return;
    void act(() => quoteTx(ctx, o, fee), {
      before: "Quoting sets the price of the road. The customer decides; you only wait.",
      keys: [o.address],
      onConfirmed: () => {
        own.current.delete(o.address);
        fb.addLog(`Quoted ${money(fee, o)} for #${o.id}`);
        fb.say("idle", "Quote sent. I’ll tell you when the customer answers.");
        fb.flash(`Quote sent for #${o.id}`);
      },
    });
  };

  const sendOut = (o: YardOrder) => {
    if (!ctx) return;
    const bay = docks.bayOf.get(o.address);
    const truck = o.delivery && bay !== undefined;
    void act(() => sendOutTx(ctx, o), {
      before: o.delivery ? "Sending out locks the order’s route. The money stays in the vault until delivery." : "Handing over locks the order. The money stays in the vault until you complete it.",
      keys: [o.address],
      onStart: () => truck && fork.stage(bay, o.id),
      onStopped: () => fork.cancel(),
      onConfirmed: () => {
        setSel(null);
        fb.addLog(`#${o.id} ${o.delivery ? "left the yard" : "handed over at the counter"}`);
        fb.flash(o.delivery ? `#${o.id} sent out` : `#${o.id} handed over`);
        if (!truck) {
          fb.say("talk", o.delivery ? `#${o.id} is on the road. Complete it when the customer has it.` : `#${o.id} is with the customer. Confirm the handover to release the escrow.`);
          return;
        }
        setAnim((a) => ({ ...a, [o.address]: { phase: "hold", bay, order: o } }));
        fb.say("talk", `The forklift is loading #${o.id}. It leaves as soon as the last crate is on.`);
        fork.load(bay, o.id, () => {
          fb.say("talk", `#${o.id} is loaded and on the road. Complete it when the customer has it.`);
          leave({ ...o, status: OrderStatus.InTransit, code: "IN_TRANSIT" }, bay);
        });
      },
    });
  };

  const complete = (o: YardOrder) => {
    if (!ctx || !wallet) return;
    void act(() => completeTx(ctx, o, wallet), {
      before: "Only complete when the customer has the order in hand. The vault opens once.",
      keys: [o.address],
      onConfirmed: () => {
        setVaultOpen(true);
        fb.later(2600, () => setVaultOpen(false));
        if (!o.delivery) {
          setCounterGone(o);
          fb.later(1100, () => setCounterGone(null));
        }
        setSel(null);
        fb.addLog(`#${o.id} fulfilled · ${money(o.held, o)} released`);
        fb.say("celebrate", `#${o.id} delivered. ${money(o.sub - o.service, o)} went to ${o.farmer}.`);
        fb.flash(`#${o.id} fulfilled`);
      },
    });
  };

  const refuse = (o: YardOrder) => {
    if (!ctx) return;
    const bay = docks.bayOf.get(o.address);
    void act(() => refuseTx(ctx, o), {
      before: "Refusing can’t be undone. The customer gets every coin back.",
      keys: [o.address],
      onConfirmed: () => {
        if (bay !== undefined) leave(o, bay);
        setSel(null);
        fb.addLog(`#${o.id} refused · ${money(o.held, o)} refunded`);
        fb.say("idle", `#${o.id} was refused and the customer was refunded.${bay !== undefined ? " Its dock is free again." : ""}`);
        fb.flash(`#${o.id} refused, refunded`);
      },
    });
  };

  const expire = (o: YardOrder) => {
    const bay = docks.bayOf.get(o.address);
    void act(() => expireTx(o), {
      before: "Closing an expired order sends the customer’s money back. Anyone may do it once the deadline passes.",
      keys: [o.address],
      onConfirmed: () => {
        if (o.delivery && bay !== undefined) leave(o, bay);
        if (!o.delivery) {
          setCounterGone(o);
          fb.later(1100, () => setCounterGone(null));
        }
        setSel(null);
        fb.addLog(`#${o.id} expired · ${money(o.held, o)} refunded`);
        fb.say("idle", `#${o.id} is closed and the customer was refunded.`);
        fb.flash(`#${o.id} closed`);
      },
    });
  };

  // ---- Not read yet
  const meName = `${name} operator`;
  const operated = profile?.operated ?? [];
  const hudChip = (extra: ReactNode) => (
    <div className="hud-chip">
      {operated.length > 1 ? (
        <select aria-label="Warehouse" value={address} onChange={(e) => navigate(`/warehouse/${e.target.value}`)}>
          {operated.map((w) => (
            <option key={w.address} value={w.address}>
              {w.data.name}
            </option>
          ))}
        </select>
      ) : (
        <span style={{ fontWeight: 500 }}>{name}</span>
      )}
      {extra}
    </div>
  );
  if (!d) {
    return (
      <GameGate
        variant="yard"
        hud={
          <>
            <HudLogo />
            {hudChip(null)}
            <HudMe role="operator" name={meName} idle="Acting" />
          </>
        }
      >
        {data.error ? <LoadError error={data.error} onRetry={data.reload} /> : <Loading label="Reading the yard from Solana…" />}
      </GameGate>
    );
  }

  // ---- The model of this render
  const live = d.orders.filter((o) => !TERMINAL.has(o.status));
  const firstMint = d.config?.data.allowedMints[0];
  const emptyMoney = { decimals: live[0]?.decimals ?? 6, symbol: live[0]?.symbol ?? (firstMint ? mintSymbol(firstMint) : "") };
  const held: Totals = new Map();
  const released: Totals = new Map();
  for (const o of d.orders) {
    if (o.held) addMoney(held, o.view.account.data.mint, o.held, o.decimals);
    if (o.status === OrderStatus.Fulfilled) addMoney(released, o.view.account.data.mint, o.sub + o.fee, o.decimals);
  }
  const pickups = live.filter((o) => !o.delivery).sort((a, b) => Number(a.createdAt - b.createdAt));
  const counter = counterGone ?? pickups[0] ?? null;
  const road = live.filter((o) => o.delivery && o.status === OrderStatus.InTransit && !anim[o.address]);
  const atBay = new Map<number, YardOrder>();
  for (const o of live) {
    const b = docks.bayOf.get(o.address);
    if (b !== undefined && o.delivery && AT_DOCK.has(o.status) && !anim[o.address]) atBay.set(b, o);
  }
  for (const a of Object.values(anim)) if (a.phase === "hold" || a.phase === "pullout" || a.phase === "arriving") atBay.set(a.bay, a.order);
  const occ: Occupancy = {};
  for (const [b, o] of atBay) occ[b] = anim[o.address]?.phase === "pullout" || arriving.current.has(o.address) ? "moving" : "parked";
  occupancy.current = occ;
  const expired = (o: YardOrder) => isPastDeadline(o.view.account.data, now);

  // ---- Pieces on the yard
  const units: ReactNode[] = [];
  const unit = (key: string, k: YardSprite, x: number, z: number, label: string, onPick: (() => void) | null, opts: { selKey?: string; gone?: boolean; cls?: string; src?: string } = {}) => {
    const p = place(k, x, z);
    const style: CSSProperties = { left: p.left, top: p.top, width: p.width, zIndex: p.zIndex };
    if (opts.selKey && opts.selKey === sel) style.filter = SELECTED_GLOW;
    units.push(
      <button
        type="button"
        key={key}
        className={`unit${onPick ? "" : " deco"}${opts.gone ? " gone" : ""}${opts.cls ? ` ${opts.cls}` : ""}`}
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
        tabIndex={onPick && !opts.gone ? 0 : -1}
        onClick={onPick ?? undefined}
        style={style}
      >
        <img src={opts.src ?? YARD[k].src} alt="" />
      </button>,
    );
  };

  if (counter) {
    const gone = counter === counterGone;
    const hand: [number, number] = counter.status === OrderStatus.InTransit ? [-2.25, 2.95] : [-2.75, 2.92];
    unit(`cust-${counter.address}`, "customer", -2.05, 3.05, `Customer waiting at the counter for #${counter.id}`, pick(`o:${counter.address}`), { selKey: `o:${counter.address}`, gone });
    unit(`porter-${counter.address}`, "porter", hand[0], hand[1], `Porter with order #${counter.id}`, pick(`o:${counter.address}`), { selKey: `o:${counter.address}`, gone });
  }
  unit("counter", "counter", -2.75, 2.35, "Pickup counter", pick(pickups.length === 1 ? `o:${pickups[0].address}` : "counter"), { selKey: "counter" });
  unit("gate", "gate", -3.95, 1.45, "The gate", pick("gate"), { selKey: "gate" });
  (
    [
      ["treeRound", 4.7, 3.0],
      ["treeBanana", 1.9, 3.15],
      ["treeBanana", -4.7, 3.05],
    ] as const
  ).forEach(([k, x, z], i) => unit(`tree-${i}`, k, x, z, "", null));

  const F = fork.fork;
  const fs = FORKLIFT[F.head];
  const fm = F.loaded ? fs.loaded : fs.empty;
  const fp = proj(F.x, 0, F.z);
  units.push(
    <button
      type="button"
      key="fork"
      className={`unit fork${F.moving ? " moving" : ""}${F.lift ? " lift" : ""}`}
      aria-label={F.loaded ? "Forklift carrying a crate" : "Forklift"}
      onClick={pick(null)}
      style={
        {
          left: fp[0] - fm[2] * 0.4,
          top: fp[1] - fm[3] * 0.4,
          width: fm[0] * 0.4,
          zIndex: Math.round(fp[1] + 10),
          transitionDuration: `${F.dur}ms, ${F.dur}ms, 700ms, 200ms`,
          "--bx": fs.bx,
          "--by": fs.by,
          "--ex": fs.ex,
          "--ey": fs.ey,
        } as CSSProperties
      }
    >
      <img src={forkliftSrc(F.head, F.loaded)} alt="" />
    </button>,
  );
  unit("vault", vaultOpen ? "vaultOpen" : "vault", 2.35, -0.55, "Escrow vault", pick("vault"), { selKey: "vault", cls: vaultOpen ? "bounce" : "" });
  unit("me", "operator", -1.1, 2.75, `You, the ${name} operator`, pick(null));

  // gate visitors: up to three customers in line and one farmer; the others wait in the gate's list
  const walking = new Set(Object.keys(walkers));
  d.customers
    .filter((c) => !walking.has(c.key))
    .slice(0, QUEUE.length)
    .forEach((c, i) => unit(c.key, "customer", QUEUE[i][0], QUEUE[i][1], `Customer at the gate, wallet ending ${c.wallet.slice(-4)}`, pick(`cust:${c.key}`), { selKey: `cust:${c.key}` }));
  const farmerHere = d.farmers.find((f) => !walking.has(f.key));
  if (farmerHere) unit(farmerHere.key, "farmer", FARMER_AT[0], FARMER_AT[1], `${farmerHere.name}, a farmer asking to join`, pick(`farmer:${farmerHere.key}`), { selKey: `farmer:${farmerHere.key}` });
  for (const w of Object.values(walkers)) unit(w.key, w.kind, w.to[0], w.to[1], "", null, { gone: true });

  // trucks at the docks, pulling out and on the road out
  const trucks: { o: YardOrder; bay: number; phase: Phase | "bay" }[] = [];
  for (const [bay, o] of atBay) if (!anim[o.address]) trucks.push({ o, bay, phase: arriving.current.has(o.address) ? "arriving" : "bay" });
  for (const a of Object.values(anim)) trucks.push({ o: a.order, bay: a.bay, phase: a.phase });
  for (const t of trucks) {
    const bx = bayX(t.bay);
    let k: YardSprite = "truckBay";
    let x = bx;
    let z = 0.62;
    let gone = false;
    if (t.phase === "arriving") {
      z = 3.4;
      gone = true;
    } else if (t.phase === "pullout") z = 1.45;
    else if (t.phase === "road1") {
      k = "truckRoad";
      x = 2.9;
      z = 1.95;
    } else if (t.phase === "road2") {
      k = "truckRoad";
      x = 5.7;
      z = 1.95;
      gone = true;
    }
    const dn = t.phase === "bay" || t.phase === "hold" || t.phase === "pullout" ? (fork.dips[t.bay] ?? 0) : 0;
    unit(`truck-${t.o.address}`, k, x, z, `Truck for order #${t.o.id}`, pick(`o:${t.o.address}`), {
      selKey: `o:${t.o.address}`,
      gone,
      cls: dn ? (dn % 2 ? "dip-a" : "dip-b") : "",
    });
  }

  // ---- Docks drawn on the ground
  const tone = (o: YardOrder | undefined) => {
    if (!o) return null;
    if (o.status === OrderStatus.PendingDeliveryQuote || o.status === OrderStatus.EscrowedReady) return "ask" as const;
    if (o.status === OrderStatus.DeliveryQuoted) return "wait" as const;
    return "go" as const;
  };
  const bayShapes = [0, 1, 2, 3].map((i) => {
    const x = bayX(i);
    const o = atBay.get(i);
    const t = tone(o);
    const pts = [
      [x - 0.5, -0.22],
      [x + 0.5, -0.22],
      [x + 0.5, 2.02],
      [x - 0.5, 2.02],
    ]
      .map(([a, b]) => proj(a, 0.01, b).map((v) => v.toFixed(1)).join(","))
      .join(" ");
    return (
      <polygon
        key={i}
        className="bay"
        points={pts}
        fill={t ? DOCK_COLOR[t] : "#ffffff"}
        fillOpacity={t ? (o && `o:${o.address}` === sel ? 0.34 : 0.18) : sel === `dock:${i}` ? 0.22 : 0.06}
        stroke={t ? DOCK_COLOR[t] : "#ffffff"}
        strokeWidth={2.5}
        strokeDasharray={t ? undefined : "8 6"}
      />
    );
  });

  // ---- Pins
  const pins: ReactNode[] = [];
  const pin = (key: string, at: [number, number, number], title: string, note: string, dot: string, onPick: () => void, hint?: string, hidden = false) => {
    const p = proj(...at);
    pins.push(
      <button
        type="button"
        key={key}
        className={`pin${hidden ? " gone" : ""}`}
        title={hint ?? (note ? `${title}, ${note}` : title)}
        aria-label={hint ?? (note ? `${title}, ${note}` : title)}
        onClick={onPick}
        style={{ left: p[0], top: p[1] }}
      >
        <span className={`dot dot-${dot}`} />
        <b>{title}</b>
        {note ? <span className="pin-note">{note}</span> : null}
      </button>,
    );
  };
  for (let i = 0; i < DOCKS; i++) {
    const o = atBay.get(i);
    const x = bayX(i);
    if (!o) {
      pin(`dock-${i}`, [x, 1.3, -0.28], `D${i + 1}`, "free", "free", pick(`dock:${i}`), `Dock ${i + 1}, free`);
      continue;
    }
    const note =
      o.status === OrderStatus.PendingDeliveryQuote
        ? `quote by ${dueLabel(o.expiresAt)}`
        : o.status === OrderStatus.DeliveryQuoted
          ? "customer deciding"
          : o.status === OrderStatus.EscrowedReady
            ? "ready to send"
            : "leaving";
    pin(`dock-${i}`, [x, 1.3, -0.28], `D${i + 1} · #${o.id}`, "", tone(o) ?? "go", pick(`o:${o.address}`), `Dock ${i + 1}, order #${o.id}, ${note}`);
  }
  const gateCount = d.customers.length + d.farmers.length;
  pin("gate", [-3.95, 1.25, 1.45], "Gate", gateCount ? `${gateCount} waiting` : "clear", gateCount ? "ask" : "go", pick("gate"));
  if (counter) {
    const gone = counter === counterGone;
    pin(
      "counter",
      [-2.75, 1.05, 2.35],
      `Counter · #${counter.id}${pickups.length > 1 ? ` +${pickups.length - 1}` : ""}`,
      gone ? "done" : counter.status === OrderStatus.EscrowedPickup ? "hand over" : "confirm handover",
      gone || counter.status !== OrderStatus.EscrowedPickup ? "go" : "ask",
      pick(pickups.length > 1 ? "counter" : `o:${counter.address}`),
      undefined,
      gone,
    );
  } else {
    pin("counter", [-2.75, 1.05, 2.35], "Counter", "no pickups", "free", pick("counter"));
  }
  pin("road", [4.35, 0.15, 1.95], "Road", road.length ? `${road.length} on the road` : "empty", road.length ? "go" : "free", pick("road"));
  pin("vault", [2.35, 0.75, -0.55], "Escrow", moneyText(held, emptyMoney.symbol), "held", pick("vault"));

  // ---- Cargo thrown by the forklift, and the loading chip
  let cargoEl: ReactNode = null;
  if (fork.cargo) {
    const c0 = proj(...fork.cargo.from);
    const c1 = proj(...fork.cargo.to);
    cargoEl = (
      <>
        <img
          key={`cargo-${fork.cargo.n}`}
          className="cargo cargo-a"
          src={CRATE}
          alt=""
          style={{ left: c0[0] - 26.4, top: c0[1] - 24, width: 58, zIndex: 1600, "--dx": `${(c1[0] - c0[0]).toFixed(1)}px`, "--dy": `${(c1[1] - c0[1]).toFixed(1)}px` } as CSSProperties}
        />
        {fork.cargo.to[1] > 0.5 ? <div key={`puff-${fork.cargo.n}`} className="puff puff-a" style={{ left: c1[0], top: c1[1], zIndex: 1601 }} /> : null}
      </>
    );
  }
  let chip: ReactNode = null;
  if (fork.loading) {
    const lp = proj(bayX(fork.loading.bay), 1.25, 1.2);
    chip = (
      <div className="load-chip" style={{ left: lp[0], top: lp[1] }}>
        <span>Loading #{fork.loading.id}</span>
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= fork.loading!.n ? "on" : ""} />
        ))}
      </div>
    );
  }

  // ---- Quests
  const quests: { key: string; title: string; note: string; dot: string; onPick: () => void }[] = [];
  const whereOf = (o: YardOrder) => {
    if (!o.delivery) return "counter";
    const b = docks.bayOf.get(o.address);
    if (o.status === OrderStatus.InTransit) return anim[o.address]?.phase === "hold" && b !== undefined ? `Dock ${b + 1}, loading` : "road";
    return b === undefined ? "waiting for a dock" : `Dock ${b + 1}`;
  };
  for (const o of [...live].sort((a, b) => Number(a.createdAt - b.createdAt))) {
    let title: string | null = null;
    if (isPreTransit(o.status) && expired(o)) title = `Close #${o.id}, past its deadline`;
    else if (o.status === OrderStatus.PendingDeliveryQuote) title = `Quote #${o.id}`;
    else if (o.status === OrderStatus.EscrowedReady) title = `Send #${o.id} out`;
    else if (o.status === OrderStatus.EscrowedPickup) title = `Hand #${o.id} over`;
    else if (o.status === OrderStatus.InTransit) title = `Deliver and release #${o.id}`;
    if (!title) continue;
    quests.push({
      key: o.address,
      title,
      note: `${o.crop}, ${o.qty} · ${whereOf(o)}${o.status === OrderStatus.PendingDeliveryQuote && !expired(o) ? ` · by ${dueLabel(o.expiresAt)}` : ""}`,
      dot: o.status === OrderStatus.InTransit ? "go" : "ask",
      onPick: pick(`o:${o.address}`),
    });
  }
  for (const c of d.customers) quests.push({ key: c.key, title: "Welcome a customer", note: `${tail(c.wallet)} · at the gate`, dot: "ask", onPick: pick(`cust:${c.key}`) });
  for (const f of d.farmers) quests.push({ key: f.key, title: "Accept a farmer", note: f.name, dot: "ask", onPick: pick(`farmer:${f.key}`) });

  const log = [
    ...d.orders.map((o) => ({ at: Number(o.createdAt), text: `Order #${o.id} escrowed ${money(o.sub, o)}${o.delivery ? "" : " for pickup"}` })),
    ...fb.log,
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 7);

  // ---- The selected thing
  const orderBy = new Map(d.orders.map((o) => [o.address as string, o]));
  const animOrder = sel?.startsWith("o:") ? anim[sel.slice(2)]?.order : undefined;
  const selOrder = sel?.startsWith("o:") ? (orderBy.get(sel.slice(2)) ?? animOrder) : undefined;
  const selCustomer = sel?.startsWith("cust:") ? d.customers.find((c) => c.key === sel.slice(5)) : undefined;
  const selFarmer = sel?.startsWith("farmer:") ? d.farmers.find((f) => f.key === sel.slice(7)) : undefined;
  const dockSel = sel?.startsWith("dock:") ? Number(sel.slice(5)) : -1;
  const close = (
    <Button variant="quiet" size="sm" onClick={() => setSel(null)}>
      Close
    </Button>
  );

  let panel: ReactNode;
  if (selOrder) panel = <OrderPanel o={selOrder} where={whereOf(selOrder)} expired={expired(selOrder)} feeBps={d.warehouse.data.feeBps} quote={quotes[selOrder.address] ?? ""} onQuoteChange={(v) => setQuotes((q) => ({ ...q, [selOrder.address]: v }))} onQuote={() => sendQuote(selOrder)} onSendOut={() => sendOut(selOrder)} onComplete={() => complete(selOrder)} onRefuse={() => refuse(selOrder)} onExpire={() => expire(selOrder)} onClose={() => setSel(null)} />;
  else if (selCustomer) {
    const [a, b] = checks[selCustomer.key] ?? [false, false];
    const setCheck = (i: 0 | 1, v: boolean) => setChecks((c) => ({ ...c, [selCustomer.key]: i === 0 ? [v, b] : [a, v] }));
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">Welcome a customer</h2>
          <Badge tone="amber">Pending</Badge>
        </div>
        <Address value={selCustomer.wallet} head={6} tail={6} />
        <span className="small muted">Asked to buy through {name}</span>
        <Notice tone="info" title="Collect the address off-chain first">
          By WhatsApp, phone or in person. It stays in your records; nothing you collect goes to Solana.
        </Notice>
        <label className="check">
          <input type="checkbox" checked={a} onChange={(e) => setCheck(0, e.target.checked)} />
          <span>I have the address and delivery constraints</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={b} onChange={(e) => setCheck(1, e.target.checked)} />
          <span>The address is inside the area {name} serves</span>
        </label>
        <div className="actions">
          <Button variant="primary" disabled={!a || !b} onClick={() => confirmCustomer(selCustomer)}>
            Confirm customer
          </Button>
          <Button onClick={pick("gate")}>Back to the gate</Button>
        </div>
        <div>
          <Button variant="quiet" size="sm" onClick={() => turnAway(selCustomer)}>
            Turn away
          </Button>
        </div>
      </>
    );
  } else if (selFarmer) {
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">Accept a farmer</h2>
          <Badge tone="amber">Pending</Badge>
        </div>
        <span style={{ fontWeight: 500 }}>{selFarmer.name}</span>
        <Address value={selFarmer.wallet} />
        <p className="muted">Once accepted, their harvest lots route through {name} and show up in storage on this yard.</p>
        <div className="actions">
          <Button variant="primary" onClick={() => acceptFarmer(selFarmer)}>
            Accept farmer
          </Button>
          <Button onClick={pick("gate")}>Back to the gate</Button>
        </div>
      </>
    );
  } else if (sel === "gate") {
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">The gate</h2>
          {close}
        </div>
        <p className="muted">People asking to work with {name}. Talk to each one before you let them in.</p>
        {d.customers.map((c) => (
          <div className="row-list" key={c.key}>
            <span>
              <b>Customer {tail(c.wallet)}</b>
              <span className="note">Asking to buy</span>
            </span>
            <Button size="sm" onClick={pick(`cust:${c.key}`)}>
              Review
            </Button>
          </div>
        ))}
        {d.farmers.map((f) => (
          <div className="row-list" key={f.key}>
            <span>
              <b>{f.name}</b>
              <span className="note">Farmer asking to join</span>
            </span>
            <Button size="sm" onClick={pick(`farmer:${f.key}`)}>
              Review
            </Button>
          </div>
        ))}
        {gateCount ? null : <p className="muted">Nobody is waiting at the gate.</p>}
        <span className="note">
          {d.confirmedCustomers} {d.confirmedCustomers === 1 ? "customer" : "customers"} and {d.approvedFarmers} {d.approvedFarmers === 1 ? "farmer" : "farmers"} already work with {name}.
        </span>
      </>
    );
  } else if (sel === "road" || sel === "counter") {
    const list = sel === "road" ? road : pickups;
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">{sel === "road" ? "On the road" : "The counter"}</h2>
          {close}
        </div>
        <p className="muted">
          {sel === "road"
            ? "Orders that left the yard. Complete each one when the customer has it in hand."
            : "Pickup orders. Hand each one over when the customer comes, then confirm the handover."}
        </p>
        {list.map((o) => (
          <div className="row-list" key={o.address}>
            <span>
              <b>
                #{o.id} · {o.crop}
              </b>
              <span className="note">
                {o.qty} · {o.farmer}
              </span>
            </span>
            <Button size="sm" onClick={pick(`o:${o.address}`)}>
              Open
            </Button>
          </div>
        ))}
        {list.length ? null : <p className="muted">{sel === "road" ? "No orders on the road." : "No pickup orders right now."}</p>}
      </>
    );
  } else if (dockSel >= 0) {
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">Dock {dockSel + 1}</h2>
          {close}
        </div>
        <p className="muted">This dock is free. The next delivery order that comes in parks here on its own.</p>
        {docks.queue.length ? (
          <Notice tone="warning" title={`${docks.queue.length} waiting for a dock`}>
            They park as soon as a truck leaves.
          </Notice>
        ) : null}
      </>
    );
  } else if (sel === "vault") {
    const open = live.filter((o) => o.held > 0n);
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">Escrow vault</h2>
          {close}
        </div>
        <p className="muted">Every open order keeps its own escrow. It opens only when you complete the order, or back to the customer if it is refused or expires.</p>
        {open.map((o) => (
          <div className="row-list tight" key={o.address}>
            <span>
              <b>
                #{o.id} · {o.crop}
              </b>
              <span className="note">{statusLabel(o)}</span>
            </span>
            <Amount minor={o.held} decimals={o.decimals} symbol={o.symbol} escrow />
          </div>
        ))}
        {open.length ? null : <p className="muted">The vault is empty.</p>}
      </>
    );
  } else {
    panel = (
      <>
        <h2 className="h-panel">{name}, today</h2>
        <p className="muted">Pick a dock, the gate, the counter, the road or the vault, or a task on the left. Every move ends in one wallet signature.</p>
        <dl className="facts">
          <div>
            <dt>Docks in use</dt>
            <dd className="mono">{atBay.size} of 4</dd>
          </div>
          <div>
            <dt>On the road</dt>
            <dd className="mono">{road.length}</dd>
          </div>
          <div>
            <dt>Held in escrow</dt>
            <dd>
              <Money totals={held} escrow empty={emptyMoney} />
            </dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>
              <Money totals={released} empty={emptyMoney} />
            </dd>
          </div>
        </dl>
      </>
    );
  }

  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const paused = !!d.config?.data.paused;

  return (
    <GameFrame
      variant="yard"
      hud={
        <>
          <HudLogo />
          {hudChip(
            <span className="small muted">
              4 docks · fee {formatFeeBps(d.warehouse.data.feeBps)} · {today}
            </span>,
          )}
          <Badge tone={paused ? "urucum" : "canopy"}>{paused ? "Market paused" : "Market open"}</Badge>
          <div className="hud-money hud-money-held">
            <span>In escrow</span>
            <Money totals={held} escrow empty={emptyMoney} />
          </div>
          <div className="hud-money hud-money-out">
            <span>Released</span>
            <Money totals={released} empty={emptyMoney} />
          </div>
          <HudMe role="operator" name={meName} idle="Acting" />
        </>
      }
      leftLabel="Waiting on you"
      leftCount={String(quests.length)}
      left={
        <>
          <div className="panel-head">
            <h2 className="h-side">Waiting on you</h2>
            <Badge tone={quests.length ? "amber" : "canopy"}>{quests.length ? `${quests.length} waiting` : "All clear"}</Badge>
          </div>
          {fb.flashes.map((f) => (
            <div className="flash" role="status" key={f.id}>
              <CheckIcon />
              <span>{f.text}</span>
            </div>
          ))}
          {quests.map((q) => (
            <button type="button" className="quest" key={q.key} onClick={q.onPick}>
              <span className={`dot dot-${q.dot}`} />
              <span>
                <b>{q.title}</b>
                <span className="note">{q.note}</span>
              </span>
            </button>
          ))}
          {quests.length ? null : <p className="muted">Nothing is waiting on you. Orders on the road finish when the customer has them.</p>}
          <h3 className="h-sub">Recent on Solana</h3>
          <ol className="log">
            {log.map((l, i) => (
              <li key={`${l.at}-${i}-${l.text}`}>
                <span>{logTime(l.at)}</span>
                <span>{l.text}</span>
              </li>
            ))}
            {log.length ? null : <li className="muted">Nothing yet.</li>}
          </ol>
        </>
      }
      right={
        <div className="panel" key={sel ?? "summary"}>
          {panel}
        </div>
      }
      rightOpen={rightOpen}
      onRightOpen={setRightOpen}
      stage={stage}
      scene={
        <>
          <img src={YARD_BG} alt={`The ${name} yard: an arched warehouse with four docks, a gate and a road`} style={{ position: "absolute", left: 0, top: 0, width: YARD_W, height: YARD_H }} draggable={false} />
          <svg aria-hidden="true" width={YARD_W} height={YARD_H} viewBox={`0 0 ${YARD_W} ${YARD_H}`} style={{ position: "absolute", left: 0, top: 0, zIndex: 1 }}>
            {bayShapes}
          </svg>
          {units}
          {cargoEl}
          {chip}
          {pins}
        </>
      }
      hint="Drag to move · scroll to zoom"
      broto={fb.broto}
      toast={fb.toast}
    />
  );
}

// ---- The order panel

function OrderPanel(props: {
  o: YardOrder;
  where: string;
  expired: boolean;
  feeBps: number;
  quote: string;
  onQuoteChange: (v: string) => void;
  onQuote: () => void;
  onSendOut: () => void;
  onComplete: () => void;
  onRefuse: () => void;
  onExpire: () => void;
  onClose: () => void;
}) {
  const { o, expired } = props;
  const terminal = TERMINAL.has(o.status);
  const sym = { decimals: o.decimals, symbol: o.symbol };
  let primary: { label: string; icon: "check" | "truck" | "package"; act: () => void } | null = null;
  if (!terminal && isPreTransit(o.status) && expired) primary = { label: "Close and refund", icon: "check", act: props.onExpire };
  else if (o.status === OrderStatus.PendingDeliveryQuote) primary = { label: "Send quote", icon: "check", act: props.onQuote };
  else if (o.status === OrderStatus.EscrowedReady) primary = { label: "Send out", icon: "truck", act: props.onSendOut };
  else if (o.status === OrderStatus.EscrowedPickup) primary = { label: "Hand over at the counter", icon: "package", act: props.onSendOut };
  else if (o.status === OrderStatus.InTransit) primary = { label: o.delivery ? "Deliver and release" : "Confirm handover and release", icon: "check", act: props.onComplete };
  const canRefuse = o.delivery && AT_DOCK.has(o.status);
  const done: Record<number, { tone: "success" | "info"; title: string; text: string }> = {
    [OrderStatus.Fulfilled]: { tone: "success", title: "Fulfilled · escrow released", text: "The farmer and the logistics wallet were paid and the escrow account closed." },
    [OrderStatus.Refused]: { tone: "info", title: "Refused · customer refunded", text: "Everything in escrow went back to the customer and the stock returned to the lot." },
    [OrderStatus.Canceled]: { tone: "info", title: "Canceled · customer refunded", text: "The customer rejected the delivery fee. Their subtotal came back and the stock returned to the lot." },
    [OrderStatus.Expired]: { tone: "info", title: "Expired · customer refunded", text: "The order passed its deadline and was closed. Everything in escrow went back to the customer." },
  };
  const end = done[o.status];
  return (
    <>
      <div className="order-head">
        <img src={o.thumb} alt="" />
        <div>
          <h2 className="h-panel">Order #{o.id}</h2>
          <span className="small muted">
            {o.crop}, {o.qty} · {o.farmer}
          </span>
        </div>
      </div>
      <div className="panel-head">
        <Status status={o.code} />
        <span className="small muted">{o.delivery ? (o.status === OrderStatus.InTransit ? "On the road" : props.where) : "Pickup at the counter"}</span>
      </div>
      <Lifecycle mode={o.delivery ? "DELIVERY" : "PICKUP"} status={o.code} vertical />
      <dl className="facts tight">
        <div>
          <dt>Subtotal</dt>
          <dd>
            <Amount minor={o.sub} {...sym} escrow={!terminal} />
          </dd>
        </div>
        <div>
          <dt>Delivery fee</dt>
          <dd className="small">{!o.delivery ? "None, pickup" : o.fee ? money(o.fee, o) : "Not quoted yet"}</dd>
        </div>
        <div className="sum">
          <dt className="strong">Farmer receives</dt>
          <dd>
            <Amount minor={o.sub - o.service} {...sym} />
          </dd>
        </div>
        <div>
          <dt className="strong">Logistics wallet receives</dt>
          <dd>
            <Amount minor={o.service + o.fee} {...sym} />
          </dd>
        </div>
      </dl>
      {o.status === OrderStatus.PendingDeliveryQuote && !expired ? (
        <Field label="Delivery fee" affix={o.symbol} hint={`Quote by ${dueLabel(o.expiresAt)}. The customer accepts it into escrow or rejects it for a full refund.`}>
          <input className="kb-input kb-input-mono" inputMode="decimal" placeholder="0.00" value={props.quote} onChange={(e) => props.onQuoteChange(e.target.value)} />
        </Field>
      ) : null}
      {o.status === OrderStatus.DeliveryQuoted && !expired ? (
        <Notice tone="warning" title="Waiting for the customer">
          They accept the {money(o.fee, o)} fee into escrow or reject it. Nothing for you to do yet.
        </Notice>
      ) : null}
      {!terminal && isPreTransit(o.status) && expired ? (
        <Notice tone="warning" title={`Past its deadline, ${dueLabel(o.expiresAt)}`}>
          The order can close now and the customer’s money goes back. Anyone may close it; you can do it here.
        </Notice>
      ) : null}
      {end ? (
        <Notice tone={end.tone} title={end.title}>
          {end.text}
        </Notice>
      ) : null}
      <div className="actions">
        {primary ? (
          <Button variant="primary" icon={primary.icon} onClick={primary.act}>
            {primary.label}
          </Button>
        ) : null}
        {canRefuse ? (
          <Button variant="danger" onClick={props.onRefuse}>
            Refuse delivery
          </Button>
        ) : null}
        <Button variant="quiet" onClick={props.onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

// ---- Words

function money(minor: bigint, o: { decimals: number; symbol: string }): string {
  return `${formatMinor(minor, o.decimals)} ${o.symbol}`;
}

const STATUS_LABEL: Record<string, string> = {
  ESCROWED_PICKUP: "Escrowed, pickup",
  PENDING_DELIVERY_QUOTE: "Waiting for your quote",
  DELIVERY_QUOTED: "Quoted, customer deciding",
  ESCROWED_READY: "Ready to send out",
  IN_TRANSIT: "In transit",
};

function statusLabel(o: YardOrder): string {
  return STATUS_LABEL[o.code] ?? o.code;
}

function openingLine(d: YardData, now: bigint): [Mood, string] {
  const live = d.orders.filter((o) => !TERMINAL.has(o.status));
  const late = live.find((o) => isPastDeadline(o.view.account.data, now));
  if (late) return ["alert", `The deadline for #${late.id} was ${dueLabel(late.expiresAt)}. The order can close now and the customer’s money goes back.`];
  const quotes = live.filter((o) => o.status === OrderStatus.PendingDeliveryQuote).length;
  const gate = d.customers.length + d.farmers.length;
  const parts: string[] = [];
  if (quotes) parts.push(`${count(quotes, "quote is", "quotes are")} due`);
  if (gate) parts.push(`${count(gate, "person is", "people are")} at the gate`);
  if (parts.length) return ["talk", `${cap(parts.join(" and "))}. Pick a dock or the gate to start.`];
  if (live.length) return ["idle", "Nothing needs a quote and the gate is clear. Orders on the road finish when the customer has them."];
  return ["idle", "The yard is quiet. New orders and people asking to join show up here as they arrive."];
}

function count(n: number, one: string, many: string): string {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return `${words[n] ?? n} ${n === 1 ? one : many}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
