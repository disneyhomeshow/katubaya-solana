// Design: "Farmer · Manage an offer" (FarmerManageOffer). deactivate_offer.
import { Link, useParams } from "react-router-dom";
import { address as toAddress, isAddress, unwrapOption } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { enrichOffers } from "../../components/offers";
import { isOpen, STATUS_CODE } from "../../components/orders";
import { LoadError, Loading, NetworkNotices } from "../../components/States";
import { Address, Amount, Badge, Button, EmptyState, Notice, OrderStatus as Status, Table, formatQty, type TableColumn } from "../../design-system";
import type { Order } from "../../generated";
import { FulfillmentMode } from "../../generated";
import { mintSymbol } from "../../config";
import { fetchOffer, listOrdersByOffer, type Account } from "../../solana/accounts";
import { formatDay, formatOfferExpiry } from "../../solana/format";
import { asUnitCode, pricePerShownUnit, unitOf } from "../../solana/units";
import { useAsync } from "../../state/useAsync";
import { useTx } from "../../tx/TxProvider";
import { FarmerGate, type ApprovedFarmer } from "./FarmerGate";
import { deactivateRequest, offerState } from "./Offers";

function ManagePage({ wallet, warehouse }: ApprovedFarmer) {
  const { offer: param = "" } = useParams();
  const offerAddress = isAddress(param) ? toAddress(param) : null;
  const run = useTx();
  const data = useAsync(async () => {
    if (!offerAddress) return null;
    const offer = await fetchOffer(offerAddress);
    if (!offer) return null;
    const [[view], orders] = await Promise.all([enrichOffers([offer]), listOrdersByOffer(offerAddress)]);
    return { view, orders };
  }, [offerAddress]);

  if (!offerAddress || (data.data === null && !data.loading) || (data.data && data.data.view.account.data.farmer !== wallet)) {
    return (
      <Layout area="farmer">
        <div className="page page-tight">
          <Link to="/farmer" className="back-link">
            Back to my offers
          </Link>
          <Notice tone="warning" title="This isn't one of your offers">
            The link may be wrong, or the offer belongs to another wallet.
          </Notice>
        </div>
      </Layout>
    );
  }
  if (!data.data) {
    return (
      <Layout area="farmer">
        <div className="page page-tight">{data.error ? <LoadError error={data.error} onRetry={data.reload} /> : <Loading />}</div>
      </Layout>
    );
  }

  const { view, orders } = data.data;
  const o = view.account.data;
  const code = asUnitCode(o.unitCode);
  const unit = unitOf(o.unitCode);
  const symbol = mintSymbol(o.mint);
  const decimals = view.mint?.decimals ?? 6;
  const state = offerState(view);
  const expiresAt = unwrapOption(o.expiresAt);
  const cultivar = unwrapOption(o.cultivarName);
  const reservedQty = orders.filter((r) => isOpen(r.data.status)).reduce((sum, r) => sum + r.data.qty, 0n);
  const reserved = reservedQty > 0n ? formatQty(reservedQty.toString(), code) : null;
  const name = warehouse?.data.name ?? "your warehouse";

  const cols: TableColumn<Account<Order>>[] = [
    { key: "id", header: "Order", width: "120px", render: (r) => `#${r.data.orderId}` },
    { key: "qty", header: "Quantity", align: "right", render: (r) => <span className="kb-amount">{formatQty(r.data.qty.toString(), code)}</span> },
    { key: "mode", header: "Fulfillment", render: (r) => (r.data.fulfillmentMode === FulfillmentMode.Delivery ? "Delivery" : "Pickup") },
    {
      key: "total",
      header: "Subtotal",
      align: "right",
      render: (r) => <Amount minor={r.data.subtotalMinor} decimals={decimals} symbol={symbol} escrow={isOpen(r.data.status)} />,
    },
    { key: "status", header: "Status", render: (r) => <Status status={STATUS_CODE[r.data.status]} /> },
  ];

  return (
    <Layout area="farmer">
      <div className="page page-tight">
        <Link to="/farmer" className="back-link">
          Back to my offers
        </Link>
        <NetworkNotices />
        <div className="row-between">
          <div className="stack gap-2">
            <div className="row">
              <h1 className="t-display">
                {o.cropName} {cultivar ? <span className="cultivar">{cultivar}</span> : null}
              </h1>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <span className="muted">
              Published {formatDay(o.createdAt)} through {name} · {expiresAt != null ? `expires ${formatOfferExpiry(expiresAt)}` : "no expiry"} · offer{" "}
              <Address value={view.account.address} />
            </span>
          </div>
          <Link to={`/offers/${view.account.address}`} className="kb-btn kb-btn-secondary">
            See it as customers do
          </Link>
        </div>
        <div className="split">
          <div className="split-main stack gap-5" style={{ flexBasis: 520 }}>
            <section className="stack gap-3">
              <div className="row-baseline">
                <h2 className="t-heading">Orders on this offer</h2>
                <span className="t-small muted">{reserved ? `${reserved} reserved in open orders` : "Nothing reserved in open orders"}</span>
              </div>
              {orders.length ? (
                <Table columns={cols} rows={orders} rowKey={(r) => r.address} caption={`Orders on ${o.cropName}`} />
              ) : (
                <EmptyState icon="package" title="No orders yet">
                  Orders appear here as customers buy. Customer addresses are held by the warehouse and never shown to you.
                </EmptyState>
              )}
            </section>
          </div>
          <aside className="split-side stack gap-5" style={{ flexBasis: 360 }}>
            <section className="card stack gap-4">
              <h2 className="t-heading">Price and stock</h2>
              <dl className="rows inset">
                <div>
                  <dt>Price per {unit.short}</dt>
                  <dd>
                    <Amount minor={pricePerShownUnit(o.priceMinor, o.unitCode)} decimals={decimals} symbol={symbol} />
                  </dd>
                </div>
                <div>
                  <dt>Customers can order</dt>
                  <dd className="t-data">{formatQty(o.qtyRemaining.toString(), code)}</dd>
                </div>
                <div>
                  <dt>Reserved in open orders</dt>
                  <dd className="t-data" style={{ fontWeight: 400 }}>
                    {reserved ?? "—"}
                  </dd>
                </div>
              </dl>
              <span className="t-small muted">
                Price and stock are fixed once an offer is published; orders already placed keep the price they paid into escrow. To sell at another
                price or quantity, publish a new offer.
              </span>
              <div>
                <Link to={`/farmer/publish?from=${view.account.address}`} className="kb-btn kb-btn-secondary">
                  Publish again
                </Link>
              </div>
            </section>
            <section className="card stack gap-3">
              <h2 className="t-heading">Stop selling</h2>
              {o.active ? (
                <>
                  <p className="t-body muted">
                    Deactivating stops new orders right away.
                    {reserved ? ` The ${reserved} in open orders stays with those orders and is paid out as usual.` : ""}
                  </p>
                  <div>
                    <Button variant="danger" onClick={() => run(deactivateRequest(view, reserved, data.reload))}>
                      Deactivate offer
                    </Button>
                  </div>
                </>
              ) : (
                <p className="t-body muted">This offer is deactivated. Customers can no longer order it; open orders continue as usual.</p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </Layout>
  );
}

export function FarmerManageOffer() {
  return <FarmerGate>{(f) => <ManagePage {...f} />}</FarmerGate>;
}
