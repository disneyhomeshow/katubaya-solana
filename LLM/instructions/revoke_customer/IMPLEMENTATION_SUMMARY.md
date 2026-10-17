# revoke_customer: change log

## Files

Program
- `programs/farmer-core/src/instructions/revoke_customer.rs` (created): `RevokeCustomer` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod revoke_customer; pub use revoke_customer::*;`
- `programs/farmer-core/src/lib.rs` (modified): `revoke_customer(ctx)` wrapper
- `programs/farmer-core/src/states.rs` (read only): `WarehouseCustomer` and `WarehouseCustomerStatus` already added for `request_customer_confirmation`; `SEED_WCUSTOMER` dates from the initial setup
- `programs/farmer-core/src/errors.rs` (modified): `AlreadyRevoked` (Customer section); reuses `UnauthorizedOperator` (Warehouse) and `WarehouseMismatch` (Farmer). `CustomerNotFound` is defined in the same section but not used by this instruction; it stays for upcoming instructions
- `programs/farmer-core/src/events.rs` (modified): `CustomerRevoked { warehouse, customer }`

Tests
- `tests/revoke_customer.ts` (created): revoke from Confirmed (keeps `confirmed_at`, asserts event), revoke from Pending, wrong operator, wrong warehouse, double revoke
- `tests/helpers.ts` (shared): `fund`, `createWarehouse`, `registerCustomer`, `requestConfirmation`, `wcustomerPDA`, `fails`, `events`

Docs
- `LLM/instructions/revoke_customer/HOW_IT_WORKS.md`
- `LLM/instructions/revoke_customer/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/revoke_customer/IMPLEMENTATION_SUMMARY.md`

## Decisions

- Three `#[account]` constraint gates with named errors (`WarehouseMismatch`, `AlreadyRevoked`, `UnauthorizedOperator`); the handler is one assignment plus `emit!`, no `require!`.
- Not idempotent: `status != Revoked` blocks a second revoke so one transition emits exactly one `CustomerRevoked`.
- `warehouse_customer` is passed by address (type check + `has_one = warehouse`), not re-derived: the customer key is not an input.
- No args, no `ProgramConfig`; `confirmed_at` / `notes_hash` kept as history. Rationale per decision in `HOW_IT_WORKS.md` Design decisions.
- Test file covers each named error once and the event; missing-signer and missing-account cases are framework-level and skipped.

## Prerequisites

- `ProgramConfig` created via `init_config` (needed transitively by `create_warehouse`; this instruction does not read it)
- A `Warehouse` created by the admin via `create_warehouse` with `operator` set to the signer's key
- A `CustomerProfile` created via `register_customer` (needed transitively by `request_customer_confirmation`)
- A `WarehouseCustomer` created via `request_customer_confirmation` for that warehouse, in status `Pending` or `Confirmed`
- The operator keypair funded for the transaction fee (no rent: no account is created)

## History

- 2026-10-17 M2: created
