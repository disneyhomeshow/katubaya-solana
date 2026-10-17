# register_customer: change log

## Files

Program
- `programs/farmer-core/src/states.rs`: `CustomerProfile` account (`authority`, `public_profile_uri: Option<String>` bounded by `MAX_URI_LEN`), `SEED_CUSTOMER`
- `programs/farmer-core/src/errors.rs`: reuses `UriTooLong` from the shared input-bounds section; no variant added for this instruction
- `programs/farmer-core/src/instructions/register_customer.rs`: `RegisterCustomer` accounts struct and handler
- `programs/farmer-core/src/instructions/mod.rs`: module registered and re-exported
- `programs/farmer-core/src/lib.rs`: `register_customer(ctx, public_profile_uri: Option<String>)` wrapper

Tests
- `tests/register_customer.ts`: "persists every field", "accepts a missing uri", "rejects uri above MAX_URI_LEN", "rejects a second registration for the same customer"
- `tests/helpers.ts`: `program`, `customerPDA(pk)`, `fund()`, `fails()` used by the test file

Docs
- `LLM/instructions/register_customer/` (this folder)

## Decisions

- PDA seeded by the customer's pubkey: one profile per wallet, no id argument, no counter.
- Duplicate registration is rejected by the system program at `init`; no handler check.
- `customer` is both signer and rent payer, so onboarding needs no admin or warehouse party.
- The only handler check is the `MAX_URI_LEN` bound, applied only when the URI is `Some`.
- No `ProgramConfig` read, so no pause gate; warehouse eligibility is out of scope until the M2 `WarehouseCustomer` flow.

## Prerequisites

None beyond a funded signer (rent for a 245-byte account plus the transaction fee). The instruction does not read `ProgramConfig` or any `Warehouse`; the root `before` in `tests/helpers.ts` still creates the config singleton, but this instruction does not depend on it.

## History

- 2026-10-17 M1: created
- 2026-10-17 M2: `request_customer_confirmation` now requires the profile (read-only, via `seeds` constraint); no code change here
