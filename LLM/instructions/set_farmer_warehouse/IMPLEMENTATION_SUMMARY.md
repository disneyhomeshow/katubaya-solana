# set_farmer_warehouse: change log

## Files

Program
- `programs/farmer-core/src/instructions/set_farmer_warehouse.rs` (created): `SetFarmerWarehouse` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod set_farmer_warehouse; pub use set_farmer_warehouse::*;`
- `programs/farmer-core/src/lib.rs` (modified): `set_farmer_warehouse(ctx)` wrapper
- `programs/farmer-core/src/states.rs` (read only): `FarmerProfile.warehouse_approved` already defined for `register_farmer`
- `programs/farmer-core/src/errors.rs` (modified): `UnauthorizedOperator` (Warehouse section), `WarehouseMismatch` (Farmer section)

Tests
- `tests/set_farmer_warehouse.ts` (created): happy path, idempotency, wrong operator, wrong warehouse
- `tests/helpers.ts` (shared): `fund`, `createWarehouse`, `registerFarmer`, `fails`

Docs
- `LLM/instructions/set_farmer_warehouse/HOW_IT_WORKS.md`
- `LLM/instructions/set_farmer_warehouse/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/set_farmer_warehouse/IMPLEMENTATION_SUMMARY.md`

## Decisions

- No arguments: the approved warehouse is whatever the farmer requested in `register_farmer`; the operator cannot substitute another.
- Both gates are `#[account]` constraints with named errors; the handler is one assignment and has no `require!`.
- Idempotent by construction (bool set to `true`), so no "already approved" error and safe to retry.
- `farmer_profile` is passed by address and checked by type + warehouse match, not by seeds, because the farmer key is not an input.
- `ProgramConfig` is not read: approval is scoped to the warehouse operator, with no admin or pause gate.
- Test file covers each named error once and skips the missing-signer case (framework-level).

## Prerequisites

- `ProgramConfig` created via `init_config` (needed transitively: `create_warehouse` requires it; this instruction does not read it)
- A `Warehouse` created by the admin via `create_warehouse` with `operator` set to the signer's key
- A `FarmerProfile` created via `register_farmer` whose `warehouse` field equals that warehouse's address
- The operator keypair funded for the transaction fee (no rent: no account is created)

## History

- 2026-10-17 M1: created
