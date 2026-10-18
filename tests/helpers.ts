import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FarmerCore } from "../target/types/farmer_core";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

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
export const payer = (provider.wallet as anchor.Wallet).payer;
export const DECIMALS = 6;
/** Real SPL mint(s) created in the root `before` and written to config.allowed_mints. */
export const allowedMints: anchor.web3.PublicKey[] = [];
export const testMint = () => allowedMints[0];
/** Second allowed mint, on Token-2022: the program reaches both through `token_interface`. */
export const token2022Mint = () => allowedMints[1];

// ProgramConfig is a singleton: create it once, before any file's tests.
before(async () => {
  const existing = await program.account.programConfig.fetchNullable(configPDA);
  if (existing) {
    allowedMints.push(...existing.allowedMints);
    return;
  }
  allowedMints.push(await createMint(provider.connection, payer, payer.publicKey, null, DECIMALS));
  allowedMints.push(
    await createMint(provider.connection, payer, payer.publicKey, null, DECIMALS, undefined, undefined, TOKEN_2022_PROGRAM_ID)
  );
  await program.methods.initConfig(logisticsWallet, false, allowedMints).rpc();
});

export const createWarehouse = async (operator: anchor.web3.PublicKey, id = freshId(), feeBps = 250) => {
  await program.methods
    .createWarehouse(new BN(id), operator, "Central", "Gate B", feeBps, [{ prefix: 123, len: 3 }], null)
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

export const offerPDA = (farmer: anchor.web3.PublicKey, id: number) =>
  pda(Buffer.from("offer"), farmer.toBuffer(), u64(id));

/** Farmer registered for `warehouse` and approved by its `operator`. */
export const approvedFarmer = async (warehouse: anchor.web3.PublicKey, operator: anchor.web3.Keypair) => {
  const { farmer, profile } = await registerFarmer(warehouse);
  await program.methods
    .setFarmerWarehouse()
    .accountsPartial({ farmerProfile: profile, warehouse, operator: operator.publicKey })
    .signers([operator])
    .rpc();
  return farmer;
};

export const offerArgs = () => ({
  crop: "Tomato",
  cultivar: "San Marzano" as string | null,
  unitCode: 2,
  qty: new BN(500),
  price: new BN(1_000_000),
  mint: allowedMints[0],
  expiresAt: new BN(Math.floor(Date.now() / 1000) + 86_400) as anchor.BN | null,
  notes: "Harvested this week" as string | null,
  packRef: null as anchor.web3.PublicKey | null,
});

export const publishOfferTx = (farmer: anchor.web3.Keypair, id: number, o: Partial<ReturnType<typeof offerArgs>> = {}) => {
  const a = { ...offerArgs(), ...o };
  return program.methods
    .publishOffer(new BN(id), a.crop, a.cultivar, a.unitCode, a.qty, a.price, a.mint, a.expiresAt, a.notes, a.packRef)
    .accountsPartial({ farmer: farmer.publicKey })
    .signers([farmer]);
};

export const publishOffer = async (farmer: anchor.web3.Keypair, o: Partial<ReturnType<typeof offerArgs>> = {}, id = freshId()) => {
  await publishOfferTx(farmer, id, o).rpc();
  return offerPDA(farmer.publicKey, id);
};

/** Admin (provider wallet) flips config.paused. */
export const setPaused = (paused: boolean) => program.methods.setPaused(paused).rpc();

export const orderPDA = (offer: anchor.web3.PublicKey, customer: anchor.web3.PublicKey, id: number) =>
  pda(Buffer.from("order"), offer.toBuffer(), customer.toBuffer(), u64(id));
export const escrowPDA = (order: anchor.web3.PublicKey) => pda(Buffer.from("escrow"), order.toBuffer());

/** `owner`'s ATA for the test mint, holding `amount` minor units. */
export const fundTokens = async (owner: anchor.web3.Keypair, amount: number) => {
  const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, testMint(), owner.publicKey);
  if (amount > 0) await mintTo(provider.connection, payer, testMint(), ata.address, payer, amount);
  return ata.address;
};
export const tokenBalance = async (account: anchor.web3.PublicKey, tokenProgram = TOKEN_PROGRAM_ID) =>
  Number((await getAccount(provider.connection, account, undefined, tokenProgram)).amount);

/** True once the order's escrow token account has been closed and its rent returned. */
export const escrowClosed = async (order: anchor.web3.PublicKey) =>
  (await provider.connection.getAccountInfo(escrowPDA(order))) === null;
export const lamports = (account: anchor.web3.PublicKey) => provider.connection.getBalance(account);

/** Customer registered, confirmed by `operator`'s warehouse, with `tokens` minor units in their ATA. */
export const confirmedCustomer = async (
  warehouse: anchor.web3.PublicKey,
  operator: anchor.web3.Keypair,
  tokens = 100_000_000
) => {
  const customer = await registerCustomer();
  const warehouseCustomer = await requestConfirmation(warehouse, customer);
  await program.methods
    .confirmCustomer(null)
    .accountsPartial({ warehouseCustomer, warehouse, operator: operator.publicKey })
    .signers([operator])
    .rpc();
  const ata = await fundTokens(customer, tokens);
  return { customer, ata };
};

export type Mode = "pickup" | "delivery";
export type Buyer = { customer: anchor.web3.Keypair; ata: anchor.web3.PublicKey };

export const createOrderTx = (
  buyer: Buyer,
  offer: anchor.web3.PublicKey,
  warehouse: anchor.web3.PublicKey,
  id: number,
  qty: number,
  mode: Mode,
  mint = testMint(),
  tokenProgram = TOKEN_PROGRAM_ID
) =>
  program.methods
    .createOrder(new BN(id), new BN(qty), mode === "pickup" ? { pickup: {} } : { delivery: {} })
    .accountsPartial({
      offer,
      warehouse,
      mint,
      customerTokenAccount: buyer.ata,
      customer: buyer.customer.publicKey,
      tokenProgram,
    })
    .signers([buyer.customer]);

export const createOrder = async (
  buyer: Buyer,
  offer: anchor.web3.PublicKey,
  warehouse: anchor.web3.PublicKey,
  mode: Mode,
  qty = 10,
  id = freshId()
) => {
  await createOrderTx(buyer, offer, warehouse, id, qty, mode).rpc();
  return orderPDA(offer, buyer.customer.publicKey, id);
};

/** A whole market: warehouse + operator, approved farmer with one offer, confirmed and funded customer. */
export const market = async (offerOverrides: Partial<ReturnType<typeof offerArgs>> = {}) => {
  const operator = await fund();
  const warehouse = await createWarehouse(operator.publicKey);
  const farmer = await approvedFarmer(warehouse, operator);
  const offer = await publishOffer(farmer, offerOverrides);
  const buyer = await confirmedCustomer(warehouse, operator);
  return { operator, warehouse, farmer, offer, buyer };
};

export const SUBTOTAL = 10 * 1_000_000; // default order: qty 10 at price 1_000_000
export const SERVICE_FEE = (SUBTOTAL * 250) / 10_000; // warehouse fixture fee_bps = 250
export const H6 = 6 * 60 * 60;
export const H72 = 72 * 60 * 60;

/** Token account of `owner` for the test mint (created if missing; `owner` may be any pubkey). */
export const ataOf = async (
  owner: anchor.web3.PublicKey,
  mint = testMint(),
  tokenProgram = TOKEN_PROGRAM_ID
) =>
  (
    await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, mint, owner, false, undefined, undefined, tokenProgram
    )
  ).address;

type Market = Awaited<ReturnType<typeof market>>;

export const quoteFee = (order: anchor.web3.PublicKey, m: Market, fee = 500_000) =>
  program.methods
    .quoteDeliveryFee(new BN(fee))
    .accountsPartial({ order, warehouse: m.warehouse, operator: m.operator.publicKey })
    .signers([m.operator])
    .rpc();

export const acceptFee = (order: anchor.web3.PublicKey, m: Market) =>
  program.methods
    .acceptDeliveryFee()
    .accountsPartial({
      order,
      mint: testMint(),
      customerTokenAccount: m.buyer.ata,
      customer: m.buyer.customer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([m.buyer.customer])
    .rpc();

export const markInTransit = (order: anchor.web3.PublicKey, m: Market) =>
  program.methods
    .markInTransit()
    .accountsPartial({ order, warehouse: m.warehouse, operator: m.operator.publicKey })
    .signers([m.operator])
    .rpc();

/** Delivery order quoted and accepted: EscrowedReady. */
export const readyOrder = async (m: Market, fee = 500_000) => {
  const order = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
  await quoteFee(order, m, fee);
  await acceptFee(order, m);
  return order;
};
