// Design: "Customer · My orders" (CustomerOrders).
import { Link } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { enrichOrders, isOpen, isPastDeadline, modeLabel, orderTitle, orderTotal, STATUS_CODE, type OrderView } from "../../components/orders";
import { ConnectFirst, LoadError, Loading, NetworkNotices } from "../../components/States";
import { Amount, Badge, Button, EmptyState, Lifecycle, Notice, OfferPhoto, OrderStatus as Status, Table, formatMinor, type TableColumn } from "../../design-system";
import { FulfillmentMode, OrderStatus } from "../../generated";
import { mintSymbol } from "../../config";
import { listOrdersByCustomer } from "../../solana/accounts";
import { formatDay, formatDayTime, formatTime } from "../../solana/format";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useOrderActions } from "./orderActions";

/** An order waiting on the customer: a quote to answer, or a deadline that passed. */
function needsYou(view: OrderView): boolean {
  return view.account.data.status === OrderStatus.DeliveryQuoted || isPastDeadline(view.account.data);
}

function ActionCard({ view, refresh }: { view: OrderView; refresh: () => Promise<void> }) {
  const actions = useOrderActions(view, refresh);
  const o = view.account.data;
  const symbol = mintSymbol(o.mint);
  const decimals = view.mint?.decimals ?? 6;
  const amount = (minor: bigint) => `${formatMinor(minor, decimals)} ${symbol}`;
  const w = view.warehouse?.data.name ?? "The warehouse";
  const late = isPastDeadline(o);
  const delivery = o.fulfillmentMode === FulfillmentMode.Delivery;
  return (
    <section aria-label={`Order ${o.orderId}`} className="card stack gap-5">
      <div className="row-between">
        <div className="order-head" style={{ gap: 16 }}>
          <div className="order-thumb-sm">
            <OfferPhoto size="tile" alt={`Photo of ${orderTitle(view)}`} />
          </div>
          <div className="stack gap-1">
            <h2 className="t-title">
              <Link to={`/orders/${view.account.address}`} style={{ color: "inherit", textDecoration: "none" }}>
                Order #{o.orderId.toString()} · {orderTitle(view)}
              </Link>
            </h2>
            <span className="t-small muted">
              {view.farmer?.data.displayName ?? "Farmer"}, {delivery ? "delivery" : "pickup"} through {w} · placed {formatDayTime(o.createdAt)}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {late ? <Badge tone="amber">Past its deadline</Badge> : null}
          <Status status={STATUS_CODE[o.status]} />
        </div>
      </div>
      <Lifecycle mode={delivery ? "DELIVERY" : "PICKUP"} status={STATUS_CODE[o.status]} />
      <div className="split">
        <div className="split-main stack gap-4" style={{ flexBasis: 420 }}>
          {late ? (
            <>
              <Notice tone="warning" title={o.status === OrderStatus.DeliveryQuoted ? `The delivery quote expired at ${formatTime(o.expiresAt)}` : `The order passed its deadline`}>
                Close the order to get the money in escrow back. Anyone can close an expired order, so it may also close on its own; either way the
                refund goes only to your wallet.
              </Notice>
              <div className="row">
                <Button variant="primary" onClick={() => void actions.close()}>
                  Close and refund
                </Button>
                <span className="t-small muted">One transaction. You pay the network fee, about 0.000005 SOL.</span>
              </div>
            </>
          ) : (
            <>
              <Notice tone="warning" title={`${w} quoted a delivery fee of ${amount(o.deliveryFeeMinor)}`}>
                Accept to add it to escrow, or reject and your {amount(o.subtotalMinor)} subtotal comes back to you. The quote expires{" "}
                {formatDay(o.expiresAt)} at {formatTime(o.expiresAt)}.
              </Notice>
              <div className="row">
                <Button variant="primary" onClick={() => void actions.accept()}>
                  Accept delivery fee
                </Button>
                <Button onClick={() => void actions.reject()}>Reject and refund</Button>
              </div>
            </>
          )}
        </div>
        <dl className="split-side rows inset" style={{ flexBasis: 300 }}>
          <div>
            <dt>Subtotal, in escrow</dt>
            <dd>
              <Amount minor={o.subtotalMinor} decimals={decimals} symbol={symbol} escrow />
            </dd>
          </div>
          {o.status === OrderStatus.DeliveryQuoted ? (
            <>
              <div>
                <dt>Delivery fee, if accepted</dt>
                <dd>
                  <Amount minor={o.deliveryFeeMinor} decimals={decimals} symbol={symbol} />
                </dd>
              </div>
              <div className="rows-total">
                <dt>Total</dt>
                <dd>
                  <Amount minor={o.subtotalMinor + o.deliveryFeeMinor} decimals={decimals} symbol={symbol} />
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
    </section>
  );
}

export function Orders() {
  const { wallet } = useSession();
  const orders = useAsync(async () => (wallet ? enrichOrders(await listOrdersByCustomer(wallet)) : []), [wallet], 30000);
  const list = orders.data ?? [];
  // At most one primary action per view: the first order waiting on the customer gets the card.
  const featured = list.find(needsYou);

  const cols: TableColumn<OrderView>[] = [
    {
      key: "id",
      header: "Order",
      width: "120px",
      render: (r) => <Link to={`/orders/${r.account.address}`}>#{r.account.data.orderId.toString()}</Link>,
    },
    {
      key: "offer",
      header: "Offer",
      render: (r) => (
        <div className="cell-offer">
          <OfferPhoto size="thumb" alt={`Photo of ${orderTitle(r)}`} />
          {orderTitle(r)}
        </div>
      ),
    },
    { key: "farmer", header: "Farmer", render: (r) => r.farmer?.data.displayName ?? "—" },
    { key: "mode", header: "Fulfillment", render: (r) => modeLabel(r.account.data) },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (r) => (
        <Amount minor={orderTotal(r.account.data)} decimals={r.mint?.decimals ?? 6} symbol={mintSymbol(r.account.data.mint)} escrow={isOpen(r.account.data.status)} />
      ),
    },
    { key: "status", header: "Status", render: (r) => <Status status={STATUS_CODE[r.account.data.status]} /> },
  ];

  return (
    <Layout area="customer">
      <div className="page">
        <NetworkNotices />
        <h1 className="t-display">My orders</h1>
        {!wallet ? (
          <ConnectFirst title="Connect a wallet to see your orders">Your orders live on Solana under your wallet. Katūbayá never holds your keys.</ConnectFirst>
        ) : (
          <>
            {orders.error ? <LoadError error={orders.error} onRetry={orders.reload} /> : null}
            {orders.loading && !orders.data ? <Loading /> : null}
            {featured ? <ActionCard view={featured} refresh={orders.reload} /> : null}
            {orders.data && !list.length ? (
              <EmptyState
                icon="package"
                title="No orders yet"
                action={
                  <Link to="/market" className="kb-btn kb-btn-secondary">
                    Browse the market
                  </Link>
                }
              >
                Orders you place appear here, with where each one stands.
              </EmptyState>
            ) : null}
            {list.length ? (
              <section className="stack gap-4">
                <h2 className="t-heading">All orders</h2>
                <Table
                  columns={cols}
                  rows={list}
                  rowKey={(r) => r.account.address}
                  selected={featured?.account.address}
                  caption="Your orders"
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </Layout>
  );
}
