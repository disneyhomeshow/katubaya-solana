# set_paused: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/set_paused.rs` | `SetPaused` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `set_paused(ctx, paused)` |
| `programs/farmer-core/src/states.rs` | `ProgramConfig`, `SEED_CONFIG`, `MAX_ALLOWED_MINTS` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::UnauthorizedAdmin` (raised here), `ProgramPaused` (raised by the gated instructions) |
| `programs/farmer-core/src/instructions/publish_offer.rs` | Consumer: `constraint = !config.paused @ FarmerCoreError::ProgramPaused` |
| `tests/set_paused.ts` | Pause then unpause, non-admin signer |
| `tests/helpers.ts` | `configPDA`, `setPaused`, `fund`, `fails`; root `before` creates the singleton config |
| `tests/publish_offer.ts` | Uses `setPaused` to exercise `ProgramPaused` ("rejects while the program is paused") |
| `target/idl/farmer_core.json` | Generated IDL (const-seed PDA for `config`, `admin` with `relations: ["config"]`, error codes) |

## Accounts struct

```rust
/// Admin flips `config.paused`; market instructions carry `constraint = !config.paused`.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump,
        has_one = admin @ FarmerCoreError::UnauthorizedAdmin
    )]
    pub config: Account<'info, ProgramConfig>,

    pub admin: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `config` | `Account<ProgramConfig>` | `mut`; `seeds = [SEED_CONFIG]`, `bump` else `ConstraintSeeds`; `has_one = admin` else `UnauthorizedAdmin` | auto from IDL (const seeds `["config"]`) |
| `admin` | `Signer` | must sign | auto: defaults to the provider wallet; override with `.accountsPartial({ admin })` + `.signers([kp])` |

## Arguments

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `paused` | `bool` | `boolean` | none; written as-is | n/a |

## Account layout

Mutated:

```rust
#[account]
#[derive(InitSpace)]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub logistics_wallet: Pubkey,
    pub paused: bool,
    #[max_len(MAX_ALLOWED_MINTS)]
    pub allowed_mints: Vec<Pubkey>,
}
```

Seeds `[SEED_CONFIG]` (`SEED_CONFIG = b"config"`); size 8 + INIT_SPACE = 1037 bytes
(32 + 32 + 1 + (4 + 32 * 30) = 1029, `MAX_ALLOWED_MINTS = 30`). Created by `init_config`; this instruction
writes `paused` only. The TS client reads it with `program.account.programConfig.fetch(configPDA)` and
decodes `paused` as `boolean`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `UnauthorizedAdmin` | 6002 | `config.admin != admin.key()` (test: "rejects a signer that is not config.admin", which also asserts `paused` stayed `false`) |
| `ProgramPaused` | 6001 | never by this instruction; raised by `publish_offer` while the flag set here is `true` (test: `tests/publish_offer.ts` "rejects while the program is paused") |
| `AccountNotInitialized` (Anchor) | 3012 | `config` PDA has no data, i.e. `init_config` never ran; not exercised: the root `before` in `tests/helpers.ts` creates it |
| `ConstraintSeeds` (Anchor) | 2006 | a `config` address that is not the `["config"]` PDA; unreachable through the generated client unless overridden |
| "Signature verification failed" (runtime) | n/a | `admin` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

## Events

This instruction emits nothing; `events.rs` defines no config or pause event (README section 9 has none).

## Client call

From `tests/helpers.ts` (happy path, nothing passed: `config` from seeds, `admin` = provider wallet):

```typescript
/** Admin (provider wallet) flips config.paused. */
export const setPaused = (paused: boolean) => program.methods.setPaused(paused).rpc();
```

From `tests/set_paused.ts` (non-admin signer):

```typescript
const stranger = await fund();
const tx = program.methods.setPaused(true).accountsPartial({ admin: stranger.publicKey }).signers([stranger]).rpc();
expect(await fails(tx)).to.equal("UnauthorizedAdmin");
```

## Implementation notes

- Order of checks: `config` deserializes first (`AccountNotInitialized` if missing), then its constraints
  run in Anchor's fixed per-account order, not declaration order: `seeds`/`bump` (`ConstraintSeeds`), `mut`,
  `has_one = admin` (`UnauthorizedAdmin`). Signature presence is checked by the runtime before the program
  executes.
- The handler is `ctx.accounts.config.paused = paused; Ok(())`: no `require!`, no `Clock`, no `emit!`, no
  fallible call.
- No `constraint = config.paused != paused`, so writing the current value succeeds; not covered by a
  dedicated test (the happy path goes `true` then `false`).
- The IDL marks `admin` with `relations: ["config"]` (from `has_one`) and `config` with a const-seed `pda`,
  which is why the happy-path call passes no accounts at all.
