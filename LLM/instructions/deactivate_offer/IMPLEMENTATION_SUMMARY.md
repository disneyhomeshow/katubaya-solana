# deactivate_offer: change log

## Files

Program
- `programs/farmer-core/src/instructions/deactivate_offer.rs` (created): `DeactivateOffer` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod deactivate_offer; pub use deactivate_offer::*;`
- `programs/farmer-core/src/lib.rs` (modified): `deactivate_offer(ctx)` wrapper, no args
- `programs/farmer-core/src/states.rs` (shared M3): `LotOffer`, `SEED_OFFER`; created by `publish_offer`, mutated here (`active` only)
- `programs/farmer-core/src/errors.rs` (shared M3): raises `UnauthorizedFarmer` (6016) and `OfferInactive` (6020) from the Offer section, appended last so earlier codes did not shift
- `programs/farmer-core/src/events.rs` (shared M3): emits `OfferDeactivated { offer }`

Tests
- `tests/deactivate_offer.ts` (created): happy path + event + `active === false`, wrong farmer, already inactive
- `tests/helpers.ts` (shared M3): `approvedFarmer`, `publishOffer` (returns `offerPDA(farmer, id)`), `offerPDA`; reuses `fund`, `createWarehouse`, `fails`, `events`

Docs
- `LLM/instructions/deactivate_offer/HOW_IT_WORKS.md`
- `LLM/instructions/deactivate_offer/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/deactivate_offer/IMPLEMENTATION_SUMMARY.md`
- `README.md` / `docs/DEVELOPMENT_PLAN.md`: not changed by this instruction; both already listed `deactivate_offer` (README 8.4, plan M3). The M3 edits to those files concern `set_paused`.

## Decisions

Rationale for each is in `HOW_IT_WORKS.md` "Design decisions"; this is the list.

- Zero arguments: the README's `offer_id` parameter became the `offer` account, tied to the signer by `has_one = farmer`.
- Both gates are `#[account]` constraints (`UnauthorizedFarmer`, `OfferInactive`); handler is one write plus `emit!`, no `require!`.
- No `config.paused` gate on purpose (safety action; doc comment on the struct).
- Not idempotent: a repeat fails with `OfferInactive`.
- Farmer only, by wallet; no operator or admin path in M3.
- `offer` passed by address, not re-derived from seeds (`offer_id` is not an input).
- One-way transition; README 8.4's optional `update_offer_price` / `increase_offer_qty` are not implemented or on the roadmap.
- Test file covers each named error once; missing-account (3012) and missing-signer (runtime) cases are framework-level and untested.

## Prerequisites

- `ProgramConfig` created via `init_config` (read transitively by `publish_offer`; this instruction does not read it)
- A `Warehouse` created by the admin via `create_warehouse`
- A `FarmerProfile` for the signer, registered via `register_farmer` and approved via `set_farmer_warehouse`
- A `LotOffer` published by the same wallet via `publish_offer`, currently `active == true`
- The farmer keypair available to sign; a funded fee payer (the provider wallet in the tests). No rent: no account is created
- Not required: `config.paused == false` (no pause gate here)

## History

- 2026-10-17 M3: created
