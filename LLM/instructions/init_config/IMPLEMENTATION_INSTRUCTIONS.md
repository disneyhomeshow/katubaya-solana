# init_config: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/init_config.rs` | `InitConfig` accounts struct and `init_config` handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod init_config; pub use init_config::*;` |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `farmer_core::init_config`, delegates to the handler |
| `programs/farmer-core/src/states.rs` | `ProgramConfig`, `SEED_CONFIG`, `MAX_ALLOWED_MINTS` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::TooManyAllowedMints` |
| `tests/helpers.ts` | root `before` that calls `initConfig` once; exports `configPDA`, `logisticsWallet`, `allowedMints`, `fails` |
| `tests/init_config.ts` | the three behaviour tests |
| `target/idl/farmer_core.json` | generated IDL the TS client resolves accounts from |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProgramConfig::INIT_SPACE,
        seeds = [SEED_CONFIG],
        bump
    )]
    pub config: Account<'info, ProgramConfig>,

    /// The admin authority that will control the program
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `config` | `Account<ProgramConfig>` | `init`, `payer = admin`, `space = 8 + INIT_SPACE`, `seeds = [SEED_CONFIG]`, `bump` | auto from IDL (const seed) |
| `admin` | `Signer` | `mut` (pays rent) | auto: provider wallet. `.accountsPartial({ admin })` plus `.signers([kp])` to override |
| `system_program` | `Program<System>` | none | auto from IDL |

## Arguments

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `logistics_wallet` | `Pubkey` | `PublicKey` | none | none |
| `paused` | `bool` | `boolean` | none | none |
| `allowed_mints` | `Vec<Pubkey>` | `PublicKey[]` | `len() <= MAX_ALLOWED_MINTS` (30) | `TooManyAllowedMints` (6000) |

## Account layout

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

Seeds: `[SEED_CONFIG]`, `SEED_CONFIG = b"config"`. Size: `8 + INIT_SPACE = 8 + 32 + 32 + 1 + (4 + 30 * 32) = 1037 bytes`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `TooManyAllowedMints` | 6000 | `allowed_mints.len() > 30`, handler `require!` |
| `already in use` | System Program (during `init`) | `config` PDA already exists: any call after the first |
| `Signature verification failed` | runtime | `admin` overridden via `accountsPartial` did not sign |

`UnauthorizedAdmin` (6002), `ProgramPaused` (6001) and `MintNotAllowed` (6003) sit in the same Config section of `FarmerCoreError` but are not raised here: `init_config` has no admin precondition and no pause gate.

## Client call

Singleton created once in the root `before` of `tests/helpers.ts`; no accounts passed, all resolved from the IDL:

```ts
export const configPDA = pda(Buffer.from("config"));
export const logisticsWallet = Keypair.generate().publicKey;
export const allowedMints = [Keypair.generate().publicKey];

before(async () => {
  if (await provider.connection.getAccountInfo(configPDA)) return;
  await program.methods.initConfig(logisticsWallet, false, allowedMints).rpc();
});
```

Overriding the signer to provoke the signature failure (`tests/init_config.ts`):

```ts
const err = await fails(
  program.methods
    .initConfig(logisticsWallet, false, [])
    .accountsPartial({ admin: Keypair.generate().publicKey })
    .rpc()
);
expect(err).to.match(/signature/i);
```

## Implementation notes

- Order of checks: (1) runtime signature check on `admin`; (2) Anchor constraints: `config` created by System Program CPI with `admin` as payer, "already in use" if the PDA exists; (3) handler `require!` on `allowed_mints.len()`; (4) field writes; (5) `msg!` logs.
- No `Option` args. "No allowlist" is the empty vector; the README's `allowed_mints?` maps to `[]`, not `null`.
- Not idempotent: a second call fails at `init`. The test helper guards with `getAccountInfo(configPDA)` so a re-run against a live validator skips the call instead of failing.
- `TooManyAllowedMints` is unreachable from a client (31 * 32 B of mints plus message overhead exceeds the 1232 B transaction limit), so `tests/init_config.ts` has no test for it (`AGENTS.md` Testing Guidelines: skip inputs that cannot reach the program).
