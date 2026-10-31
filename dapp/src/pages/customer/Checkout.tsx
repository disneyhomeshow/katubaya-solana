// Design: "Customer · Order an offer" + "Approve in wallet" (CustomerCheckout, CustomerSign, MobileOrder). create_order.
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { address as toAddress, isAddress, unwrapOption } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { cropTitle, enrichOffers, farmerName } from "../../components/offers";
import { ConnectFirst, LoadError, Loading, NetworkNotices } from "../../components/States";
import { Address, Amount, Button, Field, Notice, OfferPhoto, formatMinor, formatQty } from "../../design-system";
import { FulfillmentMode, findOrderPda, getCreateOrderInstructionAsync } from "../../generated";
import { mintSymbol } from "../../config";
import { fetchOffer, tokenAccountOf, tokenBalance } from "../../solana/accounts";
import { formatOfferExpiry, freshId } from "../../solana/format";
import { formatSol, NETWORK_FEE, rentOf, SIZE } from "../../solana/rent";
import { asUnitCode, fromBaseQty, pricePerShownUnit, toBaseQty, unitOf } from "../../solana/units";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useTx } from "../../tx/TxProvider";

type Mode = "pickup" | "delivery";

export function Checkout() {
  const { offer: param = "" } = useParams();
  const offerAddress = isAddress(param) ? toAddress(param) : null;
  const { wallet, profile, reload: reloadSession } = useSession();
  const navigate = useNavigate();
  const run = useTx();
  const qtyRef = useRef<HTMLInputElement>(null);
  const [qty, setQty] = useState("");
  const [mode, setMode] = useState<Mode>("pickup");

  const data = useAsync(async () => {
    if (!offerAddress) return null;
    const offer = await fetchOffer(offerAddress);
    if (!offer) return null;
    const [view] = await enrichOffers([offer]);
    return view;
  }, [offerAddress]);
  const rent = useAsync(
    async () => ({
      order: await rentOf(SIZE.order),
      escrow: await rentOf(SIZE.tokenAccount),
      escrow2022: await rentOf(SIZE.tokenAccount2022),
    }),
    [],
  );

  const view = data.data;
  if (!offerAddress || (data.data === null && !data.loading)) {
    return (
      <Layout area="customer">
        <div className="page page-tight">
          <Link to="/market" className="back-link">
            Back to market
          </Link>
          <Notice tone="warning" title="This offer doesn't exist">
            The link may be wrong, or the offer was never published on this network.
          </Notice>
        </div>
      </Layout>
    );
  }
  if (!view) {
    return (
      <Layout area="customer">
        <div className="page page-tight">{data.error ? <LoadError error={data.error} onRetry={data.reload} /> : <Loading />}</div>
      </Layout>
    );
  }

  const o = view.account.data;
  const unit = unitOf(o.unitCode);
  const symbol = mintSymbol(o.mint);
  const decimals = view.mint?.decimals ?? 6;
  const warehouseName = view.warehouse?.data.name ?? "the warehouse";
  const farmer = farmerName(view, "The farmer");
  const unitPrice = pricePerShownUnit(o.priceMinor, o.unitCode);
  const expiresAt = unwrapOption(o.expiresAt);
  const notes = unwrapOption(o.notesPublic);
  const packRef = unwrapOption(o.packRef);
  const delivers = (view.warehouse?.data.deliverZipPrefixes.length ?? 0) > 0;
  const effectiveMode: Mode = delivers ? mode : "pickup";

  const link = profile?.links.find((l) => l.link.data.warehouse === o.warehouse);
  const confirmed = profile?.confirmed.find((l) => l.link.data.warehouse === o.warehouse);
  const paused = !!profile?.config?.data.paused;

  // Quantity: typed in the unit the farmer sells in, stored in base units.
  const base = qty.trim() ? toBaseQty(qty, o.unitCode) : null;
  const available = formatQty(o.qtyRemaining.toString(), asUnitCode(o.unitCode));
  let qtyError: string | undefined;
  if (qty.trim()) {
    if (base == null) qtyError = unit.factor > 1n ? `Enter a quantity in ${unit.short}, up to 3 decimals.` : `Enter a whole number of ${formatQty(2, asUnitCode(o.unitCode)).replace(/^2 /, "")}.`;
    else if (base === 0n) qtyError = "Enter a quantity above zero.";
    else if (base > o.qtyRemaining) qtyError = `The offer has ${available} left. Reduce the quantity or pick another offer.`;
  }
  const subtotal = base && !qtyError ? base * o.priceMinor : null;
  const shownQty = base && !qtyError ? formatQty(base.toString(), asUnitCode(o.unitCode)) : null;

  const blocked = !view.orderable || paused || !confirmed;
  const canPay = !blocked && subtotal != null && !!wallet;

  const pay = async () => {
    if (!wallet || !confirmed || subtotal == null || base == null || !view.mint) return;
    const mint = view.mint;
    const orderId = freshId();
    const [order] = await findOrderPda({ offer: view.account.address, customer: wallet, orderId });
    const customerTokenAccount = await tokenAccountOf(wallet, mint);
    const escrowRent = rent.data ? (mint.tokenProgram === TOKEN_2022_PROGRAM_ADDRESS ? rent.data.escrow2022 : rent.data.escrow) : null;
    run({
      title: "Pay into escrow",
      instruction: "create_order",
      description:
        effectiveMode === "delivery"
          ? `${formatMinor(subtotal, decimals)} ${symbol} moves from your wallet into this order’s escrow. ${warehouseName} quotes the delivery fee next; nothing reaches the farmer until the order is fulfilled.`
          : `${formatMinor(subtotal, decimals)} ${symbol} moves from your wallet into this order’s escrow. Nothing reaches the farmer until ${warehouseName} marks the order fulfilled.`,
      lines: [
        { label: "Subtotal, to escrow", minor: subtotal, decimals, symbol, escrow: true, note: `${shownQty} × ${formatMinor(unitPrice, decimals)} ${symbol}` },
        effectiveMode === "delivery"
          ? { label: "Delivery fee", value: "Not yet", note: `Quoted by ${warehouseName} after you order` }
          : { label: "Delivery fee", value: "None", note: `Pickup at ${warehouseName}` },
        ...(escrowRent != null ? [{ label: "Escrow account rent", value: formatSol(escrowRent), note: "Returned to you when the order closes" }] : []),
        ...(rent.data ? [{ label: "Order account rent", value: formatSol(rent.data.order), note: "Stays with the order record on Solana" }] : []),
        { label: "Network fee", value: NETWORK_FEE },
      ],
      preflight: async () => {
        const fresh = await fetchOffer(view.account.address);
        if (!fresh || !fresh.data.active) {
          return { title: "This offer is no longer available", message: `${farmer} stopped selling it while you were ordering. Nothing was charged.` };
        }
        if (fresh.data.qtyRemaining < base) {
          const left = formatQty(fresh.data.qtyRemaining.toString(), asUnitCode(o.unitCode));
          return { title: "Not enough stock", message: `The offer has ${left} left. Reduce the quantity or pick another offer.` };
        }
        const balance = (await tokenBalance(customerTokenAccount)) ?? 0n;
        if (balance < subtotal) {
          return {
            title: `Not enough ${symbol}`,
            message: `Your wallet has ${formatMinor(balance, decimals)} ${symbol}; this order needs ${formatMinor(subtotal, decimals)} ${symbol}. Add funds or order a smaller quantity.`,
          };
        }
        return null;
      },
      failedAction: { label: "Change quantity", onClick: () => qtyRef.current?.focus() },
      build: async (signer) => [
        await getCreateOrderInstructionAsync({
          offer: view.account.address,
          warehouse: o.warehouse,
          warehouseCustomer: confirmed.link.address,
          mint: mint.address,
          customerTokenAccount,
          customer: signer,
          tokenProgram: mint.tokenProgram,
          orderId,
          qty: base,
          mode: effectiveMode === "delivery" ? FulfillmentMode.Delivery : FulfillmentMode.Pickup,
        }),
      ],
      onConfirmed: () => {
        setQty("");
        return Promise.all([data.reload(), reloadSession()]).then(() => undefined);
      },
      onDone: (signature) => navigate(`/orders/${order}`, { state: { placed: signature } }),
      doneLabel: "See your order",
    });
  };

  return (
    <Layout area="customer">
      <div className="page page-tight">
        <Link to="/market" className="back-link">
          Back to market
        </Link>
        <NetworkNotices showPaused />
        <div className="split">
          <section className="split-main stack gap-5" style={{ flexBasis: 520 }}>
            <OfferPhoto size="hero" alt={`Photo of ${cropTitle(o)} by ${farmer}`} />
            <h1 className="t-display">
              {o.cropName} {unwrapOption(o.cultivarName) ? <span className="cultivar">{unwrapOption(o.cultivarName)}</span> : null}
            </h1>
            <div className="facts">
              <div className="fact">
                <span className="t-small muted">Farmer</span>
                <span style={{ fontWeight: 500 }}>{farmer}</span>
                <Address value={o.farmer} />
              </div>
              <div className="fact">
                <span className="t-small muted">Warehouse</span>
                <span style={{ fontWeight: 500 }}>{warehouseName}</span>
                {view.warehouse?.data.pickupNotes ? <span className="t-small muted">{view.warehouse.data.pickupNotes}</span> : null}
              </div>
              <div className="fact">
                <span className="t-small muted">Price</span>
                <Amount minor={unitPrice} decimals={decimals} symbol={`${symbol} / ${unit.short}`} />
              </div>
              <div className="fact">
                <span className="t-small muted">Available</span>
                <span className="t-data">{view.account.data.qtyRemaining > 0n ? available : "Sold out"}</span>
                <span className="t-small muted">{expiresAt != null ? `Expires ${formatOfferExpiry(expiresAt)}` : "No expiry"}</span>
              </div>
            </div>
            {notes ? (
              <div className="stack gap-2 rule-top">
                <h2 className="t-heading">From the farmer</h2>
                <p className="t-body" style={{ maxWidth: 620 }}>
                  {notes}
                </p>
              </div>
            ) : null}
            {packRef ? (
              <span className="t-small muted">
                Reference (unverified) <Address value={packRef} copy={false} />
              </span>
            ) : null}
          </section>
          <aside aria-label="Your order" className="split-side card stack gap-5" style={{ flexBasis: 400 }}>
            <h2 className="t-title">Your order</h2>
            {!wallet ? (
              <ConnectFirst title="Connect a wallet to order">Orders live on Solana under your wallet. Katūbayá never holds your keys.</ConnectFirst>
            ) : (
              <>
                {!view.account.data.active ? (
                  <Notice tone="warning" title="This offer is no longer available">
                    {farmer} stopped selling it. Nothing was charged.
                  </Notice>
                ) : view.expired ? (
                  <Notice tone="warning" title="This offer has expired">
                    It can no longer be ordered. Look for a newer offer from {farmer} on the market.
                  </Notice>
                ) : view.account.data.qtyRemaining === 0n ? (
                  <Notice tone="warning" title="Sold out">
                    Every unit is reserved in other orders. It may come back if one of them is canceled.
                  </Notice>
                ) : null}
                {!confirmed ? (
                  link?.link.data.status === undefined ? (
                    <Notice
                      tone="info"
                      title={`Ordering opens once ${warehouseName} confirms you`}
                      action={
                        <Link to="/customer/warehouse" className="kb-btn kb-btn-secondary kb-btn-sm">
                          Ask {warehouseName}
                        </Link>
                      }
                    >
                      This offer is routed by {warehouseName}. Ask it to confirm you, then share your address with it directly.
                    </Notice>
                  ) : profile?.revoked.some((r) => r.link.data.warehouse === o.warehouse) ? (
                    <Notice tone="danger" title={`${warehouseName} revoked your confirmation`}>
                      You can’t place new orders through {warehouseName}. Orders you already placed continue. Talk to the warehouse to be confirmed again.
                    </Notice>
                  ) : (
                    <Notice tone="warning" title={`Waiting for ${warehouseName} to confirm you`}>
                      Ordering opens here once it confirms you.
                    </Notice>
                  )
                ) : null}
                <Field
                  label="Quantity"
                  affix={unit.short}
                  hint={`${available} available`}
                  error={qtyError}
                >
                  <input
                    ref={qtyRef}
                    className="kb-input kb-input-mono"
                    inputMode={unit.factor > 1n ? "decimal" : "numeric"}
                    placeholder={fromBaseQty(unit.factor, o.unitCode)}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    disabled={blocked}
                  />
                </Field>
                <fieldset className="choice-group">
                  <legend>Fulfillment</legend>
                  <label className="choice choice-on-surface">
                    <input type="radio" name="mode" checked={effectiveMode === "pickup"} onChange={() => setMode("pickup")} disabled={blocked} />
                    <span className="choice-body">
                      <span className="choice-title">Pickup at {warehouseName}</span>
                      <span className="t-small muted">No delivery fee. The warehouse tells you when it is ready.</span>
                    </span>
                  </label>
                  <label className="choice choice-on-surface">
                    <input
                      type="radio"
                      name="mode"
                      checked={effectiveMode === "delivery"}
                      onChange={() => setMode("delivery")}
                      disabled={blocked || !delivers}
                    />
                    <span className="choice-body">
                      <span className="choice-title">Delivery</span>
                      <span className="t-small muted">
                        {delivers
                          ? `${warehouseName} quotes the delivery fee after you order. You accept or reject it.`
                          : `${warehouseName} doesn’t deliver; pickup only.`}
                      </span>
                    </span>
                  </label>
                </fieldset>
                <dl className="rows rule-top" style={{ paddingTop: 16 }}>
                  <div>
                    <dt>
                      Subtotal{shownQty ? `, ${shownQty} × ${formatMinor(unitPrice, decimals)}` : ""}
                    </dt>
                    <dd>{subtotal != null ? <Amount minor={subtotal} decimals={decimals} symbol={symbol} /> : <span className="muted">—</span>}</dd>
                  </div>
                  <div>
                    <dt>Delivery fee</dt>
                    <dd className="muted">{effectiveMode === "delivery" ? "Quoted after you order" : "None"}</dd>
                  </div>
                  <div className="rows-sum">
                    <dt>Paid into escrow now</dt>
                    <dd>
                      <Amount minor={subtotal ?? 0n} decimals={decimals} symbol={symbol} size="lg" escrow />
                    </dd>
                  </div>
                </dl>
                <Notice tone="info" title="Held in escrow, not spent">
                  Released to the farmer only when {warehouseName} marks the order fulfilled. If the warehouse refuses it or it expires, the
                  full amount comes back to you.
                </Notice>
                <Button variant="primary" size="lg" disabled={!canPay} onClick={() => void pay()}>
                  Pay into escrow
                </Button>
                <span className="t-small muted">Your wallet asks you to approve one transaction.</span>
              </>
            )}
          </aside>
        </div>
      </div>
    </Layout>
  );
}
