# request_customer_confirmation: change log

## Files

Program
- `programs/farmer-core/src/states.rs` (modified): `WarehouseCustomerStatus` enum and `WarehouseCustomer` account added; `SEED_WCUSTOMER` and `SEED_CUSTOMER` already existed
- `programs/farmer-core/src/errors.rs` (modified): `AlreadyConfirmed`, `AlreadyRevoked` added to the Customer section for the sibling M2 instructions; `CustomerNotFound` already existed and is kept, unused, for upcoming use; this instruction raises none of them
- `programs/farmer-core/src/events.rs` (created): `CustomerConfirmationRequested`, `CustomerConfirmed`, `CustomerRevoked`
- `programs/farmer-core/src/instructions/request_customer_confirmation.rs` (created): `RequestCustomerConfirmation` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod request_customer_confirmation; pub use request_customer_confirmation::*;`
- `programs/farmer-core/src/lib.rs` (modified): `pub mod events;` and the `request_customer_confirmation(ctx)` wrapper

Tests
- `tests/request_customer_confirmation.ts` (created): "creates the relation as pending and emits CustomerConfirmationRequested", "rejects a customer without a profile", "rejects a warehouse that does not exist", "rejects a second request for the same pair"
- `tests/helpers.ts` (modified): `wcustomerPDA`, `registerCustomer`, `requestConfirmation`, `events`

Docs
- `LLM/instructions/request_customer_confirmation/HOW_IT_WORKS.md`
- `LLM/instructions/request_customer_confirmation/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/request_customer_confirmation/IMPLEMENTATION_SUMMARY.md`

## Decisions

- No arguments (README 8.3 writes `request_customer_confirmation(warehouse)`): the warehouse is an account so its key seeds the PDA; the customer is the signer.
- `init`-only PDA per (warehouse, customer) pair: a duplicate fails with "already in use"; no "already requested" error and no re-request after `Revoked` (re-admission is the operator's `confirm_customer`).
- `customer_profile` is required (seed-bound to the signer) but never read: registration gate, surfaced as `AccountNotInitialized`, not `CustomerNotFound`.
- `warehouse` is passed by address and type-checked, not re-derived (`warehouse_id` is not an input); the operator is not involved and the customer pays rent.
- `ProgramConfig` is not read: no pause or admin gate.
- Tests cover each reachable failure once; the missing-signer case is framework-level and skipped.

## Prerequisites

- `ProgramConfig` created via `init_config` (transitively: `create_warehouse` requires it; this instruction does not read it)
- A `Warehouse` created by the admin via `create_warehouse` (any operator; the operator does not sign here)
- A `CustomerProfile` for the signer, created via `register_customer`
- No existing `WarehouseCustomer` for this (warehouse, customer) pair
- The customer keypair funded for rent (115 bytes) plus the transaction fee

## History

- 2026-10-17 M2: created
