# create_warehouse: change log

## Files

Program (`programs/farmer-core/src/`):
- `instructions/create_warehouse.rs` — created: `CreateWarehouse` accounts struct and handler.
- `instructions/mod.rs` — `pub mod create_warehouse;` + `pub use create_warehouse::*;`.
- `lib.rs` — `create_warehouse` entry point under `#[program]`; `use crate::states::ZipPrefix;` for the arg type.
- `states.rs` — `Warehouse` account, `ZipPrefix` struct, `SEED_WAREHOUSE`, constants `MAX_NAME_LEN`, `MAX_NOTES_LEN`, `MAX_URI_LEN`, `MAX_ZIP_PREFIXES`, `MAX_FEE_BPS`.
- `errors.rs` — variants `NameTooLong`, `NotesTooLong`, `UriTooLong` (shared input bounds) and `TooManyZipPrefixes`, `InvalidZipPrefixLen`, `FeeBpsTooHigh` (warehouse section) in `FarmerCoreError`.

Tests (`tests/`):
- `create_warehouse.ts` — created: happy path asserting all seven fields, non-admin signer, each of the six bounds, duplicate id.
- `helpers.ts` — `warehousePDA(id)`, `freshId()`, `fund()`, `fails()`, and the `createWarehouse(operator, id = freshId())` fixture used by `register_farmer` / `set_farmer_warehouse` tests.

Docs:
- `LLM/instructions/create_warehouse/HOW_IT_WORKS.md`
- `LLM/instructions/create_warehouse/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/create_warehouse/IMPLEMENTATION_SUMMARY.md`

## Decisions

- Explicit `warehouse_id` argument instead of an on-chain counter: PDA derivable client-side, no write contention, duplicates rejected by the System program at `init`.
- Admin check is `has_one = admin` on `config` (named `UnauthorizedAdmin`), not handler code: fails before the handler, visible in the IDL.
- `operator` is an argument, not a signer or account: provisioning does not require the operator's participation; operator authority is enforced on later instructions.
- Every bounded field is re-validated with `require!` even though `#[max_len]` already sizes the account: each overflow gets a named error instead of a serialisation failure.
- Zip prefix `len` restricted to 3..=5 on-chain although prefixes are discovery-only, so UIs can filter without re-validating.
- Single error enum (`FarmerCoreError`): Anchor 0.32 writes only one `#[error_code]` enum into the IDL (comment in `errors.rs`).
- Tests pass no accounts in the happy path and override only `admin` via `.accountsPartial` for the negative case (AGENTS.md "Account resolution").

## Prerequisites

- `ProgramConfig` PDA (`["config"]`) initialised by `init_config`; the singleton is created once in the root `before` of `tests/helpers.ts`.
- Signer must be `config.admin`, with SOL for the 1367-byte rent exemption and fees.
- A `warehouse_id` not used before (the suite uses `freshId()`).
- `operator` pubkey chosen in advance; it needs no account, funds or signature.
- No mints, no other PDAs.

## History

- 2026-10-17 M1: created.
