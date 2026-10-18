# update_warehouse: change log

## Files

Program
- `programs/farmer-core/src/instructions/update_warehouse.rs` (created): `UpdateWarehouse` (three accounts: `config` read + `has_one = admin`, `warehouse` mut at `["warehouse", warehouse_id]`, `admin` signer and not `mut`) + the handler, four `require!`s then four `if let Some` writes
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod update_warehouse; pub use update_warehouse::*;`, alphabetically last
- `programs/farmer-core/src/lib.rs` (modified): the `update_warehouse(ctx, warehouse_id, operator, pickup_notes, fee_bps, deliver_zip_prefixes)` wrapper, declared right after `create_warehouse` so the two read side by side; `ZipPrefix` was already imported for `create_warehouse`
- `programs/farmer-core/src/states.rs` (unchanged): this instruction reads `SEED_CONFIG`, `SEED_WAREHOUSE`, `MAX_NOTES_LEN`, `MAX_FEE_BPS`, `MAX_ZIP_PREFIXES` and writes four of the seven `Warehouse` fields; the account's 1367-byte size already reserves the maxima, so there is no `realloc`
- `programs/farmer-core/src/errors.rs` (unchanged for this instruction): `UnauthorizedAdmin` 6002 already existed for `create_warehouse` and `set_paused`, and the four bounds — `NotesTooLong` 6005, `TooManyZipPrefixes` 6007, `InvalidZipPrefixLen` 6008, `FeeBpsTooHigh` 6009 — for `create_warehouse`. The same commit appended `MintExtensionNotAllowed` 6033 for `publish_offer`; no code used here shifted
- `programs/farmer-core/src/events.rs` (unchanged): no event, exactly like `create_warehouse` — README section 9 lists no warehouse event

Tests
- `tests/update_warehouse.ts` (created), 11 cases: partial patch (notes + fee + prefixes written, `operator`, `name`, `delivery_fee_rules_uri` and `warehouse_id` untouched); all-`None` call deep-equal to the account before it; operator rotation rescuing an `InTransit` order (old operator then `UnauthorizedOperator`, new operator completes it, no event emitted); `fee_bps` raised to 10_000 leaving an existing order's `service_fee_minor` at `SERVICE_FEE`; non-admin signer; warehouse id that does not exist; the four bounds (`FeeBpsTooHigh`, `NotesTooLong`, `TooManyZipPrefixes`, `InvalidZipPrefixLen`); and the `warehouse` PDA resolving from the id argument
- `tests/helpers.ts` (modified): `market()` now also returns `warehouseId`, which this instruction needs as a seed argument — the derived PDA alone cannot be patched; `markInTransit`'s parameter type narrowed to `{ warehouse, operator }` so the rotation test can call it without a full `market()` object

Docs
- `LLM/instructions/update_warehouse/HOW_IT_WORKS.md`
- `LLM/instructions/update_warehouse/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/update_warehouse/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified): section 8.1's placeholder `update_warehouse(...)` (fees, notes, operator, prefixes) replaced by the real signature plus five bullets — admin signer, only the fields given, the `IN_TRANSIT` rescue, `fee_bps` applying to future orders only, `name` and `delivery_fee_rules_uri` not updatable
- `docs/DEVELOPMENT_PLAN.md` (modified): M6's "Compute budget review + constraints tightening" line expanded with this instruction and its reason

## Decisions

- Signer is `config.admin`, gated by `config has_one = admin @ UnauthorizedAdmin`, never the operator: a lost operator key cannot sign its own rotation, which is the one case the instruction was written for.
- The reason it exists: an order already `InTransit` can only be finished by `complete_order`, which requires `warehouse.operator`, and `expire_order` deliberately excludes `InTransit`. Rotating `operator` is that escrow's only exit. Residual accepted: if the admin key is gone too, nothing recovers those funds — README section 14 keeps the dispute flow in Phase 2.
- Every field is an `Option` and only `Some` is written, so no value has to be reserved to mean "unchanged" (`fee_bps = 0` and an empty prefix vector are both legitimate); an all-`None` call is a valid no-op.
- `warehouse_id` is a seed-only argument (`_warehouse_id` in the handler), per the AGENTS.md explicit-id rule; the client derives the `warehouse` PDA from it, so no account has to be passed at all.
- Argument order mirrors `create_warehouse` minus `name` and `delivery_fee_rules_uri`, which README 8.1 does not list and this instruction cannot change.
- Validations are `create_warehouse`'s, each re-run only when its field is present, and all of them precede all writes: a patch with one bad field writes none of its good ones. No new error variant — the five it can return already existed.
- No event, matching `create_warehouse` and README section 9, which lists no warehouse event; indexers read the account.
- No pause gate: `config` carries only the `has_one`, so pausing the market cannot also disable the escrow rescue.
- `admin` is not `mut` and there is no `system_program`: nothing is created and no lamports move, unlike `create_warehouse` where the admin pays rent.
- A new `fee_bps` applies to future orders only — `order.service_fee_minor` is computed once at `create_order` and `complete_order` pays out of the stored number — and that is asserted, not just documented.

## Prerequisites

- A `ProgramConfig` at `["config"]` (the singleton from `init_config`) and the `config.admin` keypair to sign; the admin needs no lamports beyond the transaction fee
- A `Warehouse` at `["warehouse", warehouse_id.to_le_bytes()]` created by `create_warehouse`; a missing one fails at deserialization with `AccountNotInitialized` (3012)
- The `warehouse_id` itself, not only the PDA: it is a seed argument
- No pause requirement, no operator signature, no token account, no mint, no rent

## History

- 2026-10-17 M6 follow-up: created, closing the gap M6's audit surfaced — an `InTransit` escrow with a lost operator key had no exit
