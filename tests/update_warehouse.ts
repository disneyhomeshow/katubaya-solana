import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, BN, fails, fund, events, createOrder, market, markInTransit, ataOf, logisticsWallet,
  testMint, warehousePDA, SERVICE_FEE,
} from "./helpers";

type Prefix = { prefix: number; len: number };
type Patch = Partial<{ operator: anchor.PublicKey; pickupNotes: string; feeBps: number; prefixes: Prefix[] }>;

describe("update_warehouse", () => {
  // Admin-signed, not operator-signed: a lost operator key cannot sign its own rotation.
  const update = (id: number, p: Patch = {}, admin?: anchor.Keypair) => {
    const b = program.methods.updateWarehouse(
      new BN(id),
      p.operator ?? null,
      p.pickupNotes ?? null,
      p.feeBps ?? null,
      p.prefixes ?? null
    );
    return admin ? b.accountsPartial({ admin: admin.publicKey }).signers([admin]) : b;
  };

  it("patches only the fields given", async () => {
    const m = await market();
    const before = await program.account.warehouse.fetch(m.warehouse);
    const prefixes = [{ prefix: 4567, len: 4 }, { prefix: 98765, len: 5 }];
    await update(m.warehouseId, { pickupNotes: "Dock 7", feeBps: 100, prefixes }).rpc();

    const w = await program.account.warehouse.fetch(m.warehouse);
    expect(w.pickupNotes).to.equal("Dock 7");
    expect(w.feeBps).to.equal(100);
    expect(w.deliverZipPrefixes).to.deep.equal(prefixes);
    expect(w.operator.equals(before.operator)).to.be.true;
    expect(w.name).to.equal(before.name);
    expect(w.deliveryFeeRulesUri).to.equal(before.deliveryFeeRulesUri);
    expect(w.warehouseId.toNumber()).to.equal(before.warehouseId.toNumber());
  });

  it("keeps every field when no argument is given", async () => {
    const m = await market();
    const before = await program.account.warehouse.fetch(m.warehouse);
    await update(m.warehouseId).rpc();
    expect(await program.account.warehouse.fetch(m.warehouse)).to.deep.equal(before);
  });

  // The reason this instruction exists: an order already IN_TRANSIT has no other exit, so an
  // operator that loses its key would strand the escrow forever.
  it("rotates the operator so a stuck in-transit order can still be completed", async () => {
    const m = await market();
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    await markInTransit(order, m);

    const rescue = await fund();
    const evs = await events(update(m.warehouseId, { operator: rescue.publicKey }));
    expect(evs).to.deep.equal([]);
    expect((await program.account.warehouse.fetch(m.warehouse)).operator.equals(rescue.publicKey)).to.be.true;

    const farmerAta = await ataOf(m.farmer.publicKey);
    const logisticsAta = await ataOf(logisticsWallet);
    const complete = (signer: anchor.Keypair) =>
      program.methods
        .completeOrder()
        .accountsPartial({
          order,
          warehouse: m.warehouse,
          mint: testMint(),
          farmerTokenAccount: farmerAta,
          logisticsTokenAccount: logisticsAta,
          operator: signer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([signer]);

    expect(await fails(complete(m.operator).rpc())).to.equal("UnauthorizedOperator");
    await complete(rescue).rpc();
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ fulfilled: {} });
  });

  it("does not change the service fee of an order already created", async () => {
    const m = await market();
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    await update(m.warehouseId, { feeBps: 10_000 }).rpc();
    expect((await program.account.order.fetch(order)).serviceFeeMinor.toNumber()).to.equal(SERVICE_FEE);
  });

  it("rejects a signer that is not config.admin", async () => {
    const m = await market();
    expect(await fails(update(m.warehouseId, { feeBps: 50 }, await fund()).rpc())).to.equal("UnauthorizedAdmin");
  });

  it("rejects a warehouse that does not exist", async () => {
    expect(await fails(update(999_999_999, { feeBps: 50 }).rpc())).to.equal("AccountNotInitialized");
  });

  it("rejects fee_bps above MAX_FEE_BPS", async () => {
    const m = await market();
    expect(await fails(update(m.warehouseId, { feeBps: 10_001 }).rpc())).to.equal("FeeBpsTooHigh");
  });

  it("rejects pickup_notes above MAX_NOTES_LEN", async () => {
    const m = await market();
    expect(await fails(update(m.warehouseId, { pickupNotes: "x".repeat(501) }).rpc())).to.equal("NotesTooLong");
  });

  it("rejects more than MAX_ZIP_PREFIXES prefixes", async () => {
    const m = await market();
    const many = Array.from({ length: 101 }, (_, i) => ({ prefix: 10_000 + i, len: 5 }));
    expect(await fails(update(m.warehouseId, { prefixes: many }).rpc())).to.equal("TooManyZipPrefixes");
  });

  it("rejects a zip prefix length outside 3..5", async () => {
    const m = await market();
    expect(await fails(update(m.warehouseId, { prefixes: [{ prefix: 12, len: 2 }] }).rpc())).to.equal("InvalidZipPrefixLen");
  });

  it("derives the warehouse from the id argument", async () => {
    const m = await market();
    await update(m.warehouseId, { feeBps: 7 }).rpc();
    expect((await program.account.warehouse.fetch(warehousePDA(m.warehouseId))).feeBps).to.equal(7);
  });
});
