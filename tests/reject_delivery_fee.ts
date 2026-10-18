import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, BN, fails, events, createOrder, market, confirmedCustomer, publishOffer, tokenBalance, escrowClosed,
  testMint, Buyer,
} from "./helpers";

describe("reject_delivery_fee", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  const quoted = async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    await program.methods
      .quoteDeliveryFee(new BN(500_000))
      .accountsPartial({ order, warehouse: m.warehouse, operator: m.operator.publicKey })
      .signers([m.operator])
      .rpc();
    return order;
  };
  const reject = (order: anchor.PublicKey, buyer: Buyer = m.buyer, offer = m.offer) =>
    program.methods
      .rejectDeliveryFee()
      .accountsPartial({
        order,
        offer,
        mint: testMint(),
        customerTokenAccount: buyer.ata,
        customer: buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer.customer]);

  it("refunds the subtotal, restores stock, cancels and emits DeliveryFeeRejected", async () => {
    const balance = await tokenBalance(m.buyer.ata);
    const stock = (await program.account.lotOffer.fetch(m.offer)).qtyRemaining.toNumber();
    const order = await quoted();
    expect(await tokenBalance(m.buyer.ata)).to.be.below(balance);

    const evs = await events(reject(order));
    expect(evs.map((e) => e.name)).to.deep.equal(["deliveryFeeRejected"]);
    expect(evs[0].data.order.equals(order)).to.be.true;
    expect(await tokenBalance(m.buyer.ata)).to.equal(balance);
    expect(await escrowClosed(order)).to.be.true;
    expect((await program.account.lotOffer.fetch(m.offer)).qtyRemaining.toNumber()).to.equal(stock);
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ canceled: {} });
  });

  it("rejects an order that was not quoted", async () => {
    const pending = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    expect(await fails(reject(pending).rpc())).to.equal("InvalidOrderStatus");
  });

  it("rejects a signer that is not the order's customer", async () => {
    const other = await confirmedCustomer(m.warehouse, m.operator);
    expect(await fails(reject(await quoted(), other).rpc())).to.equal("UnauthorizedCustomer");
  });

  it("rejects an offer that is not the order's", async () => {
    const other = await publishOffer(m.farmer);
    expect(await fails(reject(await quoted(), m.buyer, other).rpc())).to.equal("OfferMismatch");
  });
});
