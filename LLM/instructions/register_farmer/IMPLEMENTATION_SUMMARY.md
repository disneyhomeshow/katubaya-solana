# register_farmer: change log

## Files

Program
- `programs/farmer-core/src/states.rs`: `FarmerProfile` account, `SEED_FARMER`; reuses `MAX_NAME_LEN`, `MAX_URI_LEN`
- `programs/farmer-core/src/errors.rs`: `NameTooLong`, `UriTooLong` in the shared "Input bounds" section of `FarmerCoreError`
- `programs/farmer-core/src/instructions/register_farmer.rs`: accounts struct and handler
- `programs/farmer-core/src/instructions/mod.rs`: module registration and re-export
- `programs/farmer-core/src/lib.rs`: `farmer_core::register_farmer` wrapper

Tests
- `tests/register_farmer.ts`: happy path (every field asserted), `NameTooLong`, `UriTooLong`, missing warehouse (`AccountNotInitialized`), duplicate registration ("already in use")
- `tests/helpers.ts`: `registerFarmer(warehouse)` fixture, `farmerPDA`, `fund`, `fails`, `createWarehouse`

Docs
- `LLM/instructions/register_farmer/HOW_IT_WORKS.md`
- `LLM/instructions/register_farmer/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/register_farmer/IMPLEMENTATION_SUMMARY.md`

## Decisions

- PDA keyed by the farmer pubkey: one profile per wallet, uniqueness enforced by `init`, no counter needed.
- `warehouse_approved` hard-coded to `false`: approval is a separate operator-signed instruction (`set_farmer_warehouse`), so a farmer cannot self-approve.
- `warehouse` accepted as a typed account with no extra constraint: existence and type are all the request needs; the operator decides on approval.
- No `config` account: onboarding is not pause-gated, only market instructions are (AGENTS.md "Validation Rules").
- Bounds errors reuse the shared `NameTooLong` / `UriTooLong` variants instead of farmer-specific ones: single error enum (see the header comment in `errors.rs`).
- Farmer pays rent: `payer = farmer`, `#[account(mut)]` on the signer.

## Prerequisites

- An existing `Warehouse` account to request (created by the admin via `create_warehouse`, which itself requires the `config` PDA from `init_config`).
- The farmer keypair funded for the rent of a 381-byte account plus the tx fee (tests use `fund()`, a 2 SOL airdrop).
- The farmer must sign; in tests it is not the provider wallet, hence `accountsPartial` + `signers`.

## History

- 2026-10-17 M1: created.
