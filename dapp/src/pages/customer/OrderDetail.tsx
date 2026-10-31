// Design: "Customer · Order placed" and "Refused and expired orders" (CustomerPlaced, CustomerClosed).
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { address as toAddress, isAddress } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { enrichOrders, isPastDeadline, modeLabel, orderQty, orderTitle, STATUS_CODE } from "../../components/orders";
import { ConnectFirst, LoadError, Loading, NetworkNotices } from "../../components/States";
import { Address, Amount, Badge, Button, Icon, Lifecycle, Notice, OfferPhoto, OrderStatus as Status, formatMinor } from "../../design-system";
import { FulfillmentMode, OrderStatus } from "../../generated";
import { explorerUrl, mintSymbol } from "../../config";
import { escrowOf, fetchOrder, tokenBalance } from "../../solana/accounts";
import { formatDay, formatDayTime, formatFeeBps, formatTime } from "../../solana/format";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useOrderActions } from "./orderActions";

function NextSteps({ items }: { items: { title: string; text: ReactNode; done?: boolean }[] }) {
  return (
    <ol className="steps steps-loose">
      {items.map((s, i) => (
        <li key={s.title}>
          <span className={`step-node${s.done ? " step-node-done" : ""}`}>{s.done ? <Icon name="check" size={14} /> : i + 1}</span>
          <div className="step-text">
            <span style={{ fontWeight: 500 }}>{s.title}</span>
            <span className="muted">{s.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OrderDetail() {
  const { order: param = "" } = useParams();
  const location = useLocation();
  const placed = (location.state as { placed?: string } | null)?.placed;
  const orderAddress = isAddress(param) ? toAddress(param) : null;
  const { wallet } = useSession();

  const data = useAsync(async () => {
    if (!orderAddress) return null;
    const order = await fetchOrder(orderAddress);
    if (!order) return null;
    const [view] = await enrichOrders([order]);
    const escrow = await escrowOf(orderAddress);
    return { view, escrow, held: (await tokenBalance(escrow)) ?? 0n };
  }, [orderAddress], 30000);
  const actions = useOrderActions(data.data?.view, data.reload);

  if (!wallet) {
    return (
      <Layout area="customer">
        <div className="page">
          <ConnectFirst title="Connect a wallet to see your orders">Your orders live on Solana under your wallet. Katūbayá never holds your keys.</ConnectFirst>
        </div>
      </Layout>
    );
  }
  if (!orderAddress || (data.data === null && !data.loading)) {
    return (
      <Layout area="customer">
        <div className="page page-tight">
          <Link to="/orders" className="back-link">
            All orders
          </Link>
          <Notice tone="warning" title="This order doesn't exist">
            The link may be wrong, or the order is on another network.
          </Notice>
        </div>
      </Layout>
    );
  }
  if (!data.data) {
    return (
      <Layout area="customer">
        <div className="page page-tight">{data.error ? <LoadError error={data.error} onRetry={data.reload} /> : <Loading />}</div>
      </Layout>
    );
  }

  const { view, escrow, held } = data.data;
  const o = view.account.data;
  const symbol = mintSymbol(o.mint);
  const decimals = view.mint?.decimals ?? 6;
  const amount = (minor: bigint) => `${formatMinor(minor, decimals)} ${symbol}`;
  const w = view.warehouse?.data.name ?? "The warehouse";
  const farmer = view.farmer?.data.displayName ?? "the farmer";
  const delivery = o.fulfillmentMode === FulfillmentMode.Delivery;
  const status = STATUS_CODE[o.status];
  const late = isPastDeadline(o);
  const ended = [OrderStatus.Fulfilled, OrderStatus.Refused, OrderStatus.Canceled, OrderStatus.Expired].includes(o.status);
  const mine = o.customer === wallet;
  const payout = o.subtotalMinor - o.serviceFeeMinor;
  const fee = view.warehouse ? formatFeeBps(view.warehouse.data.feeBps) : "service";
  const released: { title: string; text: ReactNode } = {
    title: "Delivered, then released",
    text: `${w} marks it fulfilled and the escrow pays out: ${amount(payout)} to ${farmer}, the ${fee} service fee${delivery ? " and the delivery fee" : ""} to the program’s logistics wallet.`,
  };

  let body: ReactNode = null;
  if (late) {
    const what =
      o.status === OrderStatus.DeliveryQuoted
        ? `The delivery quote expired at ${formatTime(o.expiresAt)}`
        : o.status === OrderStatus.PendingDeliveryQuote
          ? `No quote arrived by ${formatTime(o.expiresAt)}`
          : `${w} didn’t move the order by ${formatDayTime(o.expiresAt)}`;
    body = (
      <>
        <Notice tone="warning" title={what}>
          {o.status === OrderStatus.DeliveryQuoted ? "It can’t be accepted any more. " : ""}Close the order to get your {amount(held)} back.
          Anyone can close an expired order, so it may also close on its own; either way the refund goes only to your wallet.
        </Notice>
        {mine ? (
          <div className="row">
            <Button variant="primary" onClick={() => void actions.close()}>
              Close and refund
            </Button>
            <span className="t-small muted">One transaction. You pay the network fee, about 0.000005 SOL.</span>
          </div>
        ) : null}
      </>
    );
  } else if (o.status === OrderStatus.DeliveryQuoted) {
    body = (
      <>
        <Notice tone="warning" title={`${w} quoted a delivery fee of ${amount(o.deliveryFeeMinor)}`}>
          Accept to add it to escrow, or reject and your {amount(o.subtotalMinor)} subtotal comes back to you. The quote expires{" "}
          {formatDay(o.expiresAt)} at {formatTime(o.expiresAt)}.
        </Notice>
        {mine ? (
          <div className="row">
            <Button variant="primary" onClick={() => void actions.accept()}>
              Accept delivery fee
            </Button>
            <Button onClick={() => void actions.reject()}>Reject and refund</Button>
          </div>
        ) : null}
      </>
    );
  } else if (o.status === OrderStatus.PendingDeliveryQuote) {
    body = (
      <>
        <NextSteps
          items={[
            {
              title: `${w} quotes the delivery fee`,
              text: `By ${formatDayTime(o.expiresAt)}. It appears on this page; you accept it into escrow or reject it and get the ${amount(o.subtotalMinor)} back.`,
            },
            { title: "The order leaves the warehouse", text: `${w} marks it in transit. From then on it can no longer be canceled.` },
            released,
          ]}
        />
        <Notice tone="info" title={`If no quote arrives by ${formatTime(o.expiresAt)}`}>
          The order can be closed as expired and the full {amount(o.subtotalMinor)} comes back to your wallet, with the {orderQty(view)}{" "}
          returned to the farmer’s offer.
        </Notice>
      </>
    );
  } else if (o.status === OrderStatus.EscrowedPickup || o.status === OrderStatus.EscrowedReady) {
    body = (
      <>
        <NextSteps
          items={[
            o.status === OrderStatus.EscrowedReady
              ? { title: "Delivery fee accepted", text: `${amount(o.subtotalMinor + o.deliveryFeeMinor)} is held in escrow.`, done: true }
              : {
                  title: `Collect it at ${w}`,
                  text: `${view.warehouse?.data.pickupNotes ? `${view.warehouse.data.pickupNotes}. ` : ""}Mention the wallet ending in ${o.customer.slice(-4)}.`,
                },
            {
              title: o.status === OrderStatus.EscrowedReady ? "The order leaves the warehouse" : "The warehouse hands it over",
              text: `${w} marks it in transit. From then on it can no longer be canceled.`,
            },
            released,
          ]}
        />
        <Notice tone="info" title={`If ${w} doesn’t move it by ${formatDayTime(o.expiresAt)}`}>
          The order can be closed as expired and everything in escrow comes back to your wallet.
        </Notice>
      </>
    );
  } else if (o.status === OrderStatus.InTransit) {
    body = (
      <>
        <Notice tone="info" title="On its way">
          {w} marked the order in transit. It can no longer be canceled; the escrow is released when {w} marks it fulfilled.
        </Notice>
        <NextSteps
          items={[
            { title: "In transit", text: `${w} is moving the ${orderQty(view)}.`, done: true },
            released,
          ]}
        />
      </>
    );
  } else if (o.status === OrderStatus.Fulfilled) {
    body = (
      <>
        <Notice tone="success" title="Delivered and released">
          {w} marked the order fulfilled and the escrow paid out. The order is complete.
        </Notice>
        <dl className="rows inset">
          <div>
            <dt>Paid to {farmer}</dt>
            <dd>
              <Amount minor={payout} decimals={decimals} symbol={symbol} />
            </dd>
          </div>
          <div>
            <dt>Service fee, {fee}</dt>
            <dd>
              <Amount minor={o.serviceFeeMinor} decimals={decimals} symbol={symbol} />
            </dd>
          </div>
          {delivery ? (
            <div>
              <dt>Delivery fee</dt>
              <dd>
                <Amount minor={o.deliveryFeeMinor} decimals={decimals} symbol={symbol} />
              </dd>
            </div>
          ) : null}
        </dl>
      </>
    );
  } else if (o.status === OrderStatus.Canceled) {
    body = (
      <Notice tone="info" title={`${amount(o.subtotalMinor)} returned to your wallet`}>
        You rejected the delivery fee, so the order was canceled. The subtotal came back in the same transaction, and the {orderQty(view)} went
        back on {farmer}’s offer.
      </Notice>
    );
  } else {
    body = (
      <>
        <Notice tone="info" title="Your escrow was returned to your wallet">
          {o.status === OrderStatus.Refused
            ? `${w} refused delivery before the order left the warehouse. Everything held in escrow, the subtotal and any delivery fee you accepted, came back in the same transaction, and the ${orderQty(view)} went back on ${farmer}’s offer.`
            : `The order passed its deadline and was closed. Everything held in escrow came back to your wallet, and the ${orderQty(view)} went back on ${farmer}’s offer.`}
        </Notice>
        <div className="row">
          <Link to={`/offers/${o.offer}`} className="kb-btn kb-btn-secondary">
            Order again
          </Link>
        </div>
      </>
    );
  }

  return (
    <Layout area="customer">
      <div className="page page-tight">
        <Link to="/orders" className="back-link">
          All orders
        </Link>
        <NetworkNotices />
        {placed ? (
          <Notice
            tone="success"
            title="Paid into escrow"
            action={
              <a href={explorerUrl("tx", placed)} target="_blank" rel="noreferrer" className="kb-btn kb-btn-quiet kb-btn-sm">
                View transaction
              </a>
            }
          >
            {amount(o.subtotalMinor)} is held for order #{o.orderId.toString()}. You can close this page; the order is on Solana now.
          </Notice>
        ) : null}
        <div className="row-between">
          <div className="order-head">
            <div className="order-thumb">
              <OfferPhoto size="tile" alt={view.offer ? `Photo of ${orderTitle(view)}` : undefined} />
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="t-display">Order #{o.orderId.toString()}</h1>
              <span className="muted">
                {orderTitle(view)} · {farmer} · {delivery ? "delivery" : "pickup"} through {w} · placed {formatDayTime(o.createdAt)}
              </span>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {late ? <Badge tone="amber">Past its deadline</Badge> : null}
            <Status status={status} />
          </div>
        </div>
        <div className="card">
          <Lifecycle mode={delivery ? "DELIVERY" : "PICKUP"} status={status} />
        </div>
        <div className="split">
          <section className="split-main card card-lg stack gap-5" style={{ flexBasis: 480 }}>
            <h2 className="t-title">{ended ? "How it ended" : "What happens next"}</h2>
            {body}
          </section>
          <aside className="split-side card stack gap-4">
            <h2 className="t-heading">Escrow</h2>
            <dl className="rows">
              <div>
                <dt>Held now</dt>
                <dd>
                  <Amount minor={held} decimals={decimals} symbol={symbol} size="lg" escrow={held > 0n} />
                </dd>
              </div>
              <div>
                <dt>Subtotal</dt>
                <dd>
                  <Amount minor={o.subtotalMinor} decimals={decimals} symbol={symbol} />
                </dd>
              </div>
              <div>
                <dt>Delivery fee</dt>
                <dd className={delivery && o.deliveryFeeMinor > 0n ? undefined : "muted"}>
                  {!delivery ? (
                    "None, pickup"
                  ) : o.status === OrderStatus.PendingDeliveryQuote ? (
                    "Waiting for quote"
                  ) : o.status === OrderStatus.Canceled ? (
                    "Not accepted"
                  ) : o.deliveryFeeMinor > 0n ? (
                    <Amount minor={o.deliveryFeeMinor} decimals={decimals} symbol={symbol} />
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
              <div>
                <dt>Fulfillment</dt>
                <dd>{modeLabel(o)}</dd>
              </div>
            </dl>
            <h3 className="t-strong" style={{ marginTop: 8 }}>
              On Solana
            </h3>
            <dl className="rows inset">
              {placed ? (
                <div>
                  <dt>Transaction</dt>
                  <dd>
                    <Address value={placed} head={6} tail={6} />
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Order account</dt>
                <dd>
                  <Address value={view.account.address} />
                </dd>
              </div>
              <div>
                <dt>Escrow account</dt>
                <dd>
                  <Address value={escrow} />
                </dd>
              </div>
              <span className="t-small muted">
                Anyone can check these accounts on a{" "}
                <a href={explorerUrl("address", view.account.address)} target="_blank" rel="noreferrer">
                  Solana explorer
                </a>
                .
              </span>
            </dl>
          </aside>
        </div>
      </div>
    </Layout>
  );
}
