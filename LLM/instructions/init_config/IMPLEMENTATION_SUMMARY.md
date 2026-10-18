# init_config: change log

## Files

Program
- `programs/farmer-core/src/states.rs`: `ProgramConfig` account, `SEED_CONFIG`, `MAX_ALLOWED_MINTS`
- `programs/farmer-core/src/errors.rs`: `FarmerCoreError` enum, Config section (`TooManyAllowedMints`)
- `programs/farmer-core/src/instructions/init_config.rs`: `InitConfig` accounts struct and handler
- `programs/farmer-core/src/instructions/mod.rs`: module registration and re-export
- `programs/farmer-core/src/lib.rs`: `farmer_core::init_config` wrapper

Tests
- `tests/helpers.ts`: root `before` that creates the singleton config; shared `configPDA`, `logisticsWallet`, `allowedMints`, `fails`
- `tests/init_config.ts`: happy path asserting every field, second init rejected, non-signing admin rejected

Docs
- `LLM/instructions/init_config/HOW_IT_WORKS.md`
- `LLM/instructions/init_config/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/init_config/IMPLEMENTATION_SUMMARY.md`

## Decisions

- Singleton PDA on a constant seed: later instructions resolve `config` from the IDL, and `init` rejects a duplicate without an `initialized` flag.
- Signer becomes admin with no precondition: nothing exists on chain to gate against before the config does.
- `allowed_mints` length bounded with `require!`, not a constraint: it is an arg bound (`AGENTS.md` Error Handling); the 1232 B tx size already keeps the vector under 31, so the branch is defensive only.
- Empty `allowed_mints` means "any mint that is a real mint account and carries no denied token extension"; enforcement lives in `publish_offer`, so the config stays data-only.
- Single `FarmerCoreError` enum: Anchor 0.32 writes only one `#[error_code]` enum into the IDL (comment in `errors.rs`).
- Config created once in `tests/helpers.ts`, never in a test file: `init_config` is not re-runnable, so per-file setup would collide on the PDA.

## Prerequisites

None beyond a funded signer (rent for 1037 bytes) and the deployed program. Must run before any instruction that reads `config`.

## History

- M0: created; docs written in M1 (2026-10-17).
