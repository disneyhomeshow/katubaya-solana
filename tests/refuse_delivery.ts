import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, BN, fails, fund, events, createOrder, market, tokenBalance, escrowPDA, fundTokens, testMint,
} from "./helpers";

describe("refuse_delivery", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  const delivery = () => createOrder(m.buyer, m.offer, m.warehouse, "delivery");
  const quote = (order: anchor.PublicKey) =>
    program.methods
      .quoteDeliveryFee(new BN(500_000))
      .accountsPartial({ order, warehouse: m.warehouse, operator: m.operator.publicKey })
      .signers([m.operator])
      .rpc();
  const accept = (order: anchor.PublicKey) =>
    program.methods
      .acceptDeliveryFee()
      .accountsPartial({
        order,
        mint: testMint(),
        customerTokenAccount: m.buyer.ata,
        customer: m.buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([m.buyer.customer])
      .rpc();
  const refuse = (order: anchor.PublicKey, signer = m.operator, destination = m.buyer.ata) =>
    program.methods
      .refuseDelivery()
      .accountsPartial({
        order,
        warehouse: m.warehouse,
        offer: m.offer,
        mint: testMint(),
        customerTokenAccount: destination,
        operator: signer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer]);

  const snapshot = async () => ({
    balance: await tokenBalance(m.buyer.ata),
    stock: (await program.account.lotOffer.fetch(m.offer)).qtyRemaining.toNumber(),
  });
  const expectRestored = async (order: anchor.PublicKey, s: { balance: number; stock: number }) => {
    expect(await tokenBalance(m.buyer.ata)).to.equal(s.balance);
    expect(await tokenBalance(escrowPDA(order))).to.equal(0);
    expect((await program.account.lotOffer.fetch(m.offer)).qtyRemaining.toNumber()).to.equal(s.stock);
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ refused: {} });
  };

  it("refunds a pending order, restores stock and emits OrderRefused", async () => {
    const s = await snapshot();
    const order = await delivery();
    const evs = await events(refuse(order));
    expect(evs.map((e) => e.name)).to.deep.equal(["orderRefused"]);
    expect(evs[0].data.order.equals(order)).to.be.true;
    await expectRestored(order, s);
  });

  it("refunds a quoted order", async () => {
    const s = await snapshot();
    const order = await delivery();
    await quote(order);
    await refuse(order).rpc();
    await expectRestored(order, s);
  });

  it("refunds subtotal plus accepted fee on a ready order", async () => {
    const s = await snapshot();
    const order = await delivery();
    await quote(order);
    await accept(order);
    expect(await tokenBalance(escrowPDA(order))).to.equal(10_000_000 + 500_000);
    await refuse(order).rpc();
    await expectRestored(order, s);
  });

  it("rejects a pickup order", async () => {
    const pickup = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    expect(await fails(refuse(pickup).rpc())).to.equal("NotDeliveryOrder");
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    expect(await fails(refuse(await delivery(), await fund()).rpc())).to.equal("UnauthorizedOperator");
  });

  it("rejects a refund destination not owned by the customer", async () => {
    const strangerAta = await fundTokens(await fund(), 0);
    expect(await fails(refuse(await delivery(), m.operator, strangerAta).rpc())).to.equal("UnauthorizedCustomer");
  });

  it("rejects an order that is already refused", async () => {
    const order = await delivery();
    await refuse(order).rpc();
    expect(await fails(refuse(order).rpc())).to.equal("InvalidOrderStatus");
  });
});
