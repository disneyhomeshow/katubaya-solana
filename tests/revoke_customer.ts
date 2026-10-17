import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, fails, fund, createWarehouse, registerCustomer, requestConfirmation, events } from "./helpers";

describe("revoke_customer", () => {
  let operator: anchor.web3.Keypair;
  let warehouse: anchor.web3.PublicKey;
  before(async () => {
    operator = await fund();
    warehouse = await createWarehouse(operator.publicKey);
  });

  const pending = async () => requestConfirmation(warehouse, await registerCustomer());
  const confirm = (wc: anchor.web3.PublicKey) =>
    program.methods
      .confirmCustomer(null)
      .accountsPartial({ warehouseCustomer: wc, warehouse, operator: operator.publicKey })
      .signers([operator])
      .rpc();
  const revoke = (wc: anchor.web3.PublicKey, signer = operator, wh = warehouse) =>
    program.methods
      .revokeCustomer()
      .accountsPartial({ warehouseCustomer: wc, warehouse: wh, operator: signer.publicKey })
      .signers([signer]);

  it("revokes a confirmed customer, keeps confirmed_at and emits CustomerRevoked", async () => {
    const wc = await pending();
    await confirm(wc);
    const evs = await events(revoke(wc));
    expect(evs.map((e) => e.name)).to.deep.equal(["customerRevoked"]);
    expect(evs[0].data.warehouse.equals(warehouse)).to.be.true;

    const a = await program.account.warehouseCustomer.fetch(wc);
    expect(a.status).to.deep.equal({ revoked: {} });
    expect(a.confirmedAt).to.not.equal(null);
  });

  it("revokes a pending request (denial)", async () => {
    const wc = await pending();
    await revoke(wc).rpc();
    const a = await program.account.warehouseCustomer.fetch(wc);
    expect(a.status).to.deep.equal({ revoked: {} });
    expect(a.confirmedAt).to.equal(null);
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    expect(await fails(revoke(await pending(), await fund()).rpc())).to.equal("UnauthorizedOperator");
  });

  it("rejects a relation that belongs to another warehouse", async () => {
    const other = await createWarehouse(operator.publicKey);
    expect(await fails(revoke(await pending(), operator, other).rpc())).to.equal("WarehouseMismatch");
  });

  it("rejects an already revoked customer", async () => {
    const wc = await pending();
    await revoke(wc).rpc();
    expect(await fails(revoke(wc).rpc())).to.equal("AlreadyRevoked");
  });
});
