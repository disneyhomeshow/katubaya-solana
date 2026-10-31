// Design: "Customer · Choose a warehouse" (CustomerRequest). register_customer + request_customer_confirmation.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { unwrapOption, type Account } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { ConnectFirst, LoadError, Loading, NetworkNotices } from "../../components/States";
import { Address, Badge, Button, Field, Notice } from "../../design-system";
import {
  WarehouseCustomerStatus,
  getRegisterCustomerInstructionAsync,
  getRequestCustomerConfirmationInstructionAsync,
  type Warehouse,
} from "../../generated";
import { listWarehouses } from "../../solana/accounts";
import { formatFeeBps } from "../../solana/format";
import { formatSol, NETWORK_FEE, rentOf, SIZE } from "../../solana/rent";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useTx } from "../../tx/TxProvider";

/** A warehouse delivers to a CEP when one of its prefixes matches the CEP's first `len` digits. */
export function deliversTo(warehouse: Warehouse, cepDigits: string): boolean {
  return warehouse.deliverZipPrefixes.some(
    (z) => cepDigits.length >= z.len && cepDigits.slice(0, z.len) === String(z.prefix).padStart(z.len, "0"),
  );
}

export function prefixList(warehouse: Warehouse): string {
  return warehouse.deliverZipPrefixes.map((z) => String(z.prefix).padStart(z.len, "0")).join(", ");
}

export function ChooseWarehouse() {
  const { wallet, profile, reload } = useSession();
  const navigate = useNavigate();
  const run = useTx();
  const [cep, setCep] = useState("");
  const warehouses = useAsync(listWarehouses, []);
  const rent = useAsync(async () => ({ profile: await rentOf(SIZE.customerProfile), link: await rentOf(SIZE.warehouseCustomer) }), []);

  const digits = cep.replace(/\D/g, "");
  const checking = digits.length >= 3;
  const list = warehouses.data ?? [];
  const delivering = checking ? list.filter((w) => deliversTo(w.data, digits)) : [];
  const linkOf = (w: Account<Warehouse>) => profile?.links.find((l) => l.link.data.warehouse === w.address);

  const ask = (w: Account<Warehouse>) => {
    if (!wallet) return;
    const newProfile = !profile?.customer;
    run({
      title: `Ask ${w.data.name} to confirm you`,
      instruction: newProfile ? "register_customer + request_customer_confirmation" : "request_customer_confirmation",
      description: newProfile
        ? `Creates your customer profile and a pending request to ${w.data.name}. No funds move.`
        : `Creates a pending request to ${w.data.name}. No funds move.`,
      lines: [
        ...(newProfile && rent.data ? [{ label: "Customer profile rent", value: formatSol(rent.data.profile), note: "Stays with your profile on Solana" }] : []),
        ...(rent.data ? [{ label: "Request account rent", value: formatSol(rent.data.link), note: "Stays with the request on Solana" }] : []),
        { label: "Network fee", value: NETWORK_FEE },
      ],
      build: async (signer) => [
        ...(newProfile ? [await getRegisterCustomerInstructionAsync({ customer: signer, publicProfileUri: null })] : []),
        await getRequestCustomerConfirmationInstructionAsync({ warehouse: w.address, customer: signer }),
      ],
      onConfirmed: () => reload(),
      onDone: () => navigate("/customer/pending"),
      doneLabel: "See what happens next",
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
          <span className="t-small muted">Customer profile · step 1 of 2</span>
          <h1 className="t-display">Choose a warehouse near you</h1>
          <p className="t-body muted">
            The warehouse delivers your orders and is the only one who will know your address. You ask once; it confirms you after you
            share your address with it directly.
          </p>
        </div>
        {!wallet ? (
          <ConnectFirst title="Connect a wallet to ask a warehouse">
            Your customer profile lives on Solana under your wallet. Katūbayá never holds your keys.
          </ConnectFirst>
        ) : (
          <>
            <div role="search" className="row" style={{ alignItems: "flex-end", gap: 16 }}>
              <Field
                label="Your CEP"
                hint="Only used here, in your browser, to show who delivers to you. It is never sent or stored."
                className="cep-field"
              >
                <input
                  className="kb-input kb-input-mono"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="00000-000"
                  value={cep}
                  onChange={(e) => setCep(e.target.value)}
                />
              </Field>
              <span className="t-small muted" style={{ paddingBottom: 28 }}>
                {list.length} {list.length === 1 ? "warehouse" : "warehouses"} · listed A–Z
              </span>
            </div>
            {warehouses.error ? <LoadError error={warehouses.error} onRetry={warehouses.reload} /> : null}
            {warehouses.loading && !warehouses.data ? <Loading /> : null}
            {warehouses.data && !list.length ? (
              <Notice tone="info" title="No warehouses yet">
                The program admin hasn't created any warehouse on this network. Check back later.
              </Notice>
            ) : null}
            <div className="stack gap-4">
              {list.map((w) => {
                const link = linkOf(w);
                const delivers = checking && deliversTo(w.data, digits);
                const highlight = delivers && delivering.length === 1;
                const rules = unwrapOption(w.data.deliveryFeeRulesUri);
                return (
                  <article key={w.address} className={`card warehouse${highlight ? " warehouse-delivers" : ""}`}>
                    <div className="stack gap-2" style={{ flex: "999 1 420px", minWidth: 0 }}>
                      <div className="row">
                        <h2 className="t-heading">{w.data.name}</h2>
                        {checking ? (
                          delivers ? (
                            <Badge tone="canopy">Delivers to your CEP</Badge>
                          ) : (
                            <Badge tone="muted">Pickup only for your CEP</Badge>
                          )
                        ) : null}
                      </div>
                      {w.data.pickupNotes ? <span className="muted">{w.data.pickupNotes}</span> : null}
                      <span className="t-small muted">
                        Service fee {formatFeeBps(w.data.feeBps)}
                        {w.data.deliverZipPrefixes.length ? ` · delivers to CEP ${prefixList(w.data)}` : " · pickup only"}
                        {rules ? (
                          <>
                            {" · "}
                            <a href={rules} target="_blank" rel="noreferrer">
                              delivery fee rules
                            </a>
                          </>
                        ) : null}
                        {" · operator "}
                        <Address value={w.data.operator} copy={false} />
                      </span>
                    </div>
                    {link ? (
                      link.link.data.status === WarehouseCustomerStatus.Confirmed ? (
                        <Link to="/market" className="kb-btn kb-btn-secondary">
                          Confirmed · see offers
                        </Link>
                      ) : link.link.data.status === WarehouseCustomerStatus.Pending ? (
                        <Link to="/customer/pending" className="kb-btn kb-btn-secondary">
                          Request pending
                        </Link>
                      ) : (
                        <Badge tone="urucum">Revoked</Badge>
                      )
                    ) : (
                      <Button variant={highlight ? "primary" : "secondary"} onClick={() => ask(w)}>
                        Ask to be confirmed
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
            <Notice tone="info" title={profile?.customer ? "One transaction, one account" : "One transaction, two accounts"}>
              {profile?.customer
                ? "Asking creates a pending request to the warehouse. Your wallet approves it once and pays the small rent for it."
                : "Asking creates your customer profile and a pending request to the warehouse. Your wallet approves it once and pays the small rent for both accounts."}
            </Notice>
          </>
        )}
      </div>
    </Layout>
  );
}
