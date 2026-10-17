# set_paused: change log

## Files

Program
- `programs/farmer-core/src/instructions/set_paused.rs` (created): `SetPaused` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod set_paused; pub use set_paused::*;`
- `programs/farmer-core/src/lib.rs` (modified): `set_paused(ctx, paused)` wrapper
- `programs/farmer-core/src/states.rs` (shared, unchanged for this instruction): `ProgramConfig`, `SEED_CONFIG`; created by `init_config`, `paused` mutated here
- `programs/farmer-core/src/errors.rs` (shared, unchanged for this instruction): raises `UnauthorizedAdmin` (Config section, present since M0); no variant added
- `programs/farmer-core/src/events.rs` (not used): no event emitted

Tests
- `tests/set_paused.ts` (created): pause then unpause with `paused` asserted after each call, non-admin signer rejected with the flag unchanged
- `tests/helpers.ts` (modified): `setPaused(paused)` helper (provider wallet as admin); also used by `tests/publish_offer.ts` to trigger `ProgramPaused` and restore `false` in `finally`

Docs
- `LLM/instructions/set_paused/HOW_IT_WORKS.md`
- `LLM/instructions/set_paused/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/set_paused/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified): section 8.1 gained `set_paused(paused)` (admin; the only writer of `config.paused`, which gates market instructions)
- `docs/DEVELOPMENT_PLAN.md` (modified): M3 deliverables gained `set_paused` (admin toggle; without it the pause gate could never be exercised)
- `AGENTS.md` (modified): Testing Guidelines shared-helpers list gained `setPaused(bool)`

## Decisions

- Added in M3, not earlier: nothing else writes `config.paused` after `init_config`, so the `ProgramPaused` gate on `publish_offer` could neither be tested nor operated without it.
- Which instructions the flag gates is decided per instruction: `publish_offer` yes, `deactivate_offer` no (safety action); M4 order instructions will carry the constraint per AGENTS.md "Validation Rules".
- Test file covers the happy path and the one named error; missing-account and missing-signer cases are framework-level and skipped.
- Design rationale (explicit value, `has_one` gate, no self-gate, no event, no generic `update_config`): HOW_IT_WORKS.md "Design decisions".

## Prerequisites

- `ProgramConfig` created via `init_config` (in tests: the root `before` in `tests/helpers.ts`, with `paused = false`)
- Signer must be `config.admin`, i.e. the wallet that ran `init_config` (the provider wallet in tests)
- A funded fee payer; no rent, no account is created

## History

- 2026-10-17 M3: created
