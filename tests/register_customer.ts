import { expect } from "chai";
import { program, customerPDA, fails, fund } from "./helpers";

describe("register_customer", () => {
  const register = async (uri: string | null) => {
    const customer = await fund();
    await program.methods
      .registerCustomer(uri)
      .accountsPartial({ customer: customer.publicKey })
      .signers([customer])
      .rpc();
    return customer;
  };

  it("persists every field", async () => {
    const customer = await register("https://example.com/c");
    const p = await program.account.customerProfile.fetch(customerPDA(customer.publicKey));
    expect(p.authority.equals(customer.publicKey)).to.be.true;
    expect(p.publicProfileUri).to.equal("https://example.com/c");
  });

  it("accepts a missing uri", async () => {
    const customer = await register(null);
    const p = await program.account.customerProfile.fetch(customerPDA(customer.publicKey));
    expect(p.publicProfileUri).to.equal(null);
  });

  it("rejects uri above MAX_URI_LEN", async () => {
    expect(await fails(register("x".repeat(201)))).to.equal("UriTooLong");
  });

  it("rejects a second registration for the same customer", async () => {
    const customer = await register(null);
    const again = program.methods
      .registerCustomer(null)
      .accountsPartial({ customer: customer.publicKey })
      .signers([customer])
      .rpc();
    expect(await fails(again)).to.include("already in use");
  });
});
