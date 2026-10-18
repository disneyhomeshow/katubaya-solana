import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, fails, fund, createOrder, market, markInTransit, publishOffer, fundTokens, testMint,
  token2022Mint,
} from "./helpers";

// Gate tests only: `expires_at` comes from the 6 h / 72 h constants, so the refund path
// needs a controlled clock and lives in tests/expire_order_clock.ts.
describe("expire_order", () => {
  let m: Awaited<ReturnType<typeof market>>;
  before(async () => {
    m = await market();
  });

  type Overrides = Partial<{ customerAta: anchor.PublicKey; offer: anchor.PublicKey; mint: anchor.PublicKey }>;
  // Permissionless: nobody related to the order signs, the provider wallet only pays the fee.
  const expire = (order: anchor.PublicKey, o: Overrides = {}) =>
    program.methods.expireOrder().accountsPartial({
      order,
      offer: o.offer ?? m.offer,
      mint: o.mint ?? testMint(),
      customerTokenAccount: o.customerAta ?? m.buyer.ata,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

  it("rejects an order that has not reached expires_at", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    expect(await fails(expire(order).rpc())).to.equal("OrderNotExpired");
  });

  it("rejects an order already in transit", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    await markInTransit(order, m);
    expect(await fails(expire(order).rpc())).to.equal("InvalidOrderStatus");
  });

  it("rejects a refund destination not owned by the customer", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    const strangerAta = await fundTokens(await fund(), 0);
    expect(await fails(expire(order, { customerAta: strangerAta }).rpc())).to.equal("UnauthorizedCustomer");
  });

  it("rejects a mint that is not the order's", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    expect(await fails(expire(order, { mint: token2022Mint() }).rpc())).to.equal("MintMismatch");
  });

  it("rejects an offer that is not the order's", async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "pickup");
    const other = await publishOffer(m.farmer);
    expect(await fails(expire(order, { offer: other }).rpc())).to.equal("OfferMismatch");
  });
});
