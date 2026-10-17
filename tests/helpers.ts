import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FarmerCore } from "../target/types/farmer_core";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
export const program = anchor.workspace.farmerCore as Program<FarmerCore>;
export const { Keypair, PublicKey, LAMPORTS_PER_SOL } = anchor.web3;
export const BN = anchor.BN;

const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const u64 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 8);

export const configPDA = pda(Buffer.from("config"));
export const warehousePDA = (id: number) => pda(Buffer.from("warehouse"), u64(id));
export const farmerPDA = (farmer: anchor.web3.PublicKey) =>
  pda(Buffer.from("farmer"), farmer.toBuffer());
export const customerPDA = (customer: anchor.web3.PublicKey) =>
  pda(Buffer.from("customer"), customer.toBuffer());

/** New keypair with SOL to pay rent. */
export const fund = async (sol = 2) => {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
};

/** Resolves to the Anchor error code ("NameTooLong") or the raw error string. */
export const fails = (p: Promise<unknown>): Promise<string> =>
  p.then(() => "did not fail", (e) => e?.error?.errorCode?.code ?? String(e));

let nextId = Date.now() % 1_000_000;
export const freshId = () => nextId++;

export const logisticsWallet = Keypair.generate().publicKey;
export const allowedMints = [Keypair.generate().publicKey];

// ProgramConfig is a singleton: create it once, before any file's tests.
before(async () => {
  if (await provider.connection.getAccountInfo(configPDA)) return;
  await program.methods.initConfig(logisticsWallet, false, allowedMints).rpc();
});

export const createWarehouse = async (operator: anchor.web3.PublicKey, id = freshId()) => {
  await program.methods
    .createWarehouse(new BN(id), operator, "Central", "Gate B", 250, [{ prefix: 123, len: 3 }], null)
    .rpc();
  return warehousePDA(id);
};

export const registerFarmer = async (warehouse: anchor.web3.PublicKey) => {
  const farmer = await fund();
  await program.methods
    .registerFarmer("Ana", "https://example.com/ana")
    .accountsPartial({ farmer: farmer.publicKey, warehouse })
    .signers([farmer])
    .rpc();
  return { farmer, profile: farmerPDA(farmer.publicKey) };
};

export const wcustomerPDA = (warehouse: anchor.web3.PublicKey, customer: anchor.web3.PublicKey) =>
  pda(Buffer.from("wcustomer"), warehouse.toBuffer(), customer.toBuffer());

export const registerCustomer = async () => {
  const customer = await fund();
  await program.methods
    .registerCustomer(null)
    .accountsPartial({ customer: customer.publicKey })
    .signers([customer])
    .rpc();
  return customer;
};

export const requestConfirmation = async (warehouse: anchor.web3.PublicKey, customer: anchor.web3.Keypair) => {
  await program.methods
    .requestCustomerConfirmation()
    .accountsPartial({ customer: customer.publicKey, warehouse })
    .signers([customer])
    .rpc();
  return wcustomerPDA(warehouse, customer.publicKey);
};

/** Sends the instruction and returns the events it emitted, decoded from the tx logs. */
export const events = async (builder: { rpc(opts?: anchor.web3.ConfirmOptions): Promise<string> }) => {
  const sig = await builder.rpc({ commitment: "confirmed" });
  const tx = await provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const parser = new anchor.EventParser(program.programId, program.coder);
  return [...parser.parseLogs(tx.meta.logMessages)].map((e) => ({ name: e.name, data: e.data }));
};
