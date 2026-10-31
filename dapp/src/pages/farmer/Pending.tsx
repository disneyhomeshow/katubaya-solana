// Design: "Farmer · Waiting for approval" (FarmerPending).
import { Navigate } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { ConnectFirst, Loading, NetworkNotices } from "../../components/States";
import { Badge, EmptyState, Notice } from "../../design-system";
import { formatFeeBps } from "../../solana/format";
import { useSession } from "../../state/session";

export function FarmerPending() {
  const { wallet, profile, loading } = useSession();
  if (wallet && !loading && profile && !profile.farmer) return <Navigate to="/farmer/register" replace />;
  if (profile?.farmer?.data.warehouseApproved) return <Navigate to="/farmer" replace />;

  const farmer = profile?.farmer?.data;
  const warehouse = profile?.farmerWarehouse?.data;
  const name = warehouse?.name ?? "your warehouse";
  return (
    <Layout area="farmer">
      <div className="page">
        <NetworkNotices />
        {!wallet ? (
          <ConnectFirst title="Connect a wallet to see your profile">Your farmer profile lives on Solana under your wallet.</ConnectFirst>
        ) : !farmer ? (
          <Loading />
        ) : (
          <>
            <div className="stack gap-2">
              <h1 className="t-display">{farmer.displayName}</h1>
              <div className="row">
                <Badge tone="amber">Waiting for {name}</Badge>
                <span className="t-small muted">This page opens your offers by itself once you're approved.</span>
              </div>
            </div>
            <Notice tone="warning" title={`You can publish once ${name} approves you`}>
              Their operator reviews new farmers in their queue. Getting in touch helps
              {warehouse?.pickupNotes ? `: ${warehouse.pickupNotes}` : ""}, and mention the wallet ending in {wallet.slice(-4)}.
            </Notice>
            <div className="split" style={{ gap: 24 }}>
              <EmptyState icon="leaf" title="Your offers will appear here" className="split-main">
                While you wait, gather what your first offer needs: the quantity you can sell and your price per unit.
              </EmptyState>
              <aside className="split-side card stack gap-3" style={{ flexBasis: 320 }}>
                <h2 className="t-heading">Your profile</h2>
                <dl className="rows">
                  <div>
                    <dt>Farm name</dt>
                    <dd>{farmer.displayName}</dd>
                  </div>
                  <div>
                    <dt>Warehouse</dt>
                    <dd>{warehouse?.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Service fee</dt>
                    <dd>{warehouse ? `${formatFeeBps(warehouse.feeBps)} per sale` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Public link</dt>
                    <dd className={farmer.publicProfileUri ? undefined : "muted"}>
                      {farmer.publicProfileUri ? (
                        <a href={farmer.publicProfileUri} target="_blank" rel="noreferrer">
                          {farmer.publicProfileUri.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "None"
                      )}
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
