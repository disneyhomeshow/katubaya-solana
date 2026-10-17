# publish_offer: change log

## Files

Program
- `programs/farmer-core/src/instructions/publish_offer.rs` (created): `PublishOffer` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod publish_offer; pub use publish_offer::*;`
- `programs/farmer-core/src/lib.rs` (modified): `publish_offer(ctx, offer_id, crop_name, cultivar_name, unit_code, qty, price_minor, mint, expires_at, notes_public, pack_ref)` wrapper
- `programs/farmer-core/src/states.rs` (modified, M3): `LotOffer` added; `SEED_OFFER`, `MAX_NAME_LEN`, `MAX_NOTES_LEN` pre-existing
- `programs/farmer-core/src/errors.rs` (modified, M3): Offer section appended at the end, `FarmerNotApproved` 6015 through `OfferInactive` 6020; this instruction raises `FarmerNotApproved`, `InvalidQuantity`, `InvalidPrice`, `InvalidExpiry` plus the pre-existing `ProgramPaused`, `MintNotAllowed`, `NameTooLong`, `NotesTooLong`
- `programs/farmer-core/src/events.rs` (modified, M3): `OfferPublished` (emitted here) and `OfferDeactivated` (sibling `deactivate_offer`) appended

Tests
- `tests/publish_offer.ts` (created): happy path + event + every stored field, optional args as `null`, `pack_ref` stored, not approved, mint outside allowlist, paused (unpause in `finally`), three length errors, zero qty, zero price, past expiry, duplicate id
- `tests/helpers.ts` (modified, M3): `offerPDA`, `approvedFarmer`, `offerArgs`, `publishOfferTx`, `publishOffer`, `setPaused`

Docs
- `LLM/instructions/publish_offer/HOW_IT_WORKS.md`
- `LLM/instructions/publish_offer/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/publish_offer/IMPLEMENTATION_SUMMARY.md`
- `README.md` section 8.1 (modified, M3): `set_paused` line added, the toggle this instruction's pause gate depends on; section 8.4 unchanged
- `docs/DEVELOPMENT_PLAN.md` M3 (modified): `set_paused` added to the milestone for the same reason

## Decisions

- Ten args mirror README 8.4; `offer_id` is an explicit `u64` arg and seed, no on-chain counter, a duplicate fails at `init` ("already in use").
- Seeds `["offer", farmer_wallet, offer_id LE]`; `LotOffer.farmer` is the wallet (authority), not the `FarmerProfile` PDA, so `deactivate_offer` gates with `has_one = farmer` on the signer.
- `farmer_profile` derived from the signer's key and gated by `constraint = warehouse_approved @ FarmerNotApproved`; a farmer cannot pass another's approved profile.
- `warehouse` copied from `farmer_profile.warehouse`; no `Warehouse` account loaded, no warehouse arg.
- Mint allowlist enforced once, here (`is_empty() || contains`); `create_order` (M4) trusts `offer.mint`. Empty-list branch untested: the shared config has one mint and no instruction edits the list.
- `constraint = !config.paused` on `config` (market instruction). `set_paused` added in M3 so the gate can be exercised and operated; the test restores `paused = false` in `finally` because `ProgramConfig` is a singleton shared by every test file.
- Gates are `#[account]` constraints; `require!` only validates args, in handler order: names, notes, `qty`, `price_minor`, `expires_at`, mint.
- `created_at` from `Clock::get()`, the same `now` used for the `InvalidExpiry` check; never from the client.
- `qty` stored as `qty_remaining`, `active = true` at publish; `pack_ref` (PackPointer, M7) and `unit_code` (client mapping, README 10) stored unvalidated.
- Farmer pays rent (`payer = farmer`, 895 bytes); the provider wallet is not involved.
- `update_offer_price` / `increase_offer_qty` (README 8.4 optional) not implemented and not on the roadmap.
- Test file covers each named error once and skips missing-profile and missing-signer cases (framework-level).

## Prerequisites

- `ProgramConfig` created via `init_config`, with `paused = false` (or reset through `set_paused`) and `mint` in `allowed_mints` (or an empty list)
- A `Warehouse` created by the admin via `create_warehouse`
- A `FarmerProfile` for the signer created via `register_farmer` (requesting that warehouse) and approved by the warehouse operator via `set_farmer_warehouse` (`warehouse_approved = true`)
- The farmer keypair funded: it signs and pays rent for the 895-byte `LotOffer` (tests: `fund()` airdrops 2 SOL)
- An `offer_id` not yet used by this farmer (`freshId()` in tests)

## History

- 2026-10-17 M3: created
