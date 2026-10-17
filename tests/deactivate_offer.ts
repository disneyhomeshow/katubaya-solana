import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, fails, fund, events, createWarehouse, approvedFarmer, publishOffer } from "./helpers";

describe("deactivate_offer", () => {
  let farmer: anchor.web3.Keypair;
  before(async () => {
    const operator = await fund();
    const warehouse = await createWarehouse(operator.publicKey);
    farmer = await approvedFarmer(warehouse, operator);
  });

  const deactivate = (offer: anchor.web3.PublicKey, signer = farmer) =>
    program.methods
      .deactivateOffer()
      .accountsPartial({ offer, farmer: signer.publicKey })
      .signers([signer]);

  it("deactivates the offer and emits OfferDeactivated", async () => {
    const offer = await publishOffer(farmer);
    const evs = await events(deactivate(offer));
    expect(evs.map((e) => e.name)).to.deep.equal(["offerDeactivated"]);
    expect(evs[0].data.offer.equals(offer)).to.be.true;
    expect((await program.account.lotOffer.fetch(offer)).active).to.equal(false);
  });

  it("rejects a signer that is not the offer's farmer", async () => {
    const offer = await publishOffer(farmer);
    expect(await fails(deactivate(offer, await fund()).rpc())).to.equal("UnauthorizedFarmer");
  });

  it("rejects an already inactive offer", async () => {
    const offer = await publishOffer(farmer);
    await deactivate(offer).rpc();
    expect(await fails(deactivate(offer).rpc())).to.equal("OfferInactive");
  });
});
