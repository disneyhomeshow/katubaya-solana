import { expect } from "chai";
import { program, provider, configPDA, logisticsWallet, allowedMints, Keypair, fails } from "./helpers";

describe("init_config", () => {
  it("persists every field", async () => {
    const config = await program.account.programConfig.fetch(configPDA);
    expect(config.admin.equals(provider.wallet.publicKey)).to.be.true;
    expect(config.logisticsWallet.equals(logisticsWallet)).to.be.true;
    expect(config.paused).to.equal(false);
    expect(config.allowedMints.map(String)).to.deep.equal(allowedMints.map(String));
  });

  it("rejects a second init (singleton PDA)", async () => {
    const err = await fails(program.methods.initConfig(logisticsWallet, true, []).rpc());
    expect(err).to.include("already in use");
  });

  it("rejects an admin that did not sign", async () => {
    const err = await fails(
      program.methods
        .initConfig(logisticsWallet, false, [])
        .accountsPartial({ admin: Keypair.generate().publicKey })
        .rpc()
    );
    expect(err).to.match(/signature/i);
  });
});
