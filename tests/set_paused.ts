import { expect } from "chai";
import { program, configPDA, fails, fund, setPaused } from "./helpers";

describe("set_paused", () => {
  const paused = async () => (await program.account.programConfig.fetch(configPDA)).paused;

  it("pauses and unpauses the program", async () => {
    await setPaused(true);
    expect(await paused()).to.equal(true);
    await setPaused(false);
    expect(await paused()).to.equal(false);
  });

  it("rejects a signer that is not config.admin", async () => {
    const stranger = await fund();
    const tx = program.methods.setPaused(true).accountsPartial({ admin: stranger.publicKey }).signers([stranger]).rpc();
    expect(await fails(tx)).to.equal("UnauthorizedAdmin");
    expect(await paused()).to.equal(false);
  });
});
