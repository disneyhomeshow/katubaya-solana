// Design: "Customer · Market" (Main, MobileMarket).
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { unwrapOption } from "@solana/kit";
import { Layout } from "../../components/Layout";
import { enrichOffers, OfferTile, type OfferView } from "../../components/offers";
import { LoadError, Loading, NetworkNotices } from "../../components/States";
import { EmptyState, Field, Notice } from "../../design-system";
import { listAllOffers, listOffersByWarehouse } from "../../solana/accounts";
import { pricePerShownUnit } from "../../solana/units";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";

type Sort = "newest" | "price" | "expiring";

function sortOffers(list: OfferView[], sort: Sort): OfferView[] {
  const copy = [...list];
  if (sort === "newest") copy.sort((a, b) => Number(b.account.data.createdAt - a.account.data.createdAt));
  if (sort === "price") {
    copy.sort((a, b) => {
      const pa = pricePerShownUnit(a.account.data.priceMinor, a.account.data.unitCode);
      const pb = pricePerShownUnit(b.account.data.priceMinor, b.account.data.unitCode);
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  }
  if (sort === "expiring") {
    const key = (v: OfferView) => unwrapOption(v.account.data.expiresAt) ?? BigInt(Number.MAX_SAFE_INTEGER);
    copy.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  return copy;
}

export function Market() {
  const { wallet, profile, loading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [crop, setCrop] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  const confirmed = profile?.confirmed ?? [];
  const scope = confirmed.map((c) => c.link.data.warehouse).join(",");
  const offers = useAsync(async () => {
    const raw = confirmed.length
      ? (await Promise.all(confirmed.map((c) => listOffersByWarehouse(c.link.data.warehouse)))).flat()
      : await listAllOffers();
    // Deactivated and expired offers can't be ordered; sold-out ones stay, shown as sold out.
    return (await enrichOffers(raw)).filter((v) => v.account.data.active && !v.expired);
  }, [scope, sessionLoading]);

  const crops = useMemo(() => [...new Set((offers.data ?? []).map((v) => v.account.data.cropName))].sort(), [offers.data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (offers.data ?? []).filter((v) => {
      if (crop && v.account.data.cropName !== crop) return false;
      if (!q) return true;
      const text = [v.account.data.cropName, unwrapOption(v.account.data.cultivarName) ?? "", v.farmer?.data.displayName ?? ""];
      return text.join(" ").toLowerCase().includes(q);
    });
    return sortOffers(filtered, sort);
  }, [offers.data, query, crop, sort]);

  const single = confirmed.length === 1 ? confirmed[0].warehouse?.data.name : undefined;
  const ordering = confirmed.length > 0;

  return (
    <Layout area={wallet && profile?.customer ? "customer" : "onboarding"}>
      <div className="page">
        <NetworkNotices showPaused />
        <div className="row-end">
          <div className="stack gap-2 measure">
            <h1 className="t-display">{single ? `Offers through ${single}` : "Offers on katūbayá"}</h1>
            <p className="t-body muted">
              {single
                ? `Harvests from farmers who deliver through the ${single} warehouse. Each farmer sets their own price; you pay into escrow and the warehouse releases it on delivery.`
                : "Harvests from farmers, each routed by a warehouse. Each farmer sets their own price; you pay into escrow and the warehouse releases it on delivery."}
            </p>
          </div>
        </div>
        <div role="search" className="search">
          <div className="search-main">
            <label htmlFor="offer-search">Search offers</label>
            <div className="search-box">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
              </svg>
              <input
                id="offer-search"
                type="search"
                className="kb-input"
                placeholder="Crop, cultivar or farmer"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Field label="Crop">
            <select className="kb-select" value={crop} onChange={(e) => setCrop(e.target.value)}>
              <option value="">All crops</option>
              {crops.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select className="kb-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest first</option>
              <option value="price">Price, low to high</option>
              <option value="expiring">Expiring soonest</option>
            </select>
          </Field>
        </div>
        {single ? (
          <Notice tone="info" title={`You are confirmed by ${single}`}>
            The warehouse collected your delivery address off-chain. It never appears here or on Solana.
          </Notice>
        ) : null}
        {profile?.revoked.map((r) => (
          <Notice key={r.link.address} tone="danger" title={`${r.warehouse?.data.name ?? "A warehouse"} revoked your confirmation`}>
            You can't place new orders through {r.warehouse?.data.name ?? "it"}. Orders you already placed continue. Talk to the warehouse
            to be confirmed again.
          </Notice>
        ))}
        {!ordering && wallet && profile?.pending.length ? (
          <Notice
            tone="warning"
            title="Ordering opens once a warehouse confirms you"
            action={
              <Link to="/customer/pending" className="kb-btn kb-btn-secondary kb-btn-sm">
                See your request
              </Link>
            }
          >
            Browse every offer meanwhile.
          </Notice>
        ) : null}
        {!ordering && wallet && profile && !profile.pending.length && !profile.revoked.length ? (
          <Notice
            tone="info"
            title="Ask a warehouse to confirm you to order"
            action={
              <Link to="/customer/warehouse" className="kb-btn kb-btn-secondary kb-btn-sm">
                Choose a warehouse
              </Link>
            }
          >
            You can browse every offer now. Ordering opens once a warehouse near you confirms you.
          </Notice>
        ) : null}
        {offers.error ? <LoadError error={offers.error} onRetry={offers.reload} /> : null}
        {offers.loading && !offers.data ? <Loading /> : null}
        {offers.data && !shown.length ? (
          <EmptyState icon="leaf" title={offers.data.length ? "No offers match" : "No offers yet"}>
            {offers.data.length
              ? "Try another crop or clear the search."
              : "New offers appear here as farmers publish them."}
          </EmptyState>
        ) : null}
        <div className="offer-grid">
          {shown.map((view) => (
            <OfferTile
              key={view.account.address}
              view={view}
              buyLabel={ordering ? "Order" : "Order after confirmation"}
              onBuy={() => navigate(`/offers/${view.account.address}`)}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}
