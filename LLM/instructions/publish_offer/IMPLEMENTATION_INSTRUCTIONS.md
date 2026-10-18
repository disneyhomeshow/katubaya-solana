# publish_offer: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/publish_offer.rs` | `PublishOffer` accounts struct, handler, `DENIED_MINT_EXTENSIONS` and the private `deny_mint_extensions` |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `publish_offer(ctx, offer_id, crop_name, cultivar_name, unit_code, qty, price_minor, expires_at, notes_public, pack_ref)` |
| `programs/farmer-core/src/states.rs` | `LotOffer`, `ProgramConfig`, `FarmerProfile`, `MAX_NAME_LEN`, `MAX_NOTES_LEN`, `SEED_CONFIG`, `SEED_FARMER`, `SEED_OFFER` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{ProgramPaused, MintNotAllowed, NameTooLong, NotesTooLong, FarmerNotApproved, InvalidQuantity, InvalidPrice, InvalidExpiry, MintExtensionNotAllowed}` |
| `programs/farmer-core/src/events.rs` | `OfferPublished` |
| `tests/publish_offer.ts` | Happy path with event, optional args as `null`, `pack_ref`, nine named errors, a non-mint pubkey, duplicate id |
| `tests/helpers.ts` | `fund`, `freshId`, `fails`, `events`, `setPaused`, `createWarehouse`, `registerFarmer`, `approvedFarmer`, `offerPDA`, `offerArgs`, `publishOfferTx`, `publishOffer`, `feeMint`, `DECIMALS` |
| `target/idl/farmer_core.json` | Generated IDL (accounts with PDA seeds, discriminator, error codes, event) |

## Accounts struct

`#[derive(Accounts)] #[instruction(offer_id: u64)] pub struct PublishOffer<'info>`, fields in this order:

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `config` | `Account<ProgramConfig>` | `seeds = [SEED_CONFIG]`, `bump`, `constraint = !config.paused @ FarmerCoreError::ProgramPaused` | auto from IDL (const seeds) |
| `farmer_profile` | `Account<FarmerProfile>` | `seeds = [SEED_FARMER, farmer.key().as_ref()]`, `bump`, `constraint = farmer_profile.warehouse_approved @ FarmerCoreError::FarmerNotApproved` | auto from IDL (seeds from `farmer`) |
| `offer` | `Account<LotOffer>` | `init`, `payer = farmer`, `space = 8 + LotOffer::INIT_SPACE`, `seeds = [SEED_OFFER, farmer.key().as_ref(), offer_id.to_le_bytes().as_ref()]`, `bump` | auto from IDL (seeds from `farmer` + `offer_id` arg) |
| `mint` | `InterfaceAccount<Mint>` (`anchor_spl::token_interface`) | none; read-only, checked in the handler (allowlist, then extensions) | must pass via `.accountsPartial({ mint })` — the IDL entry has no `pda`, no `address` and no `relations` |
| `farmer` | `Signer` | `mut` (pays rent) | must pass via `.accountsPartial({ farmer })` + `.signers([farmer])` (non-wallet signer) |
| `system_program` | `Program<System>` | none | auto from IDL (fixed address) |

`mint` sits between `offer` and `farmer`. Everything else resolves from the IDL — `config`, `farmer_profile` and
`offer` are `pda` entries, `system_program` carries a fixed `address` — so the mint and the `farmer` keypair are the
only accounts a call has to name.

## Arguments

Nine args; the mint moved out of this list and into the accounts struct.

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `offer_id` | `u64` | `BN` | none; seed of `offer`, a reused id fails at `init` | "already in use" (system program) |
| `crop_name` | `String` | `string` | `len() <= MAX_NAME_LEN` (100) | `NameTooLong` |
| `cultivar_name` | `Option<String>` | `string \| null` | `len() <= MAX_NAME_LEN` when `Some` | `NameTooLong` |
| `unit_code` | `u16` | `number` | none (client-side mapping, README section 10) | n/a |
| `qty` | `u64` | `BN` | `> 0` | `InvalidQuantity` |
| `price_minor` | `u64` | `BN` | `> 0` | `InvalidPrice` |
| `expires_at` | `Option<i64>` | `BN \| null` | `> Clock::get()?.unix_timestamp` when `Some` | `InvalidExpiry` |
| `notes_public` | `Option<String>` | `string \| null` | `len() <= MAX_NOTES_LEN` (500) when `Some` | `NotesTooLong` |
| `pack_ref` | `Option<Pubkey>` | `PublicKey \| null` | none, by decision: never validated, never read (README 16) | n/a |

## Account layout

```rust
#[account]
#[derive(InitSpace)]
pub struct LotOffer {
    pub farmer: Pubkey, // farmer authority (wallet), also an offer seed
    pub warehouse: Pubkey,
    pub offer_id: u64,
    pub pack_ref: Option<Pubkey>, // free-form hint, never validated and never read: see README 16
    #[max_len(MAX_NAME_LEN)]
    pub crop_name: String,
    #[max_len(MAX_NAME_LEN)]
    pub cultivar_name: Option<String>,
    pub unit_code: u16, // client-side mapping, README section 10
    pub expires_at: Option<i64>,
    #[max_len(MAX_NOTES_LEN)]
    pub notes_public: Option<String>,
    pub mint: Pubkey,
    pub price_minor: u64,
    pub qty_remaining: u64,
    pub active: bool,
    pub created_at: i64,
}
```

Size 8 + INIT_SPACE = 895 bytes (32 + 32 + 8 + (1 + 32) + (4 + 100) + (1 + 4 + 100) + 2 + (1 + 8) + (1 + 4 + 500) + 32 + 8 + 8 + 1 + 8 = 887); `SEED_OFFER = b"offer"`.
The TS client decodes `offerId`, `priceMinor`, `qtyRemaining`, `createdAt` as `BN`, `expiresAt` as `BN | null`, `cultivarName` / `notesPublic` as `string | null`, `packRef` as `PublicKey | null`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `ProgramPaused` | 6001 | `config.paused` (test: "rejects while the program is paused") |
| `FarmerNotApproved` | 6015 | `!farmer_profile.warehouse_approved` (test: "rejects a farmer not yet approved by the warehouse") |
| `NameTooLong` | 6004 | `crop_name` or `cultivar_name` longer than 100 bytes (tests: "rejects crop_name above MAX_NAME_LEN", "rejects cultivar_name above MAX_NAME_LEN") |
| `NotesTooLong` | 6005 | `notes_public` longer than 500 bytes (test: "rejects notes_public above MAX_NOTES_LEN") |
| `InvalidQuantity` | 6017 | `qty == 0` (test: "rejects qty of zero") |
| `InvalidPrice` | 6018 | `price_minor == 0` (test: "rejects price of zero") |
| `InvalidExpiry` | 6019 | `expires_at <= now` (test: "rejects expires_at in the past") |
| `MintNotAllowed` | 6003 | allowlist non-empty and `mint.key()` not in it (test: "rejects a mint outside the allowlist", with a real unlisted mint) |
| `MintExtensionNotAllowed` | 6033 | the mint's extension list contains one of `DENIED_MINT_EXTENSIONS`, or its TLV cannot be unpacked (test: "rejects an allowlisted mint that charges a transfer fee") |
| `AccountNotInitialized` (Anchor) | 3012 | nothing is allocated at `mint`: system-owned, zero lamports (test: "rejects a pubkey that is not a mint account"); same code when `farmer_profile` has no data, i.e. the signer never called `register_farmer` (not exercised) |
| `AccountOwnedByWrongProgram` (Anchor) | 3007 | `mint` is a live account owned by neither token program, so `InterfaceAccount`'s owner check rejects it before the handler; not exercised |
| "already in use" (system program) | n/a | the `offer` PDA already exists for this farmer + `offer_id` (test: "rejects a duplicate offer_id"; `fails` returns the raw error string) |
| "Signature verification failed" (runtime) | n/a | `farmer` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

`MintExtensionNotAllowed` is the last variant of `FarmerCoreError` (34 variants, 6000-6033).

## Events

```rust
#[event]
pub struct OfferPublished {
    pub offer: Pubkey,
    pub farmer: Pubkey,
    pub warehouse: Pubkey,
    pub crop_name: String,
    pub cultivar_name: Option<String>,
    pub unit_code: u16,
    pub qty: u64,
    pub price_minor: u64,
    pub mint: Pubkey,
    pub expires_at: Option<i64>,
}
```

Emitted after the writes: `offer`, `farmer`, `warehouse`, `crop_name`, `cultivar_name` from the account, `mint` from the mint account's key, the rest from the args. The test reads it with
`events(publish(a, id))` (`tests/helpers.ts`: rpc at commitment `confirmed`, logs decoded by `anchor.EventParser`) and asserts the only event is `offerPublished`
(camelCase) with every field (`qty` / `priceMinor` as `BN`, `expiresAt` as `BN | null`, pubkeys as `PublicKey`).

## Client call

```typescript
export const publishOfferTx = (farmer: anchor.web3.Keypair, id: number, o: Partial<ReturnType<typeof offerArgs>> = {}) => {
  const a = { ...offerArgs(), ...o };
  return program.methods
    .publishOffer(new BN(id), a.crop, a.cultivar, a.unitCode, a.qty, a.price, a.expiresAt, a.notes, a.packRef)
    .accountsPartial({ farmer: farmer.publicKey, mint: a.mint })
    .signers([farmer]);
};
```

From `tests/helpers.ts`; `offerArgs()` supplies the defaults (`"Tomato"`, `"San Marzano"`, `unitCode 2`, `qty 500`, `price 1_000_000`, `mint: allowedMints[0]`,
expiry now + 86 400 s, `"Harvested this week"`, `packRef null`) — `mint` stays in that object but is now passed as an account. Fixtures in `tests/publish_offer.ts`:
`operator = await fund()`, `warehouse = await createWarehouse(operator.publicKey)`, `farmer = await approvedFarmer(warehouse, operator)`.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`): non-`init` accounts deserialize in field order (`config`, `farmer_profile`, `mint`, `farmer`, `system_program`),
  then the `init` of `offer` runs (seeds check + system-program account creation: "already in use" on a duplicate), then constraints run in field order
  (`ProgramPaused`, `FarmerNotApproved`), then the handler's `require!` chain: `crop_name`, `cultivar_name`, `notes_public`, `qty`, `price_minor`,
  `expires_at`, the allowlist, `deny_mint_extensions`. The tests trigger each error in isolation, so they do not pin this order. A non-mint `mint` therefore
  fails in the first pass, before the offer PDA is created.
- `deny_mint_extensions(&AccountInfo) -> Result<()>` is a private fn at the bottom of the file, called with `ctx.accounts.mint.to_account_info()`. It borrows the
  account data, unpacks it with `StateWithExtensions::<MintState>::unpack` (`spl_token_2022`, re-exported through `anchor_spl::token_2022::spl_token_2022`) and
  rejects the mint when `get_extension_types()` contains any of `DENIED_MINT_EXTENSIONS` (`TransferFeeConfig`, `TransferHook`, `PermanentDelegate`,
  `ConfidentialTransferMint`, `Pausable`). Both fallible calls map their error to `MintExtensionNotAllowed`. A legacy SPL Token mint unpacks with an empty
  extension list, so one path serves both token programs and no branch on the owning program is needed.
- The extension check is a handler `require!`, not an `#[account]` constraint, like the allowlist: it borrows and parses the account's data. It runs after the
  allowlist, so an unlisted mint reports `MintNotAllowed` even when it also carries a denied extension.
- `cultivar_name` and `notes_public` are length-checked only when `Some`; `expires_at` is compared with `now` only when `Some`; `pack_ref` is never
  checked. All four are stored as given, `None` included (test "accepts missing cultivar, expiry, notes and pack_ref").
- `now` is read once (`Clock::get()?`) and serves both the `InvalidExpiry` check and `created_at`. String bounds use `String::len()`, i.e. bytes, not
  characters. `qty` is stored only as `qty_remaining` (the event carries `qty`).
- Compute: ~31k CU, up from ~26k before the mint became an account (measured as the suite maximum and rounded: the figure drifts by a few thousand between runs) (the TLV unpack plus one more account), well inside the 200k default; no compute-budget
  instruction needed.
