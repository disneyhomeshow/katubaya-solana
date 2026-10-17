import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FarmerCore } from "../target/types/farmer_core";
import { expect } from "chai";

describe("init_config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.farmerCore as Program<FarmerCore>;
  const { PublicKey, Keypair } = anchor.web3;

  // `config` PDA, `admin` signer and `system_program` are resolved from the IDL.
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const logisticsWallet = Keypair.generate().publicKey;
  const allowedMints = [Keypair.generate(), Keypair.generate()].map(
    (k) => k.publicKey
  );

  before(async () => {
    await program.methods
      .initConfig(logisticsWallet, false, allowedMints)
      .rpc();
  });

  it("persists every field", async () => {
    const config = await program.account.programConfig.fetch(configPDA);
    expect(config.admin.equals(provider.wallet.publicKey)).to.be.true;
    expect(config.logisticsWallet.equals(logisticsWallet)).to.be.true;
    expect(config.paused).to.equal(false);
    expect(config.allowedMints.map(String)).to.deep.equal(
      allowedMints.map(String)
    );
  });

  it("rejects a second init (singleton PDA)", async () => {
    const err = await program.methods
      .initConfig(logisticsWallet, true, [])
      .rpc()
      .catch((e) => e);
    expect(String(err)).to.include("already in use");
  });

  it("rejects an admin that did not sign", async () => {
    const stranger = Keypair.generate().publicKey;
    const err = await program.methods
      .initConfig(logisticsWallet, false, [])
      .accountsPartial({ admin: stranger })
      .rpc()
      .catch((e) => e);
    expect(String(err)).to.match(/signature/i);
  });
});
