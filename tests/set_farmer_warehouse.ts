import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, fails, fund, createWarehouse, registerFarmer } from "./helpers";

describe("set_farmer_warehouse", () => {
  let operator: anchor.web3.Keypair;
  let warehouse: anchor.web3.PublicKey;
  let profile: anchor.web3.PublicKey;
  before(async () => {
    operator = await fund();
    warehouse = await createWarehouse(operator.publicKey);
    ({ profile } = await registerFarmer(warehouse));
  });

  const approve = (wh = warehouse, signer = operator) =>
    program.methods
      .setFarmerWarehouse()
      .accountsPartial({ farmerProfile: profile, warehouse: wh, operator: signer.publicKey })
      .signers([signer])
      .rpc();
  const approved = async () => (await program.account.farmerProfile.fetch(profile)).warehouseApproved;

  it("approves the requested warehouse", async () => {
    await approve();
    expect(await approved()).to.equal(true);
  });

  it("is idempotent", async () => {
    await approve();
    expect(await approved()).to.equal(true);
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    expect(await fails(approve(warehouse, await fund()))).to.equal("UnauthorizedOperator");
  });

  it("rejects a warehouse the farmer did not request", async () => {
    const other = await createWarehouse(operator.publicKey);
    expect(await fails(approve(other))).to.equal("WarehouseMismatch");
  });
});
