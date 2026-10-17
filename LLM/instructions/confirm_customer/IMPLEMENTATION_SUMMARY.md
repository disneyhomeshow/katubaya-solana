# confirm_customer: change log

## Files

Program
- `programs/farmer-core/src/instructions/confirm_customer.rs` (created): `ConfirmCustomer` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod confirm_customer; pub use confirm_customer::*;`
- `programs/farmer-core/src/lib.rs` (modified): `confirm_customer(ctx, notes_hash)` wrapper
- `programs/farmer-core/src/states.rs` (shared M2): `WarehouseCustomerStatus`, `WarehouseCustomer`, `SEED_WCUSTOMER`; created by `request_customer_confirmation`, mutated here
- `programs/farmer-core/src/errors.rs` (shared M2): raises `AlreadyConfirmed` (Customer section, added with the M2 batch), `UnauthorizedOperator` (Warehouse) and `WarehouseMismatch` (Farmer)
- `programs/farmer-core/src/events.rs` (shared M2, created by `request_customer_confirmation`): emits `CustomerConfirmed { warehouse, customer }`

Tests
- `tests/confirm_customer.ts` (created): happy path + event, null `notes_hash`, wrong operator, wrong warehouse, already confirmed, re-admit after revoke
- `tests/helpers.ts` (shared): `fund`, `createWarehouse`, `registerCustomer`, `requestConfirmation` (returns `wcustomerPDA(warehouse, customer)`), `fails`, `events`

Docs
- `LLM/instructions/confirm_customer/HOW_IT_WORKS.md`
- `LLM/instructions/confirm_customer/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/confirm_customer/IMPLEMENTATION_SUMMARY.md`

## Decisions

- Single argument `notes_hash: Option<[u8; 32]>`; the README's `(warehouse, customer)` parameters are the `warehouse_customer` account, whose stored keys feed the event.
- All three gates are `#[account]` constraints with named errors; the handler is three writes plus `emit!`, no `require!`.
- Not idempotent: `status != Confirmed` rejects a repeat with `AlreadyConfirmed`, because confirm restamps `confirmed_at`, overwrites `notes_hash` and re-emits the indexer event.
- `Revoked -> Confirmed` allowed on purpose: the relation PDA is `init`-only in `request_customer_confirmation`, so re-admission has no other path.
- `confirmed_at` from `Clock::get()`, never from the client, so it cannot be backdated.
- `notes_hash` written unconditionally (`None` clears); it is a hash of the off-chain record, never PII (README 5.5).
- `warehouse_customer` passed by address and checked by type + `has_one = warehouse`, not by seeds, because the customer key is not an input.
- `WarehouseMismatch` reused for the relation/warehouse check instead of a customer-specific variant (AGENTS.md: reuse variants across entities); its `#[msg]` text is still farmer-worded.
- `ProgramConfig` not read: no admin or pause gate in M2.
- Test file covers each named error once and skips missing-account and missing-signer cases (framework-level).

## Prerequisites

- `ProgramConfig` created via `init_config` (needed transitively by `create_warehouse`; this instruction does not read it)
- A `Warehouse` created by the admin via `create_warehouse` with `operator` set to the signer's key
- A `CustomerProfile` created via `register_customer` (required by `request_customer_confirmation`)
- A `WarehouseCustomer` for this warehouse+customer pair created via `request_customer_confirmation`, currently `Pending` or `Revoked`
- A funded fee payer (the provider wallet in the tests; the operator only signs). No rent: no account is created

## History

- 2026-10-17 M2: created
