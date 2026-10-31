// Design: "Customer · Waiting for confirmation" (CustomerPending).
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { enrichOffers, OfferTile } from "../../components/offers";
import { ConnectFirst, Loading, NetworkNotices } from "../../components/States";
import { Badge, Icon, Notice } from "../../design-system";
import { listOffersByWarehouse } from "../../solana/accounts";
import { useSession, type WarehouseLink } from "../../state/session";
import { useAsync } from "../../state/useAsync";

function PendingRequest({ item, wallet }: { item: WarehouseLink; wallet: string }) {
  const name = item.warehouse?.data.name ?? "The warehouse";
  const contact = item.warehouse?.data.pickupNotes;
  return (
    <section aria-labelledby={`pending-${item.link.address}`} className="card card-lg split">
      <div className="split-main stack gap-4" style={{ flexBasis: 420 }}>
        <div className="row">
          <h1 id={`pending-${item.link.address}`} className="t-title">
            Waiting for {name} to confirm you
          </h1>
          <Badge tone="amber">Pending</Badge>
        </div>
        <p className="t-body">
          Your request is on Solana. Now send {name} your delivery address and how you like to be contacted — directly, not here. They
          confirm you once they have it.
        </p>
        <ol className="steps">
          <li>
            <span className="step-node step-node-done">
              <Icon name="check" size={14} />
            </span>
            <span>
              <span style={{ fontWeight: 500 }}>Request sent</span>
            </span>
          </li>
          <li>
            <span className="step-node step-node-current">2</span>
            <span>
              <span style={{ fontWeight: 500 }}>Share your address with {name}</span>
              <br />
              <span className="muted">
                {contact ? `${contact} · ` : ""}mention the wallet ending in {wallet.slice(-4)}
              </span>
            </span>
          </li>
          <li>
            <span className="step-node">3</span>
            <span className="muted">{name} confirms you — ordering opens here</span>
          </li>
        </ol>
      </div>
      <div className="split-side inset-lg stack gap-3" style={{ flexBasis: 300 }}>
        <h2 className="t-strong">What {name} will and won't know</h2>
        <p className="t-small" style={{ margin: 0 }}>
          They keep your address in their own records, to deliver. On Solana there is only the link between your wallet and the
          warehouse, and its status.
        </p>
        <p className="t-small muted" style={{ margin: 0 }}>
          Farmers never see your address. Nobody else does either.
        </p>
      </div>
    </section>
  );
}

export function CustomerPending() {
  const { wallet, profile, loading } = useSession();
  const navigate = useNavigate();
  const first = profile?.pending[0];
  const offers = useAsync(
    async () => (first ? (await enrichOffers(await listOffersByWarehouse(first.link.data.warehouse))).filter((o) => o.orderable) : []),
    [first?.link.address],
  );

  if (wallet && !loading && profile && !profile.pending.length) {
    return <Navigate to={profile.confirmed.length ? "/market" : "/customer/warehouse"} replace />;
  }

  return (
    <Layout area="customer">
      <div className="page">
        <NetworkNotices />
        {!wallet ? (
          <ConnectFirst title="Connect a wallet to see your request">Your request lives on Solana under your wallet.</ConnectFirst>
        ) : loading || !profile ? (
          <Loading />
        ) : (
          <>
            {profile.revoked.map((r) => (
              <Notice key={r.link.address} tone="danger" title={`${r.warehouse?.data.name ?? "A warehouse"} revoked your confirmation`}>
                You can't place new orders through it. Orders you already placed continue. Talk to the warehouse to be confirmed again.
              </Notice>
            ))}
            {profile.confirmed.length ? (
              <Notice
                tone="success"
                title={`You are confirmed by ${profile.confirmed.map((c) => c.warehouse?.data.name ?? "a warehouse").join(" and ")}`}
                action={
                  <Link to="/market" className="kb-btn kb-btn-secondary kb-btn-sm">
                    See offers
                  </Link>
                }
              >
                You can already order the offers it routes.
              </Notice>
            ) : null}
            {profile.pending.map((p) => (
              <PendingRequest key={p.link.address} item={p} wallet={wallet} />
            ))}
            <section className="stack gap-4">
              <div className="row-baseline">
                <h2 className="t-heading">Browse while you wait</h2>
                <span className="t-small muted">Ordering opens once {first?.warehouse?.data.name ?? "the warehouse"} confirms you</span>
              </div>
              {offers.loading && !offers.data ? <Loading /> : null}
              {offers.data && !offers.data.length ? (
                <p className="t-body muted">No offers through this warehouse right now. New ones appear here as farmers publish them.</p>
              ) : null}
              <div className="offer-grid">
                {offers.data?.map((view) => (
                  <OfferTile
                    key={view.account.address}
                    view={view}
                    buyLabel="Order after confirmation"
                    onBuy={() => navigate(`/offers/${view.account.address}`)}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
