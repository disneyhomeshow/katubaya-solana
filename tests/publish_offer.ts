import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";
import {
  program, provider, payer, BN, Keypair, offerPDA, freshId, fails, fund, events, setPaused,
  createWarehouse, registerFarmer, approvedFarmer, offerArgs, publishOfferTx, feeMint, DECIMALS,
} from "./helpers";

describe("publish_offer", () => {
  let operator: anchor.web3.Keypair;
  let warehouse: anchor.web3.PublicKey;
  let farmer: anchor.web3.Keypair;
  before(async () => {
    operator = await fund();
    warehouse = await createWarehouse(operator.publicKey);
    farmer = await approvedFarmer(warehouse, operator);
  });

  const publish = (o: Partial<ReturnType<typeof offerArgs>> = {}, id = freshId(), f = farmer) =>
    publishOfferTx(f, id, o);

  it("creates an active offer with every field and emits OfferPublished", async () => {
    const id = freshId();
    const a = offerArgs();
    const now = Math.floor(Date.now() / 1000);
    const evs = await events(publish(a, id));
    expect(evs.map((e) => e.name)).to.deep.equal(["offerPublished"]);
    const ev = evs[0].data;
    expect(ev.offer.equals(offerPDA(farmer.publicKey, id))).to.be.true;
    expect(ev.farmer.equals(farmer.publicKey)).to.be.true;
    expect(ev.warehouse.equals(warehouse)).to.be.true;
    expect(ev.cropName).to.equal(a.crop);
    expect(ev.cultivarName).to.equal(a.cultivar);
    expect(ev.unitCode).to.equal(a.unitCode);
    expect(ev.qty.toNumber()).to.equal(500);
    expect(ev.priceMinor.toNumber()).to.equal(1_000_000);
    expect(ev.mint.equals(a.mint)).to.be.true;
    expect(ev.expiresAt.toNumber()).to.equal(a.expiresAt.toNumber());

    const o = await program.account.lotOffer.fetch(offerPDA(farmer.publicKey, id));
    expect(o.farmer.equals(farmer.publicKey)).to.be.true;
    expect(o.warehouse.equals(warehouse)).to.be.true;
    expect(o.offerId.toNumber()).to.equal(id);
    expect(o.packRef).to.equal(null);
    expect(o.cropName).to.equal(a.crop);
    expect(o.cultivarName).to.equal(a.cultivar);
    expect(o.unitCode).to.equal(a.unitCode);
    expect(o.expiresAt.toNumber()).to.equal(a.expiresAt.toNumber());
    expect(o.notesPublic).to.equal(a.notes);
    expect(o.mint.equals(a.mint)).to.be.true;
    expect(o.priceMinor.toNumber()).to.equal(1_000_000);
    expect(o.qtyRemaining.toNumber()).to.equal(500);
    expect(o.active).to.equal(true);
    expect(o.createdAt.toNumber()).to.be.within(now - 5, now + 60);
  });

  it("accepts missing cultivar, expiry, notes and pack_ref", async () => {
    const id = freshId();
    await publish({ cultivar: null, expiresAt: null, notes: null, packRef: null }, id).rpc();
    const o = await program.account.lotOffer.fetch(offerPDA(farmer.publicKey, id));
    expect(o.cultivarName).to.equal(null);
    expect(o.expiresAt).to.equal(null);
    expect(o.notesPublic).to.equal(null);
    expect(o.packRef).to.equal(null);
  });

  it("stores pack_ref when given", async () => {
    const id = freshId();
    const packRef = Keypair.generate().publicKey;
    await publish({ packRef }, id).rpc();
    const o = await program.account.lotOffer.fetch(offerPDA(farmer.publicKey, id));
    expect(o.packRef.equals(packRef)).to.be.true;
  });

  it("rejects a farmer not yet approved by the warehouse", async () => {
    const { farmer: pending } = await registerFarmer(warehouse);
    expect(await fails(publish({}, freshId(), pending).rpc())).to.equal("FarmerNotApproved");
  });

  it("rejects a mint outside the allowlist", async () => {
    const unlisted = await createMint(provider.connection, payer, payer.publicKey, null, DECIMALS);
    expect(await fails(publish({ mint: unlisted }).rpc())).to.equal("MintNotAllowed");
  });

  it("rejects a pubkey that is not a mint account", async () => {
    expect(await fails(publish({ mint: Keypair.generate().publicKey }).rpc())).to.equal("AccountNotInitialized");
  });

  // Defence in depth behind the allowlist: a transfer fee is withheld on the receiving account, so the
  // escrow would hold less than the subtotal and could never be closed. feeMint() IS allowlisted.
  it("rejects an allowlisted mint that charges a transfer fee", async () => {
    expect(await fails(publish({ mint: feeMint() }).rpc())).to.equal("MintExtensionNotAllowed");
  });

  it("rejects while the program is paused", async () => {
    await setPaused(true);
    try {
      expect(await fails(publish().rpc())).to.equal("ProgramPaused");
    } finally {
      await setPaused(false);
    }
  });

  it("rejects crop_name above MAX_NAME_LEN", async () => {
    expect(await fails(publish({ crop: "x".repeat(101) }).rpc())).to.equal("NameTooLong");
  });

  it("rejects cultivar_name above MAX_NAME_LEN", async () => {
    expect(await fails(publish({ cultivar: "x".repeat(101) }).rpc())).to.equal("NameTooLong");
  });

  it("rejects notes_public above MAX_NOTES_LEN", async () => {
    expect(await fails(publish({ notes: "x".repeat(501) }).rpc())).to.equal("NotesTooLong");
  });

  it("rejects qty of zero", async () => {
    expect(await fails(publish({ qty: new BN(0) }).rpc())).to.equal("InvalidQuantity");
  });

  it("rejects price of zero", async () => {
    expect(await fails(publish({ price: new BN(0) }).rpc())).to.equal("InvalidPrice");
  });

  it("rejects expires_at in the past", async () => {
    const past = new BN(Math.floor(Date.now() / 1000) - 60);
    expect(await fails(publish({ expiresAt: past }).rpc())).to.equal("InvalidExpiry");
  });

  it("rejects a duplicate offer_id", async () => {
    const id = freshId();
    await publish({}, id).rpc();
    expect(await fails(publish({}, id).rpc())).to.include("already in use");
  });
});
