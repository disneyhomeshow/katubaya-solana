import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, fails, fund, events, logisticsWallet, createWarehouse, approvedFarmer, publishOffer,
  confirmedCustomer, createOrder, market, markInTransit, readyOrder, ataOf, tokenBalance, escrowPDA,
  testMint, SUBTOTAL, SERVICE_FEE,
} from "./helpers";

describe("complete_order", () => {
  let m: Awaited<ReturnType<typeof market>>;
  let farmerAta: anchor.PublicKey;
  let logisticsAta: anchor.PublicKey;
  before(async () => {
    m = await market();
    farmerAta = await ataOf(m.farmer.publicKey);
    logisticsAta = await ataOf(logisticsWallet);
  });

  type Overrides = Partial<{ signer: anchor.Keypair; farmerAta: anchor.PublicKey; logisticsAta: anchor.PublicKey; warehouse: anchor.PublicKey }>;
  const complete = (order: anchor.PublicKey, o: Overrides = {}) => {
    const signer = o.signer ?? m.operator;
    return program.methods
      .completeOrder()
      .accountsPartial({
        order,
        warehouse: o.warehouse ?? m.warehouse,
        mint: testMint(),
        farmerTokenAccount: o.farmerAta ?? farmerAta,
        logisticsTokenAccount: o.logisticsAta ?? logisticsAta,
        operator: signer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer]);
  };
  const inTransitPickup = async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    await markInTransit(order, m);
    return order;
  };
  const balances = async () => ({ farmer: await tokenBalance(farmerAta), logistics: await tokenBalance(logisticsAta) });

  it("pays the farmer and logistics from a pickup order and emits OrderCompleted", async () => {
    const order = await inTransitPickup();
    const b = await balances();
    const evs = await events(complete(order));
    expect(evs.map((e) => e.name)).to.deep.equal(["orderCompleted"]);
    const ev = evs[0].data;
    expect(ev.order.equals(order)).to.be.true;
    expect(ev.subtotalMinor.toNumber()).to.equal(SUBTOTAL);
    expect(ev.serviceFeeMinor.toNumber()).to.equal(SERVICE_FEE);
    expect(ev.deliveryFeeMinor.toNumber()).to.equal(0);
    expect(ev.farmerPayout.toNumber()).to.equal(SUBTOTAL - SERVICE_FEE);
    expect(ev.logisticsPayout.toNumber()).to.equal(SERVICE_FEE);

    expect(await tokenBalance(farmerAta)).to.equal(b.farmer + SUBTOTAL - SERVICE_FEE);
    expect(await tokenBalance(logisticsAta)).to.equal(b.logistics + SERVICE_FEE);
    expect(await tokenBalance(escrowPDA(order))).to.equal(0);
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ fulfilled: {} });
  });

  it("adds the delivery fee to the logistics payout", async () => {
    const order = await readyOrder(m, 500_000);
    await markInTransit(order, m);
    const b = await balances();
    await complete(order).rpc();
    expect(await tokenBalance(farmerAta)).to.equal(b.farmer + SUBTOTAL - SERVICE_FEE);
    expect(await tokenBalance(logisticsAta)).to.equal(b.logistics + SERVICE_FEE + 500_000);
    expect(await tokenBalance(escrowPDA(order))).to.equal(0);
  });

  it("pays the farmer everything when the warehouse fee is zero", async () => {
    const operator = await fund();
    const warehouse = await createWarehouse(operator.publicKey, undefined, 0);
    const farmer = await approvedFarmer(warehouse, operator);
    const offer = await publishOffer(farmer);
    const buyer = await confirmedCustomer(warehouse, operator);
    const order = await createOrder(buyer, offer, warehouse, "pickup");
    const free = { operator, warehouse, farmer, offer, buyer };
    await markInTransit(order, free);
    const fAta = await ataOf(farmer.publicKey);
    const b = await tokenBalance(logisticsAta);
    await complete(order, { signer: operator, warehouse, farmerAta: fAta }).rpc();
    expect(await tokenBalance(fAta)).to.equal(SUBTOTAL);
    expect(await tokenBalance(logisticsAta)).to.equal(b);
  });

  it("rejects an order that is not in transit", async () => {
    const ready = await readyOrder(m);
    expect(await fails(complete(ready).rpc())).to.equal("InvalidOrderStatus");
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    expect(await fails(complete(await inTransitPickup(), { signer: await fund() }).rpc())).to.equal("UnauthorizedOperator");
  });

  it("rejects a farmer token account owned by someone else", async () => {
    expect(await fails(complete(await inTransitPickup(), { farmerAta: logisticsAta }).rpc())).to.equal("FarmerTokenAccountMismatch");
  });

  it("rejects a logistics token account owned by someone else", async () => {
    expect(await fails(complete(await inTransitPickup(), { logisticsAta: farmerAta }).rpc())).to.equal("LogisticsTokenAccountMismatch");
  });

  it("rejects an order already fulfilled", async () => {
    const order = await inTransitPickup();
    await complete(order).rpc();
    expect(await fails(complete(order).rpc())).to.equal("InvalidOrderStatus");
  });
});
