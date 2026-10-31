// Offers as the screens show them: the on-chain LotOffer plus its farmer, warehouse and mint.
import { unwrapOption, type Account, type Address } from "@solana/kit";
import { OfferCard } from "../design-system";
import type { FarmerProfile, LotOffer, Warehouse } from "../generated";
import { fetchFarmerProfiles, fetchMint, fetchWarehouses, type MintInfo } from "../solana/accounts";
import { formatOfferExpiry, nowSeconds } from "../solana/format";
import { asUnitCode, pricePerShownUnit } from "../solana/units";
import { mintSymbol } from "../config";

export type OfferView = {
  account: Account<LotOffer>;
  farmer: Account<FarmerProfile> | undefined;
  warehouse: Account<Warehouse> | undefined;
  mint: MintInfo | null;
  expired: boolean;
  /** Active, not expired and with stock: a customer can order it. */
  orderable: boolean;
};

export function isExpired(offer: LotOffer, now = nowSeconds()): boolean {
  const expiresAt = unwrapOption(offer.expiresAt);
  return expiresAt != null && now >= expiresAt;
}

export async function enrichOffers(offers: Account<LotOffer>[]): Promise<OfferView[]> {
  const [farmers, warehouses, mints] = await Promise.all([
    fetchFarmerProfiles(offers.map((o) => o.data.farmer)),
    fetchWarehouses(offers.map((o) => o.data.warehouse)),
    Promise.all([...new Set(offers.map((o) => o.data.mint))].map((m) => fetchMint(m as Address))),
  ]);
  const mintBy = new Map(mints.filter((m): m is MintInfo => !!m).map((m) => [m.address as string, m]));
  const now = nowSeconds();
  return offers.map((account) => {
    const expired = isExpired(account.data, now);
    return {
      account,
      farmer: farmers.get(account.data.farmer),
      warehouse: warehouses.get(account.data.warehouse),
      mint: mintBy.get(account.data.mint) ?? null,
      expired,
      orderable: account.data.active && !expired && account.data.qtyRemaining > 0n,
    };
  });
}

export function cropTitle(offer: LotOffer): string {
  const cultivar = unwrapOption(offer.cultivarName);
  return cultivar ? `${offer.cropName} ${cultivar}` : offer.cropName;
}

export function farmerName(view: Pick<OfferView, "farmer">, fallback: string): string {
  return view.farmer?.data.displayName || fallback;
}

export function OfferTile({ view, buyLabel = "Order", onBuy }: { view: OfferView; buyLabel?: string; onBuy?: () => void }) {
  const o = view.account.data;
  const expiresAt = unwrapOption(o.expiresAt);
  return (
    <OfferCard
      crop={o.cropName}
      cultivar={unwrapOption(o.cultivarName) ?? undefined}
      unitCode={asUnitCode(o.unitCode)}
      qtyRemaining={o.qtyRemaining.toString()}
      priceMinor={pricePerShownUnit(o.priceMinor, o.unitCode)}
      decimals={view.mint?.decimals ?? 6}
      symbol={mintSymbol(o.mint)}
      farmerName={farmerName(view, "Farmer")}
      farmerKey={o.farmer}
      warehouseName={view.warehouse?.data.name}
      expires={expiresAt != null ? formatOfferExpiry(expiresAt) : undefined}
      notes={unwrapOption(o.notesPublic) ?? undefined}
      active={o.active && !view.expired}
      buyLabel={buyLabel}
      onBuy={onBuy}
    />
  );
}
