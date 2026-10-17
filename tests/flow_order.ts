import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program, BN, fund, logisticsWallet, createWarehouse, approvedFarmer, publishOffer, confirmedCustomer,
  createOrder, tokenBalance, escrowPDA, ataOf, testMint, SUBTOTAL, SERVICE_FEE,
} from "./helpers";

// End-to-end delivery flow: confirm -> publish -> create -> quote -> accept -> in transit -> complete.
describe("flow: delivery order", () => {
  const FEE = 750_000;
  let operator: anchor.Keypair;
  let warehouse: anchor.PublicKey;
  let farmer: anchor.Keypair;
  let offer: anchor.PublicKey;
  let buyer: Awaited<ReturnType<typeof confirmedCustomer>>;
  let order: anchor.PublicKey;
  let start: number;

  it("warehouse onboards an approved farmer and a confirmed customer", async () => {
    operator = await fund();
    warehouse = await createWarehouse(operator.publicKey);
    farmer = await approvedFarmer(warehouse, operator);
    buyer = await confirmedCustomer(warehouse, operator);
    start = await tokenBalance(buyer.ata);
  });

  it("farmer publishes an offer", async () => {
    offer = await publishOffer(farmer);
    expect((await program.account.lotOffer.fetch(offer)).active).to.equal(true);
  });

  it("customer orders for delivery: subtotal escrowed, stock reserved", async () => {
    order = await createOrder(buyer, offer, warehouse, "delivery");
    expect(await tokenBalance(escrowPDA(order))).to.equal(SUBTOTAL);
    expect((await program.account.lotOffer.fetch(offer)).qtyRemaining.toNumber()).to.equal(490);
    expect((await program.account.order.fetch(order)).serviceFeeMinor.toNumber()).to.equal(SERVICE_FEE);
  });

  it("warehouse quotes the delivery fee", async () => {
    await program.methods
      .quoteDeliveryFee(new BN(FEE))
      .accountsPartial({ order, warehouse, operator: operator.publicKey })
      .signers([operator])
      .rpc();
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ deliveryQuoted: {} });
  });

  it("customer accepts: fee escrowed, order ready", async () => {
    await program.methods
      .acceptDeliveryFee()
      .accountsPartial({
        order,
        mint: testMint(),
        customerTokenAccount: buyer.ata,
        customer: buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer.customer])
      .rpc();
    expect(await tokenBalance(escrowPDA(order))).to.equal(SUBTOTAL + FEE);
    expect(await tokenBalance(buyer.ata)).to.equal(start - SUBTOTAL - FEE);
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ escrowedReady: {} });
  });

  it("warehouse marks the order in transit", async () => {
    await program.methods
      .markInTransit()
      .accountsPartial({ order, warehouse, operator: operator.publicKey })
      .signers([operator])
      .rpc();
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ inTransit: {} });
  });

  it("warehouse completes: farmer and logistics paid, escrow empty", async () => {
    const farmerAta = await ataOf(farmer.publicKey);
    const logisticsAta = await ataOf(logisticsWallet);
    const logisticsBefore = await tokenBalance(logisticsAta);
    await program.methods
      .completeOrder()
      .accountsPartial({
        order,
        warehouse,
        mint: testMint(),
        farmerTokenAccount: farmerAta,
        logisticsTokenAccount: logisticsAta,
        operator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();
    expect(await tokenBalance(farmerAta)).to.equal(SUBTOTAL - SERVICE_FEE);
    expect(await tokenBalance(logisticsAta)).to.equal(logisticsBefore + SERVICE_FEE + FEE);
    expect(await tokenBalance(escrowPDA(order))).to.equal(0);
    expect(await tokenBalance(buyer.ata)).to.equal(start - SUBTOTAL - FEE);
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ fulfilled: {} });
  });
});
