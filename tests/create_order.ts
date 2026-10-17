import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import {
  program, provider, payer, BN, Keypair, PublicKey, fails, fund, events, freshId, setPaused,
  createWarehouse, registerCustomer, requestConfirmation, publishOffer, fundTokens, tokenBalance,
  confirmedCustomer, createOrderTx, createOrder, orderPDA, escrowPDA, market, testMint, DECIMALS,
  SUBTOTAL, SERVICE_FEE, H6, H72,
} from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("create_order", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  const create = (mode: "pickup" | "delivery", o: Partial<{ qty: number; offer: anchor.PublicKey; warehouse: anchor.PublicKey; buyer: typeof m.buyer; mint: anchor.PublicKey }> = {}, id = freshId()) =>
    createOrderTx(o.buyer ?? m.buyer, o.offer ?? m.offer, o.warehouse ?? m.warehouse, id, o.qty ?? 10, mode, o.mint ?? testMint());

  it("escrows the subtotal, reserves stock and emits OrderCreated (pickup)", async () => {
    const id = freshId();
    const order = orderPDA(m.offer, m.buyer.customer.publicKey, id);
    const before = await tokenBalance(m.buyer.ata);
    const stockBefore = (await program.account.lotOffer.fetch(m.offer)).qtyRemaining.toNumber();

    const evs = await events(create("pickup", {}, id));
    expect(evs.map((e) => e.name)).to.deep.equal(["orderCreated"]);
    const ev = evs[0].data;
    expect(ev.order.equals(order)).to.be.true;
    expect(ev.offer.equals(m.offer)).to.be.true;
    expect(ev.farmer.equals(m.farmer.publicKey)).to.be.true;
    expect(ev.warehouse.equals(m.warehouse)).to.be.true;
    expect(ev.customer.equals(m.buyer.customer.publicKey)).to.be.true;
    expect(ev.qty.toNumber()).to.equal(10);
    expect(ev.subtotalMinor.toNumber()).to.equal(SUBTOTAL);
    expect(ev.serviceFeeMinor.toNumber()).to.equal(SERVICE_FEE);
    expect(ev.mode).to.deep.equal({ pickup: {} });

    expect(await tokenBalance(m.buyer.ata)).to.equal(before - SUBTOTAL);
    expect(await tokenBalance(escrowPDA(order))).to.equal(SUBTOTAL);
    expect((await program.account.lotOffer.fetch(m.offer)).qtyRemaining.toNumber()).to.equal(stockBefore - 10);

    const o = await program.account.order.fetch(order);
    expect(o.orderId.toNumber()).to.equal(id);
    expect(o.offer.equals(m.offer)).to.be.true;
    expect(o.farmer.equals(m.farmer.publicKey)).to.be.true;
    expect(o.warehouse.equals(m.warehouse)).to.be.true;
    expect(o.customer.equals(m.buyer.customer.publicKey)).to.be.true;
    expect(o.mint.equals(testMint())).to.be.true;
    expect(o.qty.toNumber()).to.equal(10);
    expect(o.subtotalMinor.toNumber()).to.equal(SUBTOTAL);
    expect(o.serviceFeeMinor.toNumber()).to.equal(SERVICE_FEE);
    expect(o.deliveryFeeMinor.toNumber()).to.equal(0);
    expect(o.fulfillmentMode).to.deep.equal({ pickup: {} });
    expect(o.status).to.deep.equal({ escrowedPickup: {} });
    expect(o.expiresAt.toNumber() - o.createdAt.toNumber()).to.equal(H72);
    const [, bump] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), order.toBuffer()], program.programId);
    expect(o.escrowBump).to.equal(bump);
  });

  it("starts a delivery order as PendingDeliveryQuote with the short expiry", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    const o = await program.account.order.fetch(order);
    expect(o.fulfillmentMode).to.deep.equal({ delivery: {} });
    expect(o.status).to.deep.equal({ pendingDeliveryQuote: {} });
    expect(o.expiresAt.toNumber() - o.createdAt.toNumber()).to.equal(H6);
  });

  it("rejects a customer whose confirmation is still pending", async () => {
    const customer = await registerCustomer();
    await requestConfirmation(m.warehouse, customer);
    const ata = await fundTokens(customer, SUBTOTAL);
    expect(await fails(create("pickup", { buyer: { customer, ata } }).rpc())).to.equal("CustomerNotConfirmed");
  });

  it("rejects a revoked customer", async () => {
    const buyer = await confirmedCustomer(m.warehouse, m.operator);
    await program.methods
      .revokeCustomer()
      .accountsPartial({
        warehouseCustomer: PublicKey.findProgramAddressSync(
          [Buffer.from("wcustomer"), m.warehouse.toBuffer(), buyer.customer.publicKey.toBuffer()],
          program.programId
        )[0],
        warehouse: m.warehouse,
        operator: m.operator.publicKey,
      })
      .signers([m.operator])
      .rpc();
    expect(await fails(create("pickup", { buyer }).rpc())).to.equal("CustomerNotConfirmed");
  });

  it("rejects a customer that never requested confirmation", async () => {
    const customer = await registerCustomer();
    const ata = await fundTokens(customer, SUBTOTAL);
    expect(await fails(create("pickup", { buyer: { customer, ata } }).rpc())).to.equal("AccountNotInitialized");
  });

  it("rejects an inactive offer", async () => {
    const offer = await publishOffer(m.farmer);
    await program.methods.deactivateOffer().accountsPartial({ offer, farmer: m.farmer.publicKey }).signers([m.farmer]).rpc();
    expect(await fails(create("pickup", { offer }).rpc())).to.equal("OfferInactive");
  });

  it("rejects an expired offer", async () => {
    const offer = await publishOffer(m.farmer, { expiresAt: new BN(Math.floor(Date.now() / 1000) + 2) });
    await sleep(4000);
    expect(await fails(create("pickup", { offer }).rpc())).to.equal("OfferExpired");
  });

  it("rejects qty above the remaining stock", async () => {
    expect(await fails(create("pickup", { qty: 501 }).rpc())).to.equal("InsufficientStock");
  });

  it("rejects qty of zero", async () => {
    expect(await fails(create("pickup", { qty: 0 }).rpc())).to.equal("InvalidQuantity");
  });

  it("rejects while the program is paused", async () => {
    await setPaused(true);
    try {
      expect(await fails(create("pickup").rpc())).to.equal("ProgramPaused");
    } finally {
      await setPaused(false);
    }
  });

  it("rejects a warehouse that is not the offer's", async () => {
    const other = await createWarehouse(m.operator.publicKey);
    expect(await fails(create("pickup", { warehouse: other }).rpc())).to.equal("WarehouseMismatch");
  });

  it("rejects a mint that is not the offer's", async () => {
    const other = await createMint(provider.connection, payer, payer.publicKey, null, DECIMALS);
    expect(await fails(create("pickup", { mint: other }).rpc())).to.equal("MintMismatch");
  });

  it("rejects a customer without enough tokens", async () => {
    const poor = await confirmedCustomer(m.warehouse, m.operator, 1);
    expect(await fails(create("pickup", { buyer: poor }).rpc())).to.include("0x1");
  });

  it("rejects a duplicate order_id", async () => {
    const id = freshId();
    await create("pickup", {}, id).rpc();
    expect(await fails(create("pickup", {}, id).rpc())).to.include("already in use");
  });
});
