// Design: "Farmer · Create profile" (FarmerRegister). register_farmer.
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { Account } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { ConnectFirst, LoadError, Loading, NetworkNotices } from "../../components/States";
import { Address, Button, Field, Notice } from "../../design-system";
import { getRegisterFarmerInstructionAsync, type Warehouse } from "../../generated";
import { listWarehouses } from "../../solana/accounts";
import { formatFeeBps } from "../../solana/format";
import { formatSol, NETWORK_FEE, rentOf, SIZE } from "../../solana/rent";
import { byteLength } from "../../solana/units";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useTx } from "../../tx/TxProvider";

const MAX_NAME = 100;
const MAX_URI = 200;

export function FarmerRegister() {
  const { wallet, profile, loading, reload } = useSession();
  const navigate = useNavigate();
  const run = useTx();
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [warehouseAddr, setWarehouseAddr] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const warehouses = useAsync(listWarehouses, []);
  const rent = useAsync(() => rentOf(SIZE.farmerProfile), []);

  if (wallet && !loading && profile?.farmer) return <Navigate to="/farmer" replace />;

  const list = warehouses.data ?? [];
  const selected: Account<Warehouse> | undefined = list.find((w) => w.address === warehouseAddr);
  const trimmedName = name.trim();
  const trimmedLink = link.trim();
  const nameError = touched && !trimmedName ? "Enter your farm's name." : byteLength(trimmedName) > MAX_NAME ? `Up to ${MAX_NAME} bytes. Shorten the name.` : undefined;
  const linkError =
    trimmedLink && !/^https?:\/\/\S+$/i.test(trimmedLink)
      ? "Use a full link starting with https://"
      : byteLength(trimmedLink) > MAX_URI
        ? `Up to ${MAX_URI} bytes. Use a shorter link.`
        : undefined;
  const ready = !!wallet && !!trimmedName && !nameError && !linkError && !!selected;

  const submit = () => {
    setTouched(true);
    if (!ready || !selected) return;
    run({
      title: `Create profile and ask ${selected.data.name}`,
      instruction: "register_farmer",
      description: `Creates your public farmer profile and asks ${selected.data.name} to approve you. No funds move.`,
      lines: [
        ...(rent.data != null ? [{ label: "Profile account rent", value: formatSol(rent.data), note: "Stays with your profile on Solana" }] : []),
        { label: "Network fee", value: NETWORK_FEE },
      ],
      build: async (signer) => [
        await getRegisterFarmerInstructionAsync({
          warehouse: selected.address,
          farmer: signer,
          displayName: trimmedName,
          publicProfileUri: trimmedLink,
        }),
      ],
      onConfirmed: () => reload(),
      onDone: () => navigate("/farmer/pending"),
      doneLabel: "Continue",
    });
  };

  return (
    <Layout area="onboarding">
      <div className="page page-tight">
        <Link to="/start" className="back-link">
          Back
        </Link>
        <NetworkNotices />
        <div className="stack gap-2 measure-wide">
          <span className="t-small muted">Farmer profile</span>
          <h1 className="t-display">Tell customers who you are</h1>
          <p className="t-body muted">
            Your profile is public: customers see your farm's name and key on every offer. Nothing here ranks or rates you.
          </p>
        </div>
        {!wallet ? (
          <ConnectFirst title="Connect a wallet to create your profile">
            Your farmer profile lives on Solana under your wallet, and payouts go straight to it.
          </ConnectFirst>
        ) : (
          <div className="split split-wide">
            <form
              className="split-main stack gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Field label="Farm name" hint="Up to 100 bytes. Can't be changed later, so use the name people know you by." error={nameError}>
                <input className="kb-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} autoComplete="organization" />
              </Field>
              <Field
                label="Public profile link"
                optional
                hint="A page about your farm — a website or Instagram. Shown as a link under your name."
                error={linkError}
              >
                <input className="kb-input" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
              </Field>
              <fieldset className="choice-group">
                <legend>Warehouse that will deliver your harvest</legend>
                <span className="t-small muted" style={{ marginBottom: 4 }}>
                  The warehouse approves you before you can publish, and routes every offer you make.
                </span>
                {warehouses.error ? <LoadError error={warehouses.error} onRetry={warehouses.reload} /> : null}
                {warehouses.loading && !warehouses.data ? <Loading /> : null}
                {warehouses.data && !list.length ? (
                  <Notice tone="info" title="No warehouses yet">
                    The program admin hasn't created any warehouse on this network. Check back later.
                  </Notice>
                ) : null}
                {list.map((w) => (
                  <label key={w.address} className="choice">
                    <input type="radio" name="wh" checked={warehouseAddr === w.address} onChange={() => setWarehouseAddr(w.address)} />
                    <span className="choice-body">
                      <span className="choice-title">{w.data.name}</span>
                      <span className="t-small muted">
                        Service fee {formatFeeBps(w.data.feeBps)}
                        {w.data.pickupNotes ? ` · ${w.data.pickupNotes}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
                {touched && !selected && list.length ? <span className="kb-error">Pick the warehouse that will deliver your harvest.</span> : null}
              </fieldset>
              <div className="row">
                <Button type="submit" variant="primary" size="lg" disabled={!wallet}>
                  {selected ? `Create profile and ask ${selected.data.name}` : "Create profile"}
                </Button>
              </div>
              <span className="t-small muted">Your wallet approves one transaction and pays the profile account's rent.</span>
            </form>
            <aside aria-label="How customers will see you" className="split-side card stack gap-4">
              <span className="t-small muted">How customers will see you on an offer</span>
              <div className="stack" style={{ gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{trimmedName || "Your farm's name"}</span>
                <Address value={wallet} copy={false} />
              </div>
              <span className="t-small muted">{selected ? `Via ${selected.data.name}` : "Via your warehouse"}</span>
              <hr className="divider" />
              <p className="t-small" style={{ margin: 0 }}>
                {selected
                  ? `${selected.data.name} takes its ${formatFeeBps(selected.data.feeBps)} service fee from each sale when the order is fulfilled. You receive the rest, straight to this wallet.`
                  : "The warehouse's service fee is taken from each sale when the order is fulfilled. You receive the rest, straight to this wallet."}
              </p>
            </aside>
          </div>
        )}
      </div>
    </Layout>
  );
}
