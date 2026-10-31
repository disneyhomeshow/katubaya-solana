// Design: "Farmer · My offers" (FarmerOffers, MobileFarmerOffers). deactivate_offer.
import { Link } from "react-router-dom";
import { unwrapOption } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { cropTitle, enrichOffers, type OfferView } from "../../components/offers";
import { isOpen } from "../../components/orders";
import { LoadError, Loading, NetworkNotices } from "../../components/States";
import { Amount, Badge, Button, EmptyState, Notice, OfferPhoto, Table, formatQty, type TableColumn } from "../../design-system";
import { getDeactivateOfferInstruction } from "../../generated";
import { mintSymbol } from "../../config";
import { listOffersByFarmer, listOrdersByFarmer } from "../../solana/accounts";
import { formatOfferExpiry, nowSeconds } from "../../solana/format";
import { NETWORK_FEE } from "../../solana/rent";
import { asUnitCode, pricePerShownUnit, unitOf } from "../../solana/units";
import { useAsync } from "../../state/useAsync";
import { useTx, type TxRequest } from "../../tx/TxProvider";
import { FarmerGate, type ApprovedFarmer } from "./FarmerGate";

const WEEK = 7n * 24n * 60n * 60n;

export function offerState(view: OfferView): { tone: "canopy" | "muted"; label: string } {
  const o = view.account.data;
  if (!o.active) return { tone: "muted", label: "Deactivated" };
  if (view.expired) return { tone: "muted", label: "Expired" };
  if (o.qtyRemaining === 0n) return { tone: "muted", label: "Sold out" };
  return { tone: "canopy", label: "Active" };
}

export function deactivateRequest(view: OfferView, reserved: string | null, refresh: () => Promise<unknown>): TxRequest {
  return {
    title: "Deactivate offer",
    instruction: "deactivate_offer",
    description: `${cropTitle(view.account.data)} stops taking new orders right away.${reserved ? ` The ${reserved} in open orders stays with those orders and is paid out as usual.` : ""} This can't be undone; publish a new offer to sell again.`,
    lines: [{ label: "Network fee", value: NETWORK_FEE }],
    build: async (signer) => [getDeactivateOfferInstruction({ offer: view.account.address, farmer: signer })],
    onConfirmed: () => refresh().then(() => undefined),
  };
}

function OffersPage({ wallet, farmer, warehouse }: ApprovedFarmer) {
  const run = useTx();
  const data = useAsync(async () => {
    const [offers, orders] = await Promise.all([listOffersByFarmer(wallet), listOrdersByFarmer(wallet)]);
    const reserved = new Map<string, bigint>();
    for (const o of orders) {
      if (isOpen(o.data.status)) reserved.set(o.data.offer, (reserved.get(o.data.offer) ?? 0n) + o.data.qty);
    }
    return { offers: await enrichOffers(offers), reserved };
  }, [wallet]);
  const name = warehouse?.data.name ?? "your warehouse";
  const now = nowSeconds();
  const offers = data.data?.offers ?? [];
  const reservedOf = (v: OfferView) => {
    const q = data.data?.reserved.get(v.account.address);
    return q ? formatQty(q.toString(), asUnitCode(v.account.data.unitCode)) : null;
  };
  const expiringSoon = offers.filter((v) => {
    const at = unwrapOption(v.account.data.expiresAt);
    return v.account.data.active && !v.expired && at != null && at - now <= WEEK;
  });

  const cols: TableColumn<OfferView>[] = [
    {
      key: "crop",
      header: "Offer",
      render: (r) => (
        <div className="cell-offer">
          <OfferPhoto size="thumb" alt={`Photo of ${cropTitle(r.account.data)}`} />
          <Link to={`/farmer/offers/${r.account.address}`} style={{ fontWeight: 500 }}>
            {cropTitle(r.account.data)}
          </Link>
        </div>
      ),
    },
    {
      key: "left",
      header: "Left",
      align: "right",
      render: (r) => <span className="kb-amount">{formatQty(r.account.data.qtyRemaining.toString(), asUnitCode(r.account.data.unitCode))}</span>,
    },
    { key: "reserved", header: "Reserved in orders", align: "right", render: (r) => <span className="kb-amount">{reservedOf(r) ?? "—"}</span> },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (r) => (
        <Amount
          minor={pricePerShownUnit(r.account.data.priceMinor, r.account.data.unitCode)}
          decimals={r.mint?.decimals ?? 6}
          symbol={`${mintSymbol(r.account.data.mint)} / ${unitOf(r.account.data.unitCode).short}`}
        />
      ),
    },
    {
      key: "expires",
      header: "Expires",
      render: (r) => {
        const at = unwrapOption(r.account.data.expiresAt);
        return at != null ? formatOfferExpiry(at) : "—";
      },
    },
    {
      key: "state",
      header: "Status",
      render: (r) => {
        const s = offerState(r);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (r) => (
        <div className="cell-actions">
          <Link to={`/farmer/offers/${r.account.address}`} className="kb-btn kb-btn-secondary kb-btn-sm">
            Manage
          </Link>
          {r.account.data.active ? (
            <Button size="sm" variant="quiet" onClick={() => run(deactivateRequest(r, reservedOf(r), data.reload))}>
              Deactivate
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Layout area="farmer">
      <div className="page">
        <NetworkNotices showPaused />
        <div className="row-end">
          <div className="stack gap-2">
            <h1 className="t-display">{farmer.data.displayName}</h1>
            <div className="row">
              <Badge tone="canopy">Approved by {name}</Badge>
              <span className="t-small muted">Your offers are visible to every customer {name} has confirmed.</span>
            </div>
          </div>
          <Link to="/farmer/publish" className="kb-btn kb-btn-primary">
            Publish offer
          </Link>
        </div>
        <section className="stack gap-4">
          <div className="row-baseline">
            <h2 className="t-heading">Your offers</h2>
            <span className="t-small muted">
              Stock is reserved the moment a customer orders and returns if the order is canceled, refused or expires.
            </span>
          </div>
          {data.error ? <LoadError error={data.error} onRetry={data.reload} /> : null}
          {data.loading && !data.data ? <Loading /> : null}
          {data.data && !offers.length ? (
            <EmptyState
              icon="leaf"
              title="No offers yet"
              action={
                <Link to="/farmer/publish" className="kb-btn kb-btn-secondary">
                  Publish offer
                </Link>
              }
            >
              Publish your first lot to see it here.
            </EmptyState>
          ) : null}
          {offers.length ? <Table columns={cols} rows={offers} rowKey={(r) => r.account.address} caption="Your offers" /> : null}
        </section>
        {expiringSoon.map((v) => (
          <Notice
            key={v.account.address}
            tone="warning"
            title={`${cropTitle(v.account.data)} expires ${formatOfferExpiry(unwrapOption(v.account.data.expiresAt)!)}`}
            action={
              <Link to={`/farmer/publish?from=${v.account.address}`} className="kb-btn kb-btn-secondary kb-btn-sm">
                Publish again
              </Link>
            }
          >
            After it expires customers can no longer order it. Publish a new offer with the stock you still have.
          </Notice>
        ))}
      </div>
    </Layout>
  );
}

export function FarmerOffers() {
  return <FarmerGate>{(f) => <OffersPage {...f} />}</FarmerGate>;
}
