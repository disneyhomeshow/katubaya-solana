import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, fails, fund, createWarehouse, registerCustomer, requestConfirmation, events } from "./helpers";

describe("confirm_customer", () => {
  let operator: anchor.web3.Keypair;
  let warehouse: anchor.web3.PublicKey;
  before(async () => {
    operator = await fund();
    warehouse = await createWarehouse(operator.publicKey);
  });

  const pending = async () => requestConfirmation(warehouse, await registerCustomer());
  const confirm = (wc: anchor.web3.PublicKey, notes: number[] | null = null, signer = operator, wh = warehouse) =>
    program.methods
      .confirmCustomer(notes)
      .accountsPartial({ warehouseCustomer: wc, warehouse: wh, operator: signer.publicKey })
      .signers([signer]);
  const revoke = (wc: anchor.web3.PublicKey) =>
    program.methods
      .revokeCustomer()
      .accountsPartial({ warehouseCustomer: wc, warehouse, operator: operator.publicKey })
      .signers([operator])
      .rpc();

  it("confirms a pending customer, stamps confirmed_at and emits CustomerConfirmed", async () => {
    const wc = await pending();
    const notes = Array.from({ length: 32 }, (_, i) => i);
    const now = Math.floor(Date.now() / 1000);
    const evs = await events(confirm(wc, notes));
    expect(evs.map((e) => e.name)).to.deep.equal(["customerConfirmed"]);
    expect(evs[0].data.warehouse.equals(warehouse)).to.be.true;

    const a = await program.account.warehouseCustomer.fetch(wc);
    expect(a.status).to.deep.equal({ confirmed: {} });
    expect(a.confirmedAt.toNumber()).to.be.within(now - 5, now + 60);
    expect(a.notesHash).to.deep.equal(notes);
  });

  it("accepts a missing notes_hash", async () => {
    const wc = await pending();
    await confirm(wc).rpc();
    const a = await program.account.warehouseCustomer.fetch(wc);
    expect(a.status).to.deep.equal({ confirmed: {} });
    expect(a.notesHash).to.equal(null);
  });

  it("rejects a signer that is not the warehouse operator", async () => {
    expect(await fails(confirm(await pending(), null, await fund()).rpc())).to.equal("UnauthorizedOperator");
  });

  it("rejects a relation that belongs to another warehouse", async () => {
    const other = await createWarehouse(operator.publicKey);
    expect(await fails(confirm(await pending(), null, operator, other).rpc())).to.equal("WarehouseMismatch");
  });

  it("rejects an already confirmed customer", async () => {
    const wc = await pending();
    await confirm(wc).rpc();
    expect(await fails(confirm(wc).rpc())).to.equal("AlreadyConfirmed");
  });

  it("re-admits a revoked customer", async () => {
    const wc = await pending();
    await confirm(wc).rpc();
    await revoke(wc);
    await confirm(wc).rpc();
    expect((await program.account.warehouseCustomer.fetch(wc)).status).to.deep.equal({ confirmed: {} });
  });
});
