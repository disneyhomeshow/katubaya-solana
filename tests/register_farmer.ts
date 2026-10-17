import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, Keypair, farmerPDA, fails, fund, createWarehouse } from "./helpers";

describe("register_farmer", () => {
  let warehouse: anchor.web3.PublicKey;
  before(async () => {
    warehouse = await createWarehouse(Keypair.generate().publicKey);
  });

  const register = async (name = "Ana", uri = "https://example.com/ana", wh = warehouse) => {
    const farmer = await fund();
    await program.methods
      .registerFarmer(name, uri)
      .accountsPartial({ farmer: farmer.publicKey, warehouse: wh })
      .signers([farmer])
      .rpc();
    return farmer;
  };

  it("creates the profile with the requested warehouse, not yet approved", async () => {
    const farmer = await register();
    const p = await program.account.farmerProfile.fetch(farmerPDA(farmer.publicKey));
    expect(p.authority.equals(farmer.publicKey)).to.be.true;
    expect(p.warehouse.equals(warehouse)).to.be.true;
    expect(p.warehouseApproved).to.equal(false);
    expect(p.displayName).to.equal("Ana");
    expect(p.publicProfileUri).to.equal("https://example.com/ana");
  });

  it("rejects name above MAX_NAME_LEN", async () => {
    expect(await fails(register("x".repeat(101)))).to.equal("NameTooLong");
  });

  it("rejects uri above MAX_URI_LEN", async () => {
    expect(await fails(register("Ana", "x".repeat(201)))).to.equal("UriTooLong");
  });

  it("rejects a warehouse that does not exist", async () => {
    const err = await fails(register("Ana", "u", Keypair.generate().publicKey));
    expect(err).to.equal("AccountNotInitialized");
  });

  it("rejects a second registration for the same farmer", async () => {
    const farmer = await register();
    const again = program.methods
      .registerFarmer("Ana", "u")
      .accountsPartial({ farmer: farmer.publicKey, warehouse })
      .signers([farmer])
      .rpc();
    expect(await fails(again)).to.include("already in use");
  });
});
