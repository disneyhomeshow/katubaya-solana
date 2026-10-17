import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { program, BN, fails, fund, events, createWarehouse, createOrder, market, H6 } from "./helpers";

describe("quote_delivery_fee", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  const delivery = () => createOrder(m.buyer, m.offer, m.warehouse, "delivery");
  const quote = (order: anchor.PublicKey, fee = 500_000, signer = m.operator, warehouse = m.warehouse) =>
    program.methods
      .quoteDeliveryFee(new BN(fee))
      .accountsPartial({ order, warehouse, operator: signer.publicKey })
      .signers([signer]);

  it("stores the fee, moves to DeliveryQuoted and emits DeliveryFeeQuoted", async () => {
    const order = await delivery();
    const evs = await events(quote(order));
    expect(evs.map((e) => e.name)).to.deep.equal(["deliveryFeeQuoted"]);
    expect(evs[0].data.order.equals(order)).to.be.true;
    expect(evs[0].data.deliveryFeeMinor.toNumber()).to.equal(500_000);
    const o = await program.account.order.fetch(order);
    expect(o.deliveryFeeMinor.toNumber()).to.equal(500_000);
    expect(o.status).to.deep.equal({ deliveryQuoted: {} });
    const now = Math.floor(Date.now() / 1000);
    expect(o.expiresAt.toNumber()).to.be.within(now + H6 - 60, now + H6 + 60);
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    expect(await fails(quote(await delivery(), 1, await fund()).rpc())).to.equal("UnauthorizedOperator");
  });

  it("rejects a warehouse that is not the order's", async () => {
    const other = await createWarehouse(m.operator.publicKey);
    expect(await fails(quote(await delivery(), 1, m.operator, other).rpc())).to.equal("WarehouseMismatch");
  });

  it("rejects a pickup order", async () => {
    const pickup = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    expect(await fails(quote(pickup).rpc())).to.equal("InvalidOrderStatus");
  });

  it("rejects an order that is already quoted", async () => {
    const order = await delivery();
    await quote(order).rpc();
    expect(await fails(quote(order).rpc())).to.equal("InvalidOrderStatus");
  });
});
