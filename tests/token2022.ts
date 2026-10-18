import { expect } from "chai";
import * as anchor from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, mintTo } from "@solana/spl-token";
import {
  program, provider, payer, fund, createWarehouse, approvedFarmer, publishOffer, confirmedCustomer,
  createOrderTx, markInTransit, orderPDA, escrowPDA, escrowClosed, tokenBalance, token2022Mint, ataOf,
  logisticsWallet, freshId, SUBTOTAL, SERVICE_FEE,
} from "./helpers";

// `token_interface` is program-agnostic; one pickup run covers every token CPI the program makes
// (deposit, the two payout withdrawals, the close) against Token-2022.
describe("token-2022", () => {
  it("escrows, pays out and closes the escrow with a Token-2022 mint", async () => {
    const mint = token2022Mint();
    const ata = (owner: anchor.PublicKey) => ataOf(owner, mint, TOKEN_2022_PROGRAM_ID);

    const operator = await fund();
    const warehouse = await createWarehouse(operator.publicKey);
    const farmer = await approvedFarmer(warehouse, operator);
    const offer = await publishOffer(farmer, { mint });
    const { customer } = await confirmedCustomer(warehouse, operator, 0);
    const buyer = { customer, ata: await ata(customer.publicKey) };
    await mintTo(provider.connection, payer, mint, buyer.ata, payer, SUBTOTAL, [], undefined, TOKEN_2022_PROGRAM_ID);
    const farmerAta = await ata(farmer.publicKey);
    const logisticsAta = await ata(logisticsWallet);

    const id = freshId();
    await createOrderTx(buyer, offer, warehouse, id, 10, "pickup", mint, TOKEN_2022_PROGRAM_ID).rpc();
    const order = orderPDA(offer, customer.publicKey, id);
    expect(await tokenBalance(escrowPDA(order), TOKEN_2022_PROGRAM_ID)).to.equal(SUBTOTAL);

    await markInTransit(order, { operator, warehouse, farmer, offer, buyer });
    await program.methods
      .completeOrder()
      .accountsPartial({
        order,
        warehouse,
        mint,
        farmerTokenAccount: farmerAta,
        logisticsTokenAccount: logisticsAta,
        operator: operator.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    expect(await tokenBalance(farmerAta, TOKEN_2022_PROGRAM_ID)).to.equal(SUBTOTAL - SERVICE_FEE);
    expect(await tokenBalance(logisticsAta, TOKEN_2022_PROGRAM_ID)).to.equal(SERVICE_FEE);
    expect(await tokenBalance(buyer.ata, TOKEN_2022_PROGRAM_ID)).to.equal(0);
    expect(await escrowClosed(order)).to.be.true;
    expect((await program.account.order.fetch(order)).status).to.deep.equal({ fulfilled: {} });
  });
});
