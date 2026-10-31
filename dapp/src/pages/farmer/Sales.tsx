// Design: "Farmer · Sales and payouts" (FarmerSales, MobileFarmerSales).
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { Layout } from "../../components/Layout";
import { cropTitle } from "../../components/offers";
import { enrichOrders, isOpen, orderQty, STATUS_CODE, type OrderView } from "../../components/orders";
import { LoadError, Loading, NetworkNotices } from "../../components/States";
import { Amount, Button, EmptyState, Notice, OfferPhoto, OrderStatus as Status, Table, type TableColumn } from "../../design-system";
import { OrderStatus } from "../../generated";
import { mintSymbol } from "../../config";
import { listOrdersByFarmer, tokenAccountOf, tokenBalance, type MintInfo } from "../../solana/accounts";
import { formatFeeBps } from "../../solana/format";
import { NETWORK_FEE } from "../../solana/rent";
import { useAsync } from "../../state/useAsync";
import { useTx } from "../../tx/TxProvider";
import { FarmerGate, type ApprovedFarmer } from "./FarmerGate";

const SETTLED_ELSEWHERE = new Set([OrderStatus.Refused, OrderStatus.Canceled, OrderStatus.Expired]);

type MintTotals = { mint: MintInfo; held: bigint; toReceive: bigint; paid: bigint; open: number; fulfilled: number; hasPayoutAccount: boolean };

function SalesPage({ wallet, warehouse }: ApprovedFarmer) {
  const run = useTx();
  const data = useAsync(async () => {
    const orders = await enrichOrders(await listOrdersByFarmer(wallet));
    const totals = new Map<string, MintTotals>();
    for (const v of orders) {
      if (!v.mint) continue;
      const key = v.mint.address as string;
      let t = totals.get(key);
      if (!t) {
        const hasPayoutAccount = (await tokenBalance(await tokenAccountOf(wallet, v.mint))) != null;
        t = { mint: v.mint, held: 0n, toReceive: 0n, paid: 0n, open: 0, fulfilled: 0, hasPayoutAccount };
        totals.set(key, t);
      }
      const o = v.account.data;
      if (isOpen(o.status)) {
        t.held += o.subtotalMinor;
        t.toReceive += o.subtotalMinor - o.serviceFeeMinor;
        t.open += 1;
      } else if (o.status === OrderStatus.Fulfilled) {
        t.paid += o.subtotalMinor - o.serviceFeeMinor;
        t.fulfilled += 1;
      }
    }
    return { orders, totals: [...totals.values()] };
  }, [wallet], 30000);

  const name = warehouse?.data.name ?? "your warehouse";
  const fee = warehouse ? formatFeeBps(warehouse.data.feeBps) : "";
  const orders = data.data?.orders ?? [];
  const missing = (data.data?.totals ?? []).filter((t) => !t.hasPayoutAccount && t.open > 0);

  const amount = (r: OrderView, minor: bigint | null, escrow = false) =>
    minor == null ? <span className="muted">—</span> : <Amount minor={minor} decimals={r.mint?.decimals ?? 6} symbol={mintSymbol(r.account.data.mint)} escrow={escrow} />;

  const cols: TableColumn<OrderView>[] = [
    { key: "id", header: "Order", width: "112px", render: (r) => `#${r.account.data.orderId}` },
    {
      key: "offer",
      header: "Offer",
      render: (r) => (
        <div className="cell-offer">
          <OfferPhoto size="thumb" alt={r.offer ? `Photo of ${cropTitle(r.offer.data)}` : undefined} />
          {r.offer ? cropTitle(r.offer.data) : "Offer"}
        </div>
      ),
    },
    { key: "qty", header: "Quantity", align: "right", render: (r) => <span className="kb-amount">{orderQty(r)}</span> },
    { key: "subtotal", header: "Subtotal", align: "right", render: (r) => amount(r, r.account.data.subtotalMinor) },
    {
      key: "fee",
      header: "Service fee",
      align: "right",
      render: (r) => amount(r, SETTLED_ELSEWHERE.has(r.account.data.status) ? null : r.account.data.serviceFeeMinor),
    },
    {
      key: "payout",
      header: "Your payout",
      align: "right",
      render: (r) =>
        amount(
          r,
          SETTLED_ELSEWHERE.has(r.account.data.status) ? null : r.account.data.subtotalMinor - r.account.data.serviceFeeMinor,
          r.account.data.status !== OrderStatus.Fulfilled,
        ),
    },
    { key: "status", header: "Status", render: (r) => <Status status={STATUS_CODE[r.account.data.status]} /> },
  ];

  return (
    <Layout area="farmer">
      <div className="page">
        <NetworkNotices />
        <h1 className="t-display">Sales and payouts</h1>
        {data.error ? <LoadError error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !data.data ? <Loading /> : null}
        {missing.map((t) => {
          const symbol = mintSymbol(t.mint.address);
          return (
            <Notice
              key={t.mint.address}
              tone="warning"
              title={`Create your ${symbol} payout account`}
              action={
                <Button
                  size="sm"
                  onClick={() =>
                    run({
                      title: `Create your ${symbol} payout account`,
                      instruction: "create_associated_token_account",
                      description: `The account your payouts in ${symbol} land in. ${name} can only release an order once it exists.`,
                      lines: [{ label: "Network fee", value: NETWORK_FEE }],
                      build: async (signer) => [
                        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: wallet, mint: t.mint.address, tokenProgram: t.mint.tokenProgram }),
                      ],
                      onConfirmed: () => data.reload(),
                    })
                  }
                >
                  Create account
                </Button>
              }
            >
              {name} can't release your open orders until your wallet has a {symbol} account to receive them. Your wallet pays its small rent once.
            </Notice>
          );
        })}
        {(data.data?.totals ?? []).map((t) => {
          const symbol = mintSymbol(t.mint.address);
          return (
            <div key={t.mint.address} className="stats">
              <div className="card stat">
                <span className="t-small muted">Held in escrow for your open orders</span>
                <Amount minor={t.held} decimals={t.mint.decimals} symbol={symbol} size="lg" escrow />
                <span className="t-small muted">
                  {t.open} {t.open === 1 ? "order" : "orders"} · released when {name} marks them fulfilled
                </span>
              </div>
              <div className="card stat">
                <span className="t-small muted">You will receive from those orders</span>
                <Amount minor={t.toReceive} decimals={t.mint.decimals} symbol={symbol} size="lg" />
                <span className="t-small muted">After {name}'s {fee} service fee</span>
              </div>
              <div className="card stat">
                <span className="t-small muted">Paid to your wallet</span>
                <Amount minor={t.paid} decimals={t.mint.decimals} symbol={symbol} size="lg" />
                <span className="t-small muted">
                  {t.fulfilled} fulfilled {t.fulfilled === 1 ? "order" : "orders"}
                </span>
              </div>
            </div>
          );
        })}
        <section className="stack gap-4">
          <div className="row-baseline">
            <h2 className="t-heading">Orders for your offers</h2>
            <span className="t-small muted">Customer addresses are held by the warehouse and never shown to you.</span>
          </div>
          {data.data && !orders.length ? (
            <EmptyState icon="package" title="No orders yet">
              When customers order your offers, each order and its payout appear here.
            </EmptyState>
          ) : null}
          {orders.length ? <Table columns={cols} rows={orders} rowKey={(r) => r.account.address} caption="Orders for your offers" /> : null}
        </section>
      </div>
    </Layout>
  );
}

export function FarmerSales() {
  return <FarmerGate>{(f) => <SalesPage {...f} />}</FarmerGate>;
}
