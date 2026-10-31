// Design: "Play · admin · the program map" (Katūbayá gamificado, Round 2). The program admin holds
// the key: opens or pauses the market for everyone (set_paused), founds warehouses on free plots
// (create_warehouse) and changes a warehouse's fee, operator or delivery area (update_warehouse).
// Founding plays out on the map: the site goes up, a road is surveyed and paved from the nearest
// warehouse, and trucks drive in.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isAddress, type Address as Addr } from "@solana/kit";
import { Address, Amount, Badge, Button, Field, Notice, formatMinor } from "../../design-system";
import {
  findWarehousePda,
  getCreateWarehouseInstructionAsync,
  getInitConfigInstructionAsync,
  getSetPausedInstructionAsync,
  getUpdateWarehouseInstructionAsync,
} from "../../generated";
import { mintSymbol } from "../../config";
import { MAP, MAP_TRUCK, mapTruckSrc } from "../../game/assets";
import { logTime, useFeedback, usePoll } from "../../game/feedback";
import { GameFrame, GameGate, HudLogo, HudMe, NetworkBadge } from "../../game/GameFrame";
import { useStage } from "../../game/useStage";
import { LoadError, Loading } from "../../components/States";
import { formatFeeBps, shortKey } from "../../solana/format";
import { NETWORK_FEE, SIZE, formatSol, rentOf } from "../../solana/rent";
import { byteLength } from "../../solana/units";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useTx, type TxRequest } from "../../tx/TxProvider";
import { useWallet } from "../../wallet/WalletProvider";
import { moneyText, type Totals } from "../warehouse/yardModel";
import {
  CELLS,
  S,
  boundsOf,
  freeCells,
  loadProgram,
  mapGeo,
  nearest,
  parseZips,
  pts,
  rawP,
  routeFor,
  warehouseIdFor,
  zipsText,
  type Geo,
  type MapWarehouse,
  type ProgramData,
} from "./mapModel";

// ---- Gate: the wallet must hold the program key (or set the program up)

export function ProgramMap() {
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
      <GameGate variant="map" hud={hud}>
        <h2 className="h-panel">Connect the admin wallet</h2>
        <p className="muted">The program map opens for the wallet that holds the program key. Katūbayá never holds your keys.</p>
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
      <GameGate variant="map" hud={hud}>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Reading the program from Solana…" />}
      </GameGate>
    );
  }
  if (!profile.config) return <SetUp hud={hud} wallet={wallet} onDone={reload} />;
  if (!profile.isAdmin) {
    return (
      <GameGate variant="map" hud={hud}>
        <h2 className="h-panel">This wallet doesn't hold the program key</h2>
        <p className="muted">Only the program admin plays the map. The key belongs to:</p>
        <Address value={profile.config.data.admin} head={6} tail={6} />
        <div className="actions">
          <Link to="/" className="kb-btn kb-btn-secondary">
            Go to my screens
          </Link>
        </div>
      </GameGate>
    );
  }
  return <AdminMap />;
}

/** The program was never set up on this network: the first wallet to do it holds the key. */
function SetUp({ hud, wallet, onDone }: { hud: ReactNode; wallet: Addr; onDone: () => Promise<void> }) {
  const run = useTx();
  const [logistics, setLogistics] = useState<string>(wallet);
  const [mints, setMints] = useState("");
  const mintList = mints.split(/[\s,;]+/).filter(Boolean);
  const badMint = mintList.find((m) => !isAddress(m));
  const ok = isAddress(logistics.trim()) && !badMint && mintList.length <= 29;
  return (
    <GameGate variant="map" hud={hud}>
      <h2 className="h-panel">Set up the program</h2>
      <p className="muted">
        Katūbayá isn't set up on this network yet. The wallet that sets it up holds the program key: it founds warehouses and can pause
        the market.
      </p>
      <Field label="Logistics wallet" hint="Receives every service and delivery fee when an order completes.">
        <input className="kb-input kb-input-mono" value={logistics} onChange={(e) => setLogistics(e.target.value)} />
      </Field>
      <Field label="Accepted mints" optional hint="Comma-separated mint addresses. Leave empty to accept any mint without blocked extensions." error={badMint ? `${shortKey(badMint)} isn't an address` : undefined}>
        <input className="kb-input kb-input-mono" value={mints} onChange={(e) => setMints(e.target.value)} />
      </Field>
      <div>
        <Button
          variant="primary"
          disabled={!ok}
          onClick={() =>
            run({
              title: "Set up the program",
              instruction: "init_config",
              description: "Creates the program config. Your wallet becomes the program admin. No tokens move.",
              lines: [
                { label: "Admin", value: shortKey(wallet) },
                { label: "Logistics wallet", value: shortKey(logistics.trim()) },
                { label: "Accepted mints", value: mintList.length ? String(mintList.length) : "Any" },
                { label: "Network fee", value: NETWORK_FEE },
              ],
              build: async (signer) => [
                await getInitConfigInstructionAsync({
                  admin: signer,
                  logisticsWallet: logistics.trim() as Addr,
                  paused: false,
                  allowedMints: mintList as Addr[],
                }),
              ],
              game: true,
              onConfirmed: () => onDone(),
              doneLabel: "Open the map",
            })
          }
        >
          Set up the program
        </Button>
      </div>
    </GameGate>
  );
}

// ---- The map

type Phase = "survey" | "paving" | "done";
type Building = { phase: Phase; parent: string; justBuilt?: boolean };
type Truck = { id: string; road: string; k: number; dir: 1 | -1; turn: number; shown: boolean };

const NAMES = ["Armazém Iguape", "Armazém Cananéia", "Armazém Eldorado", "Armazém Sete Barras", "Armazém Pariquera", "Armazém Miracatu", "Armazém Jacupiranga"];

function pct(bps: number): string {
  return formatFeeBps(bps);
}

function parseFee(text: string): number | null {
  const v = Number(text.replace(",", ".").trim());
  if (!text.trim() || !Number.isFinite(v) || v < 0 || v > 100) return null;
  const bps = Math.round(v * 100);
  return Math.abs(bps - v * 100) < 1e-6 ? bps : null;
}

function Money({ totals, symbol }: { totals: Totals; symbol: string }) {
  if (!totals.size) return <Amount minor={0} symbol={symbol} escrow />;
  return (
    <>
      {[...totals.entries()].map(([mint, m]) => (
        <Amount key={mint} minor={m.minor} decimals={m.decimals} symbol={m.symbol} escrow />
      ))}
    </>
  );
}

function AdminMap() {
  const { reload: reloadSession } = useSession();
  const { address: wallet } = useWallet();
  const data = useAsync(loadProgram, []);
  usePoll(data.reload, 10000);
  const run = useTx();
  const fb = useFeedback({ mood: "talk", text: "Reading the program from Solana…" });
  const d: ProgramData | undefined = data.data;

  const [sel, setSel] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [building, setBuilding] = useState<Record<string, Building>>({});
  const [feeInput, setFeeInput] = useState("");
  const [opInput, setOpInput] = useState("");
  const [zipInput, setZipInput] = useState("");
  const [nameN, setNameN] = useState(0);
  const [form, setForm] = useState({ name: "", op: "", fee: "2.5", zips: "", notes: "" });
  const [trucks, setTrucks] = useState<Truck[]>([]);

  const whs = d?.warehouses ?? [];
  const geo: Geo = useMemo(() => mapGeo(boundsOf(whs)), [whs]);
  const stage = useStage({ W: geo.W, H: geo.H, pad: 24 });
  const paused = !!d?.config?.data.paused;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const draggingRef = useRef(stage.dragging);
  draggingRef.current = stage.dragging;

  const phaseOf = (w: MapWarehouse): Phase => building[w.address]?.phase ?? "done";
  const roads = d?.roads ?? [];

  // the opening line, once
  const opened = useRef(false);
  useEffect(() => {
    if (!d || opened.current) return;
    opened.current = true;
    const n = d.warehouses.length;
    fb.say(
      "talk",
      n
        ? `${n === 1 ? "One warehouse is" : `${n} warehouses are`} running. Every “+” on the map is a plot you can found a new one on.`
        : "The map is empty. Found the first warehouse on the plot in the middle.",
    );
    if (d.config?.data.paused) fb.say("alert", "The market is paused. Trucks stand where they are; nothing new starts.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  // ---- Traffic: trucks on every paved road, a few more where orders are on their way
  useEffect(() => {
    setTrucks((cur) => {
      const next: Truck[] = [];
      for (const r of roads) {
        if (building[r.to.address] && building[r.to.address].phase !== "done") continue;
        const want = Math.max(1, Math.min(3, 1 + r.to.inTransit));
        const mine = cur.filter((t) => t.road === r.id);
        const n = routeFor(r.from, r.to).length;
        for (let k = 0; k < want; k++) next.push(mine[k] ?? { id: `${r.id}-${k}`, road: r.id, k: Math.floor((k * n) / want), dir: k % 2 ? -1 : 1, turn: 0, shown: !building[r.to.address] });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, building]);
  const roadsRef = useRef(roads);
  roadsRef.current = roads;
  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current || draggingRef.current) return;
      setTrucks((ts) =>
        ts.map((t) => {
          const r = roadsRef.current.find((x) => x.id === t.road);
          if (!r) return t;
          const n = routeFor(r.from, r.to).length;
          if (t.turn) {
            const tn = t.turn + 1;
            return tn > 4 ? { ...t, turn: 0, dir: (-t.dir as 1 | -1), shown: true } : { ...t, turn: tn, shown: true };
          }
          const k = Math.max(0, Math.min(n - 1, t.k + t.dir));
          return { ...t, k, turn: (k === n - 1 && t.dir > 0) || (k === 0 && t.dir < 0) ? 1 : 0, shown: true };
        }),
      );
    }, 450);
    return () => clearInterval(timer);
  }, []);

  const pick = (key: string | null) => () => {
    if (stage.wasDrag()) return;
    const w = key?.startsWith("w:") ? whs.find((x) => `w:${x.address}` === key) : undefined;
    setSel(key);
    setRightOpen(true);
    if (w) {
      setFeeInput(String(w.account.data.feeBps / 100));
      setOpInput("");
      setZipInput(zipsText(w.account.data));
    }
  };

  const free = freeCells(whs);
  const plotSel = sel?.startsWith("plot:") ? Number(sel.slice(5)) : null;
  const plotFor = () => plotSel ?? free[0];
  const startFound = () => {
    if (stage.wasDrag()) return;
    setSel(`plot:${plotFor()}`);
    setRightOpen(true);
  };

  // ---- Transactions
  const tx = (req: Omit<TxRequest, "game" | "onRejected" | "onFailed" | "onConfirmed"> & { before: string; onConfirmed: () => void }) => {
    const { before, onConfirmed, ...rest } = req;
    fb.say("talk", before);
    run({
      ...rest,
      game: true,
      doneLabel: "Back to the map",
      onConfirmed: async () => {
        fb.showToast(`Confirmed on Solana · ${rest.title}`);
        onConfirmed();
        await Promise.all([data.reload(), reloadSession()]);
      },
      onRejected: () => fb.say("idle", "Nothing was sent. The program is as you left it."),
      onFailed: (f) => fb.say("alert", `${f.title}. ${f.message}`),
    });
  };

  const togglePause = () => {
    const next = !paused;
    tx({
      title: next ? "Pause the market" : "Open the market",
      instruction: "set_paused",
      description: next
        ? "No new offers or orders anywhere until you open it again. Orders already in escrow keep their funds, and every refund path stays open."
        : "Farmers can publish and customers can order again, at every warehouse.",
      lines: [
        { label: "Market", value: next ? "Open → Paused" : "Paused → Open" },
        { label: "Warehouses affected", value: String(whs.length) },
        { label: "Network fee", value: NETWORK_FEE },
      ],
      build: async (signer) => [await getSetPausedInstructionAsync({ admin: signer, paused: next })],
      before: next ? "Pausing reaches every warehouse at once. Money already in escrow is safe either way." : "Opening lets everyone trade again.",
      onConfirmed: () => {
        fb.addLog(next ? "Market paused" : "Market opened");
        if (next) fb.say("alert", "The market is paused. Trucks stop where they are; nothing new starts.");
        else fb.say("celebrate", "The market is open again and the trucks are moving.");
      },
    });
  };

  const wsel = sel?.startsWith("w:") ? whs.find((x) => `w:${x.address}` === sel) : undefined;

  const update = (w: MapWarehouse, change: "fee" | "operator" | "zips") => {
    const cur = w.account.data;
    let args: { operator: Addr | null; feeBps: number | null; deliverZipPrefixes: { prefix: number; len: number }[] | null };
    let title: string;
    let description: string;
    let line: { label: string; value: string; note?: string };
    let before: string;
    let after: () => void;
    if (change === "fee") {
      const bps = parseFee(feeInput);
      if (bps == null) return fb.say("alert", "Type a fee between 0 and 100%, with at most two decimals.");
      args = { operator: null, feeBps: bps, deliverZipPrefixes: null };
      title = `Set ${w.name}’s fee to ${pct(bps)}`;
      description = `New orders at ${w.name} pay this service fee. Orders already placed keep the fee they were created with.`;
      line = { label: "Service fee", value: `${pct(cur.feeBps)} → ${pct(bps)}`, note: `fee_bps ${cur.feeBps} → ${bps}` };
      before = "A new fee only reaches future orders. Nobody’s escrow changes.";
      after = () => {
        fb.addLog(`${w.name} fee set to ${pct(bps)}`);
        fb.say("idle", `${w.name} now charges ${pct(bps)} on new orders.`);
      };
    } else if (change === "operator") {
      const k = opInput.trim();
      if (!isAddress(k)) return fb.say("alert", "Paste the new operator’s full wallet address first.");
      if (k === cur.operator) return fb.say("alert", "That wallet already runs this warehouse.");
      args = { operator: k, feeBps: null, deliverZipPrefixes: null };
      title = `Hand ${w.name} to a new operator`;
      description = "The new wallet runs the warehouse from now on, including every open order and those on the road. The old wallet loses access.";
      line = { label: "Operator", value: `${shortKey(cur.operator)} → ${shortKey(k)}` };
      before = "Use this when an operator lost their key or steps down. Double-check the address; it takes over everything.";
      after = () => {
        setOpInput("");
        fb.addLog(`${w.name} handed to ${shortKey(k)}`);
        fb.say("idle", `${shortKey(k)} now runs ${w.name}.`);
      };
    } else {
      const zips = parseZips(zipInput);
      if (!zips) return fb.say("alert", "Each CEP prefix has 3 to 5 digits, like 119 or 11950.");
      if (zips.length > 100) return fb.say("alert", "A warehouse can list up to 100 CEP prefixes.");
      args = { operator: null, feeBps: null, deliverZipPrefixes: zips };
      const text = zips.map((z) => String(z.prefix).padStart(z.len, "0")).join(", ") || "pickup only";
      title = `Redraw ${w.name}’s delivery area`;
      description = "Customers see the new area when they choose a warehouse. Customers already confirmed stay confirmed.";
      line = { label: "Delivers to CEP", value: `${zipsText(cur) || "none"} → ${text}` };
      before = "The delivery area only guides customers choosing a warehouse; nobody’s orders change.";
      after = () => {
        fb.addLog(`${w.name} now delivers to ${text}`);
        fb.say("idle", `${w.name} delivers to CEP ${text} now.`);
      };
    }
    tx({
      title,
      instruction: "update_warehouse",
      description,
      lines: [line, { label: "Network fee", value: NETWORK_FEE }],
      build: async (signer) => [await getUpdateWarehouseInstructionAsync({ admin: signer, warehouseId: w.id, pickupNotes: null, ...args })],
      before,
      onConfirmed: after,
    });
  };

  const found = async () => {
    const plot = plotFor();
    const [i, j] = CELLS[plot];
    const name = (form.name.trim() || NAMES[nameN % NAMES.length]).trim();
    const bps = parseFee(form.fee);
    const zips = parseZips(form.zips);
    const op = form.op.trim();
    if (!name || !isAddress(op) || bps == null || !zips) {
      fb.say("alert", "A warehouse needs a name, a full operator wallet, a fee and CEP prefixes of 3 to 5 digits.");
      return;
    }
    if (byteLength(name) > 100) return fb.say("alert", "Shorten the name to 100 bytes or fewer.");
    if (byteLength(form.notes) > 500) return fb.say("alert", "Shorten the pickup notes to 500 bytes or fewer.");
    const id = warehouseIdFor(plot);
    const [address] = await findWarehousePda({ warehouseId: id });
    const parent = nearest(whs, i, j);
    const rent = await rentOf(SIZE.warehouse);
    const zipText = zips.map((z) => String(z.prefix).padStart(z.len, "0")).join(", ") || "pickup only";
    tx({
      title: `Found ${name}`,
      instruction: "create_warehouse",
      description: "A new warehouse account is created with its operator, fee and delivery area. Its name can never change.",
      lines: [
        { label: "Warehouse", value: `#${id} · ${name}` },
        { label: "Operator", value: shortKey(op) },
        { label: "Service fee", value: pct(bps) },
        { label: "Delivers to CEP", value: zipText },
        { label: "Account rent", value: formatSol(rent), note: "Paid by you" },
        { label: "Network fee", value: NETWORK_FEE },
      ],
      build: async (signer) => [
        await getCreateWarehouseInstructionAsync({
          admin: signer,
          warehouseId: id,
          operator: op as Addr,
          name,
          pickupNotes: form.notes.trim(),
          feeBps: bps,
          deliverZipPrefixes: zips,
          deliveryFeeRulesUri: null,
        }),
      ],
      before: parent
        ? `Founding a warehouse is permanent. Once it’s on Solana I’ll lay the road from ${parent.name}.`
        : "Founding a warehouse is permanent. It becomes the first stop on the map.",
      onConfirmed: () => {
        setNameN((n) => n + 1);
        setForm({ name: "", op: "", fee: form.fee, zips: "", notes: "" });
        setSel(`w:${address}`);
        stage.fit();
        fb.addLog(`${name} founded`);
        if (!parent) {
          setBuilding((b) => ({ ...b, [address]: { phase: "done", parent: "", justBuilt: true } }));
          fb.say("celebrate", `${name} is open. Its operator can start welcoming farmers and customers.`);
          fb.showToast(`${name} is open`);
          fb.later(1200, () => setBuilding(({ [address]: _, ...b }) => b));
          return;
        }
        setBuilding((b) => ({ ...b, [address]: { phase: "survey", parent: parent.name } }));
        fb.say("talk", `Surveying the route from ${parent.name} to ${name}…`);
        fb.later(1000, () => {
          setBuilding((b) => (b[address] ? { ...b, [address]: { ...b[address], phase: "paving" } } : b));
          fb.say("talk", `Paving the road from ${parent.name}…`);
        });
        fb.later(2700, () => {
          setBuilding((b) => (b[address] ? { ...b, [address]: { ...b[address], phase: "done", justBuilt: true } } : b));
          fb.addLog(`Road to ${name} paved`);
          fb.say("celebrate", `${name} is open. Trucks are on their way from ${parent.name}.`);
          fb.showToast(`${name} is open`);
        });
        fb.later(3600, () => setBuilding(({ [address]: _, ...b }) => b));
      },
    });
  };

  // ---- Not read yet
  const symbols = d?.config?.data.allowedMints.map((m) => mintSymbol(m)) ?? [];
  const symbolLine = symbols.length ? [...new Set(symbols)].join(", ") : "any mint";
  const firstSymbol = symbols[0] ?? "";
  const hudBase = (count: string) => (
    <div className="hud-chip">
      <span style={{ fontWeight: 500 }}>The program</span>
      <span className="small muted">
        {count} · {symbolLine}
      </span>
    </div>
  );
  if (!d) {
    return (
      <GameGate
        variant="map"
        hud={
          <>
            <HudLogo />
            {hudBase("…")}
            <HudMe role="admin" name="Program admin" idle="Holding the key" />
          </>
        }
      >
        {data.error ? <LoadError error={data.error} onRetry={data.reload} /> : <Loading label="Reading the program from Solana…" />}
      </GameGate>
    );
  }

  // ---- Ground, plots and roads (raw coordinates inside a translated group)
  const g = geo;
  const freeSet = new Set(free);
  const plotShapes = CELLS.map(([ci, cj], n) => {
    const x = ci * S;
    const z = cj * S;
    const e = 1.25;
    const on = freeSet.has(n);
    return (
      <polygon
        key={n}
        points={pts([
          [x - e, 0.01, z - e],
          [x + e, 0.01, z - e],
          [x + e, 0.01, z + e],
          [x - e, 0.01, z + e],
        ])}
        fill={plotSel === n ? "#2d5a28" : "#ffffff"}
        fillOpacity={plotSel === n ? 0.3 : 0.12}
        stroke="#ffffff"
        strokeOpacity={0.75}
        strokeWidth={2}
        strokeDasharray="7 7"
        style={on ? undefined : { display: "none" }}
      />
    );
  });
  const roadEls = roads.map((r) => {
    const phase = phaseOf(r.to);
    const route = routeFor(r.from, r.to).map((q) => [q[0], 0.02, q[1]] as [number, number, number]);
    const px = route.map((q) => rawP(...q));
    let L = 0;
    for (let n = 1; n < px.length; n++) L += Math.hypot(px[n][0] - px[n - 1][0], px[n][1] - px[n - 1][1]);
    L = Math.ceil(L) + 40;
    const p = pts(route);
    return (
      <g key={r.id}>
        <polyline
          className={phase === "paving" ? "road-draw" : undefined}
          points={p}
          fill="none"
          stroke="#a9a28f"
          strokeWidth={30}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={phase === "survey" ? { opacity: 0 } : phase === "paving" ? { strokeDasharray: L, strokeDashoffset: L } : undefined}
        />
        <polyline points={p} fill="none" stroke="#faf8f2" strokeWidth={3} strokeDasharray="10 12" style={phase === "done" ? { animation: "fx-fade 600ms ease" } : { opacity: 0 }} />
        <polyline
          className="survey"
          points={p}
          fill="none"
          stroke="#d79a2b"
          strokeWidth={4}
          strokeDasharray="4 9"
          strokeLinecap="round"
          style={phase === "done" ? { opacity: 0, transition: "opacity 500ms" } : undefined}
        />
      </g>
    );
  });

  // ---- Sprites
  const sprite = (key: keyof typeof MAP, x: number, z: number) => {
    const [w, , ax, ay] = MAP[key].meta;
    const p = rawP(x, 0, z);
    const sx = g.ox + p[0];
    const sy = g.oy + p[1];
    return { left: sx - ax / 2, top: sy - ay / 2, width: w / 2, zIndex: Math.round(sy + 10) };
  };
  const used = new Set(whs.map((w) => `${w.i},${w.j}`));
  const trees = CELLS.flatMap(([ci, cj], n) => {
    const h = Math.abs((ci * 73856093) ^ (cj * 19349663)) % 5;
    if (h > 2) return [];
    const inB = ci >= g.b.i0 && ci <= g.b.i1 && cj >= g.b.j0 && cj <= g.b.j1;
    const show = inB && !used.has(`${ci},${cj}`);
    const k = h === 0 ? "palm" : "tree";
    const st = sprite(k, ci * S - 1.2, cj * S - 1.1);
    return [<img key={`t${n}`} className="tree" src={MAP[k].src} alt="" style={{ ...st, opacity: show ? undefined : 0 }} />];
  });
  const whSprites = whs.map((w) => {
    const built = phaseOf(w) === "done";
    const k = built ? "wh" : "site";
    const st: CSSProperties = sprite(k, w.i * S, w.j * S);
    if (`w:${w.address}` === sel) st.filter = "drop-shadow(0 0 8px rgba(29, 93, 112, 0.9))";
    return (
      <button type="button" key={w.address} className={`unit${building[w.address]?.justBuilt ? " built-pop" : ""}`} aria-label={`${w.name}${built ? ", warehouse" : ", being built"}`} onClick={pick(`w:${w.address}`)} style={st}>
        <img src={MAP[k].src} alt="" />
      </button>
    );
  });
  const truckEls = trucks.map((t) => {
    const r = roads.find((x) => x.id === t.road);
    if (!r) return null;
    const route = routeFor(r.from, r.to);
    const n = route.length;
    const k = Math.max(0, Math.min(n - 1, t.k));
    // heading from the tangent in the direction of travel, swept through 180° while turning round at a road end
    let a = route[Math.max(0, Math.min(n - 1, k - t.dir))];
    const b = route[Math.max(0, Math.min(n - 1, k + t.dir))];
    if (a[0] === b[0] && a[1] === b[1]) a = route[k];
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (t.turn) ang += (t.turn * Math.PI) / 4;
    const idx = ((Math.round(ang / (Math.PI / 8)) % 16) + 16) % 16;
    const M = MAP_TRUCK[idx];
    const ox = -Math.sin(ang) * 0.24;
    const oz = Math.cos(ang) * 0.24;
    const p = rawP(route[k][0] + ox, 0, route[k][1] + oz);
    const sx = g.ox + p[0];
    const sy = g.oy + p[1];
    const hide = !t.shown || phaseOf(r.to) !== "done";
    return (
      <div
        key={t.id}
        className={`truck${t.turn ? " turning" : ""}${paused ? " parked" : ""}`}
        style={{ left: sx - M[2] / 2, top: sy - M[3] / 2, width: M[0] / 2, zIndex: Math.round(sy + 10), opacity: hide ? 0 : undefined, filter: paused ? "saturate(0.4)" : undefined }}
      >
        <img src={mapTruckSrc(idx)} alt="" />
      </div>
    );
  });
  const admin = sprite("admin", -1.6, 2.8);

  const plotBtns = CELLS.map(([ci, cj], n) => {
    if (!freeSet.has(n)) return null;
    const p = rawP(ci * S, 0, cj * S);
    const label = `Free plot ${ci}, ${cj}, found a warehouse here`;
    return (
      <button
        type="button"
        key={n}
        className={`plotbtn${plotSel === n ? " on" : ""}`}
        aria-label={label}
        title={label}
        onClick={pick(`plot:${n}`)}
        style={{ left: g.ox + p[0], top: g.oy + p[1] }}
      >
        +
      </button>
    );
  });
  const pins = whs.map((w) => {
    const p = rawP(w.i * S, 1.75, w.j * S);
    const built = phaseOf(w) === "done";
    const note = !built ? "being built" : paused ? "paused" : `fee ${pct(w.account.data.feeBps)} · ${moneyText(w.held, firstSymbol)} held`;
    return (
      <button type="button" key={w.address} className="pin" onClick={pick(`w:${w.address}`)} style={{ left: g.ox + p[0], top: g.oy + p[1] }} aria-label={`${w.name}, ${note}`}>
        <span className={`dot ${!built ? "dot-build" : paused ? "dot-stop" : "dot-go"}`} />
        <b>{w.name}</b>
        <span className="pin-note">{note}</span>
      </button>
    );
  });

  // ---- Panels
  const close = (
    <Button variant="quiet" size="sm" onClick={() => setSel(null)}>
      Close
    </Button>
  );
  let panel: ReactNode;
  const bld = wsel ? building[wsel.address] : undefined;
  if (wsel && bld && bld.phase !== "done") {
    const order: Phase[] = ["survey", "paving", "done"];
    const at = order.indexOf(bld.phase) + 1;
    const texts = ["Founded on Solana", "Surveying the route", "Paving the road", "Opening the yard"];
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">{wsel.name}</h2>
          <Badge tone="amber">Being built</Badge>
        </div>
        <p className="muted">The warehouse account exists on Solana. The yard is going up and a road is being laid from {bld.parent}.</p>
        <ol className="steps">
          {texts.map((t, n) => {
            const done = n < at || n === 0;
            const cur = n === at && n > 0;
            return (
              <li key={t}>
                <span className={`step-node${done ? " done" : cur ? " cur" : ""}`}>{done ? "✓" : n + 1}</span>
                <span className={done ? undefined : cur ? "cur-label" : "todo-label"}>{t}</span>
              </li>
            );
          })}
        </ol>
      </>
    );
  } else if (wsel) {
    const w = wsel.account.data;
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">{wsel.name}</h2>
          {close}
        </div>
        <span className="small muted">
          Warehouse #{wsel.id.toString()} · {w.deliverZipPrefixes.length ? `delivers to CEP ${zipsText(w)}` : "pickup only"}
        </span>
        <dl className="facts tight">
          <div>
            <dt>Operator</dt>
            <dd>
              <Address value={w.operator} />
            </dd>
          </div>
          <div>
            <dt>Service fee</dt>
            <dd className="mono">{pct(w.feeBps)}</dd>
          </div>
          <div>
            <dt>Farmers</dt>
            <dd className="mono">{wsel.farmers}</dd>
          </div>
          <div>
            <dt>Customers</dt>
            <dd className="mono">{wsel.customers}</dd>
          </div>
          <div>
            <dt>Held in escrow</dt>
            <dd>
              <Money totals={wsel.held} symbol={firstSymbol} />
            </dd>
          </div>
        </dl>
        <Field label="Service fee" affix="%" hint="Applies to new orders only. Orders already placed keep their fee.">
          <input className="kb-input kb-input-mono" inputMode="decimal" value={feeInput} onChange={(e) => setFeeInput(e.target.value)} />
        </Field>
        <div>
          <Button variant="primary" onClick={() => update(wsel, "fee")}>
            Update fee
          </Button>
        </div>
        <Field label="Hand the keys to a new operator" hint="The new wallet takes over every open order, including those on the road.">
          <input className="kb-input kb-input-mono" placeholder="New operator wallet" value={opInput} onChange={(e) => setOpInput(e.target.value)} />
        </Field>
        <div>
          <Button onClick={() => update(wsel, "operator")}>Hand over the keys</Button>
        </div>
        <Field label="Delivery area" hint="CEP prefixes of 3 to 5 digits, comma-separated. Empty means pickup only.">
          <input className="kb-input kb-input-mono" placeholder="118, 119" value={zipInput} onChange={(e) => setZipInput(e.target.value)} />
        </Field>
        <div>
          <Button onClick={() => update(wsel, "zips")}>Redraw the delivery area</Button>
        </div>
      </>
    );
  } else if (plotSel != null) {
    const [pi, pj] = CELLS[plotSel];
    const par = nearest(whs, pi, pj);
    panel = (
      <>
        <div className="panel-head">
          <h2 className="h-panel">Found a warehouse</h2>
          {close}
        </div>
        <Notice tone="info" title={`Plot ${pi}, ${pj}${par ? ` · next to ${par.name}` : ""}`}>
          {par
            ? `Once it’s founded, a road is laid from ${par.name} and trucks drive in. New plots open around it.`
            : "The first warehouse on the map. New plots open around it once it’s founded."}
        </Notice>
        <Field label="Name" hint="Permanent once founded.">
          <input className="kb-input" placeholder={NAMES[nameN % NAMES.length]} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Operator wallet">
          <input className="kb-input kb-input-mono" placeholder="The wallet that runs the yard" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Service fee" affix="%">
            <input className="kb-input kb-input-mono" inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          </Field>
          <Field label="CEP prefixes">
            <input className="kb-input kb-input-mono" placeholder="119" value={form.zips} onChange={(e) => setForm({ ...form, zips: e.target.value })} />
          </Field>
        </div>
        <Field label="Pickup notes" optional hint="Shown to customers choosing a warehouse: hours, how to find the counter.">
          <input className="kb-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <div>
          <Button variant="primary" icon="plus" onClick={() => void found()}>
            Found warehouse
          </Button>
        </div>
      </>
    );
  } else {
    panel = (
      <>
        <h2 className="h-panel">The program</h2>
        <p className="muted">You hold the program’s key. Pick a warehouse to change its fee or operator, or a “+” plot to found a new one.</p>
        <dl className="facts">
          <div>
            <dt>Warehouses</dt>
            <dd className="mono">{whs.length}</dd>
          </div>
          <div>
            <dt>Roads</dt>
            <dd className="mono">{roads.length}</dd>
          </div>
          <div>
            <dt>Farmers approved</dt>
            <dd className="mono">{d.farmers}</dd>
          </div>
          <div>
            <dt>Held in escrow</dt>
            <dd>
              <Money totals={d.held} symbol={firstSymbol} />
            </dd>
          </div>
        </dl>
        <div className="market">
          <div className="panel-head">
            <h3 className="h-market">Market</h3>
            <Badge tone={paused ? "urucum" : "canopy"}>{paused ? "Market paused" : "Market open"}</Badge>
          </div>
          <p className="muted">
            {paused
              ? "No new offers or orders anywhere. Orders already in escrow continue and every refund path stays open."
              : "Farmers publish and customers order at every warehouse. Pausing stops anything new from starting."}
          </p>
          <div>
            <Button variant={paused ? "primary" : "danger"} onClick={togglePause}>
              {paused ? "Open the market" : "Pause the market"}
            </Button>
          </div>
        </div>
        {d.config && wallet ? (
          <span className="note">
            Fees go to the logistics wallet <Address value={d.config.data.logisticsWallet} copy={false} />.
          </span>
        ) : null}
      </>
    );
  }

  const log = [
    ...d.orders.map((o) => ({ at: Number(o.createdAt), text: `#${o.id} escrowed ${formatMinor(o.total, o.decimals)} ${mintSymbol(o.mint)} at ${o.warehouse}${o.pickup ? ", pickup" : ""}` })),
    ...fb.log,
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);

  return (
    <GameFrame
      variant="map"
      hud={
        <>
          <HudLogo />
          {hudBase(`${whs.length} ${whs.length === 1 ? "warehouse" : "warehouses"}`)}
          <Badge tone={paused ? "urucum" : "canopy"}>{paused ? "Market paused" : "Market open"}</Badge>
          <div className="hud-money hud-money-held">
            <span>In escrow, all warehouses</span>
            <Money totals={d.held} symbol={firstSymbol} />
          </div>
          <Button variant="primary" size="sm" icon="plus" onClick={startFound}>
            Found a warehouse
          </Button>
          <HudMe role="admin" name="Program admin" idle="Holding the key" />
        </>
      }
      leftLabel="Warehouses"
      leftCount={String(whs.length)}
      left={
        <>
          <h2 className="h-side">Warehouses</h2>
          {whs.map((w) => {
            const built = phaseOf(w) === "done";
            return (
              <button type="button" className="quest" key={w.address} onClick={pick(`w:${w.address}`)}>
                <span className={`dot ${!built ? "dot-build" : paused ? "dot-stop" : "dot-go"}`} />
                <span>
                  <b>{w.name}</b>
                  <span className="note">{!built ? "being built" : `fee ${pct(w.account.data.feeBps)} · ${w.farmers} ${w.farmers === 1 ? "farmer" : "farmers"}`}</span>
                </span>
              </button>
            );
          })}
          {whs.length ? null : <p className="muted">No warehouse yet.</p>}
          <Button icon="plus" onClick={startFound}>
            Found a warehouse
          </Button>
          <span className="note">Or pick any “+” plot on the map. The map grows a ring of new plots around every warehouse you open.</span>
          <h3 className="h-sub">Program log</h3>
          <ol className="log">
            {log.map((l, n) => (
              <li key={`${l.at}-${n}-${l.text}`}>
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
          <svg aria-hidden="true" width={g.W} height={g.H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <g className="ground" style={{ transform: `translate(${g.ox.toFixed(1)}px, ${g.oy.toFixed(1)}px)` }}>
              <g className="plate">
                <polygon
                  points={pts([
                    [g.x0, 0, g.z1],
                    [g.x1, 0, g.z1],
                    [g.x1, -0.35, g.z1],
                    [g.x0, -0.35, g.z1],
                  ])}
                  fill="#86a86d"
                />
                <polygon
                  points={pts([
                    [g.x1, 0, g.z0],
                    [g.x1, 0, g.z1],
                    [g.x1, -0.35, g.z1],
                    [g.x1, -0.35, g.z0],
                  ])}
                  fill="#759a5c"
                />
                <polygon
                  points={pts([
                    [g.x0, 0, g.z0],
                    [g.x1, 0, g.z0],
                    [g.x1, 0, g.z1],
                    [g.x0, 0, g.z1],
                  ])}
                  fill="#a8c98c"
                />
              </g>
              {plotShapes}
              {roadEls}
            </g>
          </svg>
          {trees}
          {whSprites}
          {truckEls}
          <img src={MAP.admin.src} alt="" className="admin-walker" style={{ left: admin.left, top: admin.top, zIndex: admin.zIndex }} />
          {paused ? <div className="paused-veil" aria-hidden="true" /> : null}
          {plotBtns}
          {pins}
        </>
      }
      hint="Drag to move · scroll to zoom · “+” to build"
      broto={fb.broto}
      toast={fb.toast}
    />
  );
}
