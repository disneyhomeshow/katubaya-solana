import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { readFileSync } from "fs";

// `order.expires_at` comes from the 6 h / 72 h constants and a validator cannot be warped, so the
// refund path runs on litesvm instead: the real .so, a settable clock, accounts written directly.
// `ExpireOrder` puts no seeds on `order`, so the fixtures are plain injected accounts.
const IDL = JSON.parse(readFileSync("target/idl/farmer_core.json", "utf8"));
const PROGRAM_ID = new PublicKey(IDL.address);
const coder = new anchor.BorshCoder(IDL);

const EXPIRES_AT = 1_800_000_000;
const SUBTOTAL = 10_000_000;
const QTY = 10;
const STOCK = 490;

describe("expire_order (clock)", () => {
  let svm: any;
  const payer = Keypair.generate(); // pays the fee and signs nothing else: the call is permissionless
  const customer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const farmer = Keypair.generate().publicKey;
  const warehouse = Keypair.generate().publicKey;
  const offer = Keypair.generate().publicKey;
  const order = Keypair.generate().publicKey;
  const customerAta = Keypair.generate().publicKey;
  const [escrow, escrowBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), order.toBuffer()],
    PROGRAM_ID
  );

  const put = (address: PublicKey, data: Buffer, owner: PublicKey) =>
    svm.setAccount({
      address: address.toBase58(),
      lamports: svm.minimumBalanceForRentExemption(BigInt(data.length)),
      data: new Uint8Array(data),
      executable: false,
      programAddress: owner.toBase58(),
      space: BigInt(data.length),
    });

  const tokenAccount = (owner: PublicKey, amount: number) => {
    const buf = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner,
        amount: BigInt(amount),
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1, // Initialized
        isNativeOption: 0,
        isNative: BigInt(0),
        delegatedAmount: BigInt(0),
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      buf
    );
    return buf;
  };

  before(async () => {
    svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID.toBase58(), "target/deploy/farmer_core.so");
    svm.airdrop(payer.publicKey.toBase58(), BigInt(1_000_000_000));
    svm.airdrop(customer.publicKey.toBase58(), BigInt(1_000_000_000));

    const mintBuf = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: BigInt(SUBTOTAL),
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mintBuf
    );
    put(mint, mintBuf, TOKEN_PROGRAM_ID);
    put(escrow, tokenAccount(escrow, SUBTOTAL), TOKEN_PROGRAM_ID); // its own authority
    put(customerAta, tokenAccount(customer.publicKey, 0), TOKEN_PROGRAM_ID);
    put(
      offer,
      await coder.accounts.encode("LotOffer", {
        farmer,
        warehouse,
        offer_id: new BN(1),
        pack_ref: null,
        crop_name: "Tomato",
        cultivar_name: null,
        unit_code: 2,
        expires_at: null,
        notes_public: null,
        mint,
        price_minor: new BN(1_000_000),
        qty_remaining: new BN(STOCK),
        active: true,
        created_at: new BN(EXPIRES_AT - 86_400),
      }),
      PROGRAM_ID
    );
    put(
      order,
      await coder.accounts.encode("Order", {
        order_id: new BN(1),
        offer,
        farmer,
        warehouse,
        customer: customer.publicKey,
        mint,
        qty: new BN(QTY),
        subtotal_minor: new BN(SUBTOTAL),
        service_fee_minor: new BN(250_000),
        delivery_fee_minor: new BN(0),
        fulfillment_mode: { Pickup: {} },
        status: { EscrowedPickup: {} },
        created_at: new BN(EXPIRES_AT - 72 * 60 * 60),
        expires_at: new BN(EXPIRES_AT),
        escrow_bump: escrowBump,
      }),
      PROGRAM_ID
    );
  });

  const expireAt = (unixTimestamp: number) => {
    svm.expireBlockhash(); // two identical calls would otherwise be deduped as AlreadyProcessed
    const clock = svm.getClock();
    clock.unixTimestamp = BigInt(unixTimestamp);
    svm.setClock(clock);

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: order, isSigner: false, isWritable: true },
          { pubkey: offer, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: customerAta, isSigner: false, isWritable: true },
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: customer.publicKey, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: coder.instruction.encode("expire_order", {}),
      })
    );
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    return svm.sendTransaction({
      messageBytes: tx.serializeMessage(),
      signatures: { [payer.publicKey.toBase58()]: tx.signatures[0].signature },
    });
  };

  const account = (address: PublicKey) => Buffer.from(svm.getAccount(address.toBase58()).data);

  it("rejects the exact expires_at second", () => {
    const res = expireAt(EXPIRES_AT);
    expect(res.meta().logs().join("\n")).to.include("OrderNotExpired");
  });

  it("refunds, restores stock, closes the escrow and emits OrderExpired", () => {
    const rent = svm.getBalance(escrow.toBase58());
    const customerSol = svm.getBalance(customer.publicKey.toBase58());
    const res = expireAt(EXPIRES_AT + 1);
    expect(res.logs().join("\n")).to.not.include("AnchorError");

    const evs = [...new anchor.EventParser(PROGRAM_ID, coder).parseLogs(res.logs())];
    expect(evs.map((e) => e.name)).to.deep.equal(["OrderExpired"]);
    expect((evs[0].data.order as PublicKey).equals(order)).to.be.true;

    expect(AccountLayout.decode(account(customerAta)).amount).to.equal(BigInt(SUBTOTAL));
    expect(svm.getAccount(escrow.toBase58()).exists).to.be.false;
    expect(svm.getBalance(customer.publicKey.toBase58())).to.equal(customerSol + rent);
    expect(coder.accounts.decode("LotOffer", account(offer)).qty_remaining.toNumber()).to.equal(STOCK + QTY);
    expect(coder.accounts.decode("Order", account(order)).status).to.deep.equal({ Expired: {} });
  });
});
