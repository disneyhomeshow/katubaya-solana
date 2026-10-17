import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, Keypair, wcustomerPDA, fails, fund, createWarehouse, registerCustomer, events } from "./helpers";

describe("request_customer_confirmation", () => {
  let warehouse: anchor.web3.PublicKey;
  before(async () => {
    warehouse = await createWarehouse(Keypair.generate().publicKey);
  });

  const request = (customer: anchor.web3.Keypair, wh = warehouse) =>
    program.methods
      .requestCustomerConfirmation()
      .accountsPartial({ customer: customer.publicKey, warehouse: wh })
      .signers([customer]);

  it("creates the relation as pending and emits CustomerConfirmationRequested", async () => {
    const customer = await registerCustomer();
    const evs = await events(request(customer));
    expect(evs.map((e) => e.name)).to.deep.equal(["customerConfirmationRequested"]);
    expect(evs[0].data.warehouse.equals(warehouse)).to.be.true;
    expect(evs[0].data.customer.equals(customer.publicKey)).to.be.true;

    const wc = await program.account.warehouseCustomer.fetch(wcustomerPDA(warehouse, customer.publicKey));
    expect(wc.warehouse.equals(warehouse)).to.be.true;
    expect(wc.customer.equals(customer.publicKey)).to.be.true;
    expect(wc.status).to.deep.equal({ pending: {} });
    expect(wc.confirmedAt).to.equal(null);
    expect(wc.notesHash).to.equal(null);
  });

  it("rejects a customer without a profile", async () => {
    expect(await fails(request(await fund()).rpc())).to.equal("AccountNotInitialized");
  });

  it("rejects a warehouse that does not exist", async () => {
    const customer = await registerCustomer();
    expect(await fails(request(customer, Keypair.generate().publicKey).rpc())).to.equal("AccountNotInitialized");
  });

  it("rejects a second request for the same pair", async () => {
    const customer = await registerCustomer();
    await request(customer).rpc();
    expect(await fails(request(customer).rpc())).to.include("already in use");
  });
});
