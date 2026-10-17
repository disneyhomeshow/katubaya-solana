import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, fails, fund, events, createOrder, market, quoteFee, readyOrder, testMint,
} from "./helpers";

describe("mark_in_transit", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  const transit = (order: anchor.PublicKey, signer = m.operator) =>
    program.methods
      .markInTransit()
      .accountsPartial({ order, warehouse: m.warehouse, operator: signer.publicKey })
      .signers([signer]);
  const status = async (order: anchor.PublicKey) => (await program.account.order.fetch(order)).status;

  it("moves a pickup order from EscrowedPickup to InTransit and emits OrderInTransit", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    const evs = await events(transit(order));
    expect(evs.map((e) => e.name)).to.deep.equal(["orderInTransit"]);
    expect(evs[0].data.order.equals(order)).to.be.true;
    expect(await status(order)).to.deep.equal({ inTransit: {} });
  });

  it("moves a delivery order from EscrowedReady to InTransit", async () => {
    const order = await readyOrder(m);
    await transit(order).rpc();
    expect(await status(order)).to.deep.equal({ inTransit: {} });
  });

  it("rejects a delivery order still waiting for a quote", async () => {
    const pending = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    expect(await fails(transit(pending).rpc())).to.equal("InvalidOrderStatus");
  });

  it("rejects a delivery order whose quote was not accepted", async () => {
    const quoted = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    await quoteFee(quoted, m);
    expect(await fails(transit(quoted).rpc())).to.equal("InvalidOrderStatus");
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    expect(await fails(transit(order, await fund()).rpc())).to.equal("UnauthorizedOperator");
  });

  it("rejects an order already in transit", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    await transit(order).rpc();
    expect(await fails(transit(order).rpc())).to.equal("InvalidOrderStatus");
  });

  it("blocks refuse_delivery and reject_delivery_fee once in transit", async () => {
    const order = await readyOrder(m);
    await transit(order).rpc();
    const refuse = program.methods
      .refuseDelivery()
      .accountsPartial({
        order,
        warehouse: m.warehouse,
        offer: m.offer,
        mint: testMint(),
        customerTokenAccount: m.buyer.ata,
        operator: m.operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([m.operator])
      .rpc();
    expect(await fails(refuse)).to.equal("InvalidOrderStatus");
    const reject = program.methods
      .rejectDeliveryFee()
      .accountsPartial({
        order,
        offer: m.offer,
        mint: testMint(),
        customerTokenAccount: m.buyer.ata,
        customer: m.buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([m.buyer.customer])
      .rpc();
    expect(await fails(reject)).to.equal("InvalidOrderStatus");
  });
});
