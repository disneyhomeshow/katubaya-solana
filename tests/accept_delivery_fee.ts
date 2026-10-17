import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, BN, fails, events, createOrder, market, confirmedCustomer, tokenBalance, escrowPDA, testMint,
  SUBTOTAL, H72, Buyer,
} from "./helpers";

describe("accept_delivery_fee", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  const quoted = async (fee = 500_000) => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    await program.methods
      .quoteDeliveryFee(new BN(fee))
      .accountsPartial({ order, warehouse: m.warehouse, operator: m.operator.publicKey })
      .signers([m.operator])
      .rpc();
    return order;
  };
  const accept = (order: anchor.PublicKey, buyer: Buyer = m.buyer) =>
    program.methods
      .acceptDeliveryFee()
      .accountsPartial({
        order,
        mint: testMint(),
        customerTokenAccount: buyer.ata,
        customer: buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer.customer]);

  it("escrows the fee, moves to EscrowedReady and emits DeliveryFeeAccepted", async () => {
    const order = await quoted();
    const before = await tokenBalance(m.buyer.ata);
    const evs = await events(accept(order));
    expect(evs.map((e) => e.name)).to.deep.equal(["deliveryFeeAccepted"]);
    expect(evs[0].data.order.equals(order)).to.be.true;
    expect(await tokenBalance(m.buyer.ata)).to.equal(before - 500_000);
    expect(await tokenBalance(escrowPDA(order))).to.equal(SUBTOTAL + 500_000);
    const o = await program.account.order.fetch(order);
    expect(o.status).to.deep.equal({ escrowedReady: {} });
    const now = Math.floor(Date.now() / 1000);
    expect(o.expiresAt.toNumber()).to.be.within(now + H72 - 60, now + H72 + 60);
  });

  it("accepts a zero fee", async () => {
    const order = await quoted(0);
    const before = await tokenBalance(m.buyer.ata);
    await accept(order).rpc();
    expect(await tokenBalance(m.buyer.ata)).to.equal(before);
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ escrowedReady: {} });
  });

  it("rejects a signer that is not the order's customer", async () => {
    const other = await confirmedCustomer(m.warehouse, m.operator);
    expect(await fails(accept(await quoted(), other).rpc())).to.equal("UnauthorizedCustomer");
  });

  it("rejects an order that was not quoted", async () => {
    const pending = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    expect(await fails(accept(pending).rpc())).to.equal("InvalidOrderStatus");
  });
});
