// Design: "Farmer · Publish offer" (FarmerPublish, MobileFarmerPublish). publish_offer.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { address as toAddress, isAddress, unwrapOption, type Address } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { Layout } from "../../components/Layout";
import { NetworkNotices } from "../../components/States";
import { Button, Field, Notice, OfferCard } from "../../design-system";
import { findOfferPda, getPublishOfferInstructionAsync } from "../../generated";
import { mintSymbol } from "../../config";
import { fetchMint, fetchOffer, tokenAccountOf, tokenBalance, type MintInfo } from "../../solana/accounts";
import { endOfLocalDay, formatFeeBps, formatOfferExpiry, freshId, nowSeconds } from "../../solana/format";
import { formatSol, NETWORK_FEE, rentOf, SIZE } from "../../solana/rent";
import { UNITS, byteLength, fromBaseQty, parseDecimal, pricePerBaseUnit, pricePerShownUnit, priceDigits, toBaseQty, unitOf } from "../../solana/units";
import { useSession } from "../../state/session";
import { useAsync } from "../../state/useAsync";
import { useTx } from "../../tx/TxProvider";
import { FarmerGate, type ApprovedFarmer } from "./FarmerGate";

const MAX_NAME = 100;
const MAX_NOTES = 500;

function PublishPage({ wallet, farmer, warehouse }: ApprovedFarmer) {
  const { profile } = useSession();
  const navigate = useNavigate();
  const run = useTx();
  const [params] = useSearchParams();
  const from = params.get("from");

  const [crop, setCrop] = useState("");
  const [cultivar, setCultivar] = useState("");
  const [unitCode, setUnitCode] = useState<number>(2);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [expires, setExpires] = useState("");
  const [mintText, setMintText] = useState("");
  const [notes, setNotes] = useState("");
  const [packRef, setPackRef] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const allowed = profile?.config?.data.allowedMints ?? [];
  const mints = useAsync(async () => (await Promise.all(allowed.map((m) => fetchMint(m)))).filter((m): m is MintInfo => !!m), [allowed.join(",")]);
  const rent = useAsync(async () => ({ offer: await rentOf(SIZE.lotOffer), ata: await rentOf(SIZE.tokenAccount), ata2022: await rentOf(SIZE.tokenAccount2022) }), []);

  // "Publish again": start from an earlier offer.
  const source = useAsync(async () => (from && isAddress(from) ? fetchOffer(toAddress(from)) : null), [from]);
  useEffect(() => {
    const o = source.data?.data;
    if (!o || o.farmer !== wallet) return;
    setCrop(o.cropName);
    setCultivar(unwrapOption(o.cultivarName) ?? "");
    setUnitCode(unitOf(o.unitCode).code);
    setQty(o.qtyRemaining > 0n ? fromBaseQty(o.qtyRemaining, o.unitCode) : "");
    setNotes(unwrapOption(o.notesPublic) ?? "");
    setMintText(o.mint);
    void fetchMint(o.mint).then((m) => m && setPrice(fromMinor(pricePerShownUnit(o.priceMinor, o.unitCode), m.decimals)));
  }, [source.data, wallet]);

  // Default the payment mint to the first one the program accepts.
  useEffect(() => {
    if (!mintText && mints.data?.length) setMintText(mints.data[0].address);
  }, [mints.data, mintText]);

  const mintInfo = useAsync(async () => (isAddress(mintText.trim()) ? fetchMint(toAddress(mintText.trim())) : null), [mintText]);
  const mint = mintInfo.data ?? null;
  const decimals = mint?.decimals ?? 6;
  const unit = unitOf(unitCode);
  const symbol = mint ? mintSymbol(mint.address) : "USDC";

  // ---- Validation, in the program's own bounds
  const cropErr = !crop.trim() ? (submitted ? "Name the crop customers will see." : undefined) : byteLength(crop.trim()) > MAX_NAME ? "Up to 100 bytes." : undefined;
  const cultivarErr = byteLength(cultivar.trim()) > MAX_NAME ? "Up to 100 bytes." : undefined;
  const base = qty.trim() ? toBaseQty(qty, unitCode) : null;
  const qtyErr = !qty.trim()
    ? submitted ? "Enter the quantity you can sell." : undefined
    : base == null
      ? unit.factor > 1n ? `Up to 3 decimals for ${unit.short}.` : "Enter a whole number."
      : base === 0n ? "Enter a quantity above zero." : undefined;
  const perShown = price.trim() ? parseDecimal(price, decimals) : null;
  const priceMinor = perShown != null ? pricePerBaseUnit(perShown, unitCode) : null;
  const digits = priceDigits(decimals, unitCode);
  const priceErr = !price.trim()
    ? submitted ? "Set your price." : undefined
    : perShown == null || priceMinor == null
      ? digits ? `Use at most ${digits} decimals for a price per ${unit.short}.` : `Prices per ${unit.short} must be whole ${symbol}.`
      : priceMinor === 0n ? "The price must be above zero." : undefined;
  const expiresAt = expires ? endOfLocalDay(expires) : null;
  const expiresErr = expires && (expiresAt == null || expiresAt <= nowSeconds()) ? "Pick today or a later date." : undefined;
  const mintErr = !mintText.trim()
    ? submitted ? "Pick how customers pay." : undefined
    : !isAddress(mintText.trim()) ? "Paste a mint address." : mintInfo.data === null && !mintInfo.loading ? "No token mint at this address." : undefined;
  const notesErr = byteLength(notes.trim()) > MAX_NOTES ? "Up to 500 bytes." : undefined;
  const packErr = packRef.trim() && !isAddress(packRef.trim()) ? "Paste an account address, or leave it empty." : undefined;
  const valid =
    !!crop.trim() && !cropErr && !cultivarErr && base != null && base > 0n && priceMinor != null && priceMinor > 0n && !expiresErr && !!mint && !mintErr && !notesErr && !packErr;

  const name = warehouse?.data.name ?? "Your warehouse";
  const feeText = warehouse ? formatFeeBps(warehouse.data.feeBps) : "";

  const publish = async () => {
    setSubmitted(true);
    if (!valid || !mint || base == null || priceMinor == null) return;
    const offerId = freshId();
    const [offer] = await findOfferPda({ farmer: wallet, offerId });
    const payoutAccount = await tokenAccountOf(wallet, mint);
    const hasPayout = (await tokenBalance(payoutAccount)) != null;
    const ataRent = rent.data ? (mint.tokenProgram === TOKEN_2022_PROGRAM_ADDRESS ? rent.data.ata2022 : rent.data.ata) : null;
    run({
      title: "Publish offer",
      instruction: hasPayout ? "publish_offer" : "create_associated_token_account + publish_offer",
      description: `${crop.trim()}${cultivar.trim() ? ` ${cultivar.trim()}` : ""} goes on the market through ${name}. What you publish is public and permanent on Solana.`,
      lines: [
        ...(rent.data ? [{ label: "Offer account rent", value: formatSol(rent.data.offer), note: "Stays with the offer on Solana" }] : []),
        ...(!hasPayout && ataRent != null ? [{ label: "Payout account rent", value: formatSol(ataRent), note: `Your ${symbol} account, created once; payouts land here` }] : []),
        { label: "Network fee", value: NETWORK_FEE },
      ],
      build: async (signer) => [
        ...(hasPayout ? [] : [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: wallet, mint: mint.address, tokenProgram: mint.tokenProgram })]),
        await getPublishOfferInstructionAsync({
          mint: mint.address,
          farmer: signer,
          offerId,
          cropName: crop.trim(),
          cultivarName: cultivar.trim() || null,
          unitCode,
          qty: base,
          priceMinor,
          expiresAt: expiresAt ?? null,
          notesPublic: notes.trim() || null,
          packRef: packRef.trim() ? (toAddress(packRef.trim()) as Address) : null,
        }),
      ],
      onDone: () => navigate(`/farmer/offers/${offer}`),
      doneLabel: "See your offer",
    });
  };

  return (
    <Layout area="farmer">
      <div className="page">
        <NetworkNotices showPaused />
        <div className="stack gap-2 measure">
          <h1 className="t-display">Publish an offer</h1>
          <p className="t-body muted">What you write here is public and permanent on Solana. Customers see exactly this — no ranking, no reviews.</p>
        </div>
        <div className="split split-wide">
          <form
            className="split-main stack gap-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void publish();
            }}
          >
            <div className="form-grid-2">
              <Field label="Crop" hint="As customers will see it." error={cropErr}>
                <input className="kb-input" value={crop} onChange={(e) => setCrop(e.target.value)} />
              </Field>
              <Field label="Cultivar" optional error={cultivarErr}>
                <input className="kb-input" value={cultivar} onChange={(e) => setCultivar(e.target.value)} />
              </Field>
            </div>
            <div className="form-grid-3">
              <Field label="Sold by">
                <select className="kb-select" value={unitCode} onChange={(e) => setUnitCode(Number(e.target.value))}>
                  {UNITS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Quantity"
                affix={unit.short}
                error={qtyErr}
                hint={base != null && unit.base && base > 0n ? `Stored as ${base.toLocaleString("en-US")} ${unit.base}` : undefined}
              >
                <input className="kb-input kb-input-mono" inputMode={unit.factor > 1n ? "decimal" : "numeric"} value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field label={`Price per ${unit.short}`} affix={symbol} error={priceErr}>
                <input className="kb-input kb-input-mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
            </div>
            <div className="form-grid-2">
              <Field label="Expires" optional hint="After this date customers cannot order." error={expiresErr}>
                <input className="kb-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </Field>
              {allowed.length ? (
                <Field label="Paid in" hint="Mints the program accepts." error={mintErr}>
                  <select className="kb-select" value={mintText} onChange={(e) => setMintText(e.target.value)}>
                    {(mints.data ?? []).map((m) => (
                      <option key={m.address} value={m.address}>
                        {mintSymbol(m.address)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Paid in" hint="The program accepts any mint. Paste the token mint customers pay with." error={mintErr}>
                  <input className="kb-input kb-input-mono" placeholder="Mint address" value={mintText} onChange={(e) => setMintText(e.target.value)} />
                </Field>
              )}
            </div>
            <Field label="Notes for customers" optional hint="Up to 500 bytes. Harvest date, ripeness, packing." error={notesErr}>
              <textarea className="kb-input" rows={3} style={{ height: "auto", paddingTop: 8, paddingBottom: 8 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field label="Katūbayá pack reference" optional hint="Shown to customers as “Reference (unverified)”. The program does not check it." error={packErr}>
              <input className="kb-input kb-input-mono" placeholder="Pack account address" value={packRef} onChange={(e) => setPackRef(e.target.value)} />
            </Field>
            <Notice tone="info" title="Your wallet pays the account rent">
              Publishing creates this offer's account on Solana. {name}'s service fee{feeText ? ` (${feeText})` : ""} is taken from each sale when the order is
              fulfilled; you receive the rest.
            </Notice>
            <div className="row">
              <Button type="submit" variant="primary" size="lg">
                Publish offer
              </Button>
              <Link to="/farmer" className="kb-btn kb-btn-secondary kb-btn-lg">
                Cancel
              </Link>
            </div>
          </form>
          <aside aria-label="Preview" className="split-side stack gap-3">
            <span className="t-small muted">How customers will see it</span>
            <OfferCard
              crop={crop.trim() || "Crop"}
              cultivar={cultivar.trim() || undefined}
              unitCode={unit.code}
              qtyRemaining={(base ?? 0n).toString()}
              priceMinor={perShown ?? 0n}
              decimals={decimals}
              symbol={symbol}
              farmerName={farmer.data.displayName}
              farmerKey={wallet}
              warehouseName={warehouse?.data.name}
              expires={expiresAt ? formatOfferExpiry(expiresAt) : undefined}
              notes={notes.trim() || undefined}
              buyLabel="Order"
            />
            <span className="t-small muted">Photos are not part of the offer on Solana yet, so the card shows “No photo yet”.</span>
          </aside>
        </div>
      </div>
    </Layout>
  );
}

function fromMinor(minor: bigint, decimals: number): string {
  if (decimals === 0) return minor.toString();
  const s = minor.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac.length < 2 ? `${whole}.${frac.padEnd(2, "0")}` : `${whole}.${frac}`;
}

export function FarmerPublish() {
  return <FarmerGate>{(f) => <PublishPage {...f} />}</FarmerGate>;
}
