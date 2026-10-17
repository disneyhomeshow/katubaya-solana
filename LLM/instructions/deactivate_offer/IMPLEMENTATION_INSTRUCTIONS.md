# deactivate_offer: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/deactivate_offer.rs` | `DeactivateOffer` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `deactivate_offer(ctx)` |
| `programs/farmer-core/src/states.rs` | `LotOffer`, `SEED_OFFER` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{UnauthorizedFarmer, OfferInactive}` (Offer section) |
| `programs/farmer-core/src/events.rs` | `OfferDeactivated` |
| `tests/deactivate_offer.ts` | Happy path with event and state, wrong farmer, already inactive |
| `tests/helpers.ts` | `fund`, `createWarehouse`, `approvedFarmer`, `publishOffer` (returns `offerPDA(farmer, id)`), `fails`, `events` |
| `target/idl/farmer_core.json` | Generated IDL (accounts, discriminator, error codes, event) |

## Accounts struct

```rust
/// Farmer stops purchases on an active offer. No pause gate: deactivating is a safety action.
#[derive(Accounts)]
pub struct DeactivateOffer<'info> {
    #[account(
        mut,
        has_one = farmer @ FarmerCoreError::UnauthorizedFarmer,
        constraint = offer.active @ FarmerCoreError::OfferInactive
    )]
    pub offer: Account<'info, LotOffer>,

    pub farmer: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `offer` | `Account<LotOffer>` | `mut`; `has_one = farmer` else `UnauthorizedFarmer`; `offer.active` else `OfferInactive` | must pass (`offerPDA(farmer, id)`; no `seeds` here and `offer_id` is not an input) |
| `farmer` | `Signer` | must sign | must pass + `.signers([farmer])` (non-wallet signer) |

## Arguments

None: `deactivateOffer()` takes no args. The README's `offer_id` is implied by the `offer` account.

## Account layout

Mutated:

```rust
#[account]
#[derive(InitSpace)]
pub struct LotOffer {
    pub farmer: Pubkey, // farmer authority (wallet), also an offer seed
    pub warehouse: Pubkey,
    pub offer_id: u64,
    pub pack_ref: Option<Pubkey>, // PackPointer (M7), stored unvalidated until then
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

Seeds `[SEED_OFFER, farmer.key().as_ref(), offer_id.to_le_bytes().as_ref()]` (`SEED_OFFER = b"offer"` in
`states.rs`; the `seeds` constraint lives on `publish_offer`, not here); size 8 + INIT_SPACE = 895 bytes
(32 + 32 + 8 + 33 + 104 + 105 + 2 + 9 + 505 + 32 + 8 + 8 + 1 + 8 = 887). Created by `publish_offer`.
The test asserts `(await program.account.lotOffer.fetch(offer)).active` `.to.equal(false)`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `UnauthorizedFarmer` | 6016 | `offer.farmer != farmer.key()` (test: "rejects a signer that is not the offer's farmer") |
| `OfferInactive` | 6020 | `offer.active == false` (test: "rejects an already inactive offer") |
| `AccountNotInitialized` (Anchor) | 3012 | `offer` address has no data; not exercised in this test file |
| "Signature verification failed" (runtime) | n/a | `farmer` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

## Events

```rust
#[event]
pub struct OfferDeactivated {
    pub offer: Pubkey,
}
```

Emitted after the write, with `offer.key()`. The test reads it with `events(deactivate(offer))`
(`tests/helpers.ts`: rpc at commitment `confirmed`, logs decoded by `anchor.EventParser`) and asserts
`evs.map((e) => e.name)` deep-equals `["offerDeactivated"]` (camelCase) and `evs[0].data.offer.equals(offer)`.

## Client call

From `tests/deactivate_offer.ts`:

```typescript
const deactivate = (offer: anchor.web3.PublicKey, signer = farmer) =>
  program.methods
    .deactivateOffer()
    .accountsPartial({ offer, farmer: signer.publicKey })
    .signers([signer]);
```

Fixtures (all from `tests/helpers.ts`): `operator = await fund()`, `warehouse = await createWarehouse(operator.publicKey)`,
`farmer = await approvedFarmer(warehouse, operator)`, `offer = await publishOffer(farmer)` per test.

## Implementation notes

- Order of checks: accounts deserialize in field order (`offer`, `farmer`), then constraints run. Within `offer`,
  `has_one` is generated before `constraint`, so `UnauthorizedFarmer` precedes `OfferInactive`. The tests trigger
  each error in isolation, so they do not pin this order.
- The handler has no `require!`, no `Clock` and no `Option` handling: one write (`offer.active = false`) then `emit!`.
- No `config` account, so no `ProgramPaused` gate; `set_paused(true)` does not block this instruction. No
  `farmer_profile` account, so `warehouse_approved` is not re-checked (already gated at `publish_offer`).
- The IDL marks `farmer` with `relations: ["offer"]` (from `has_one`); the test still passes it explicitly and in
  `.signers` because it is not the provider wallet.
- `qty_remaining` is not modified; deactivation is independent of stock.
