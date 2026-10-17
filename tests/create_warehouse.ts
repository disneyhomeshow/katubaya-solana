import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { program, BN, Keypair, warehousePDA, freshId, fails, fund } from "./helpers";

const valid = () => ({
  operator: Keypair.generate().publicKey,
  name: "Central",
  notes: "Gate B, 8h-12h",
  feeBps: 250,
  prefixes: [{ prefix: 123, len: 3 }, { prefix: 1234, len: 4 }],
  uri: "https://example.com/fees" as string | null,
});

const create = (id: number, o: Partial<ReturnType<typeof valid>> = {}, signer?: anchor.web3.Keypair) => {
  const a = { ...valid(), ...o };
  const m = program.methods.createWarehouse(new BN(id), a.operator, a.name, a.notes, a.feeBps, a.prefixes, a.uri);
  return (signer ? m.accountsPartial({ admin: signer.publicKey }).signers([signer]) : m).rpc();
};

describe("create_warehouse", () => {
  it("persists every field", async () => {
    const id = freshId();
    const a = valid();
    await create(id, a);
    const w = await program.account.warehouse.fetch(warehousePDA(id));
    expect(w.warehouseId.toNumber()).to.equal(id);
    expect(w.operator.equals(a.operator)).to.be.true;
    expect(w.name).to.equal(a.name);
    expect(w.pickupNotes).to.equal(a.notes);
    expect(w.feeBps).to.equal(a.feeBps);
    expect(w.deliveryFeeRulesUri).to.equal(a.uri);
    expect(w.deliverZipPrefixes).to.deep.equal(a.prefixes);
  });

  it("rejects a signer that is not config.admin", async () => {
    expect(await fails(create(freshId(), {}, await fund()))).to.equal("UnauthorizedAdmin");
  });

  it("rejects fee_bps above 10000", async () => {
    expect(await fails(create(freshId(), { feeBps: 10_001 }))).to.equal("FeeBpsTooHigh");
  });

  it("rejects name above MAX_NAME_LEN", async () => {
    expect(await fails(create(freshId(), { name: "x".repeat(101) }))).to.equal("NameTooLong");
  });

  it("rejects notes above MAX_NOTES_LEN", async () => {
    expect(await fails(create(freshId(), { notes: "x".repeat(501) }))).to.equal("NotesTooLong");
  });

  it("rejects uri above MAX_URI_LEN", async () => {
    expect(await fails(create(freshId(), { uri: "x".repeat(201) }))).to.equal("UriTooLong");
  });

  it("rejects more than MAX_ZIP_PREFIXES", async () => {
    const prefixes = Array.from({ length: 101 }, () => ({ prefix: 1, len: 3 }));
    expect(await fails(create(freshId(), { prefixes }))).to.equal("TooManyZipPrefixes");
  });

  it("rejects a zip prefix len outside 3..5", async () => {
    expect(await fails(create(freshId(), { prefixes: [{ prefix: 12, len: 2 }] }))).to.equal("InvalidZipPrefixLen");
  });

  it("rejects a duplicate warehouse_id", async () => {
    const id = freshId();
    await create(id);
    expect(await fails(create(id))).to.include("already in use");
  });
});
