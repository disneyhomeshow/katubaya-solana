# create_warehouse: technical reference

## File map

| file | role |
|---|---|
| `programs/farmer-core/src/instructions/create_warehouse.rs` | `CreateWarehouse` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod create_warehouse; pub use create_warehouse::*;` |
| `programs/farmer-core/src/lib.rs` | `#[program]` entry point `create_warehouse`, forwards to the handler; imports `states::ZipPrefix` for the arg type |
| `programs/farmer-core/src/states.rs` | `Warehouse`, `ZipPrefix`, `SEED_WAREHOUSE`, `SEED_CONFIG`, `MAX_*` constants |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError` (single enum) |
| `tests/create_warehouse.ts` | one `it` per behaviour (happy path, admin gate, each bound, duplicate id) |
| `tests/helpers.ts` | `program`, `warehousePDA(id)`, `freshId()`, `fund()`, `fails()`; fixture `createWarehouse(operator, id = freshId())`: same call with fixed values and `null` uri, no accounts passed, returns `warehousePDA(id)` |

## Accounts struct

```rust
/// Admin creates a `Warehouse` PDA keyed by an explicit `warehouse_id`.
#[derive(Accounts)]
#[instruction(warehouse_id: u64)]
pub struct CreateWarehouse<'info> {
    #[account(seeds = [SEED_CONFIG], bump, has_one = admin @ FarmerCoreError::UnauthorizedAdmin)]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        init,
        payer = admin,
        space = 8 + Warehouse::INIT_SPACE,
        seeds = [SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()],
        bump
    )]
    pub warehouse: Account<'info, Warehouse>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

Client: nothing is passed in the happy path. `config`, `warehouse` (from the `warehouse_id` arg) and `system_program` resolve from the IDL (`target/idl/farmer_core.json`); `admin` defaults to the provider wallet, `.accountsPartial({ admin: kp.publicKey }).signers([kp])` to override.

## Arguments

| arg | Rust type | TS client type | validation | error |
|---|---|---|---|---|
| `warehouse_id` | `u64` | `BN` | none; seed only, a reused id fails at `init` (the suite uses `freshId()`: `Date.now() % 1_000_000`, incremented) | "already in use" |
| `operator` | `Pubkey` | `PublicKey` | none; need not sign, exist or be funded | — |
| `name` | `String` | `string` | `len() <= MAX_NAME_LEN` (100 bytes) | `NameTooLong` (6004) |
| `pickup_notes` | `String` | `string` | `len() <= MAX_NOTES_LEN` (500 bytes) | `NotesTooLong` (6005) |
| `fee_bps` | `u16` | `number` | `<= MAX_FEE_BPS` (10000) | `FeeBpsTooHigh` (6009) |
| `deliver_zip_prefixes` | `Vec<ZipPrefix>` | `{ prefix: number; len: number }[]` | `len() <= MAX_ZIP_PREFIXES` (100); every `len` in `3..=5` | `TooManyZipPrefixes` (6007), `InvalidZipPrefixLen` (6008) |
| `delivery_fee_rules_uri` | `Option<String>` | `string \| null` | if `Some`, `len() <= MAX_URI_LEN` (200 bytes); `None` is written unchanged | `UriTooLong` (6006) |

## Account layout

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ZipPrefix {
    pub prefix: u32,
    pub len: u8, // 3, 4 or 5 digits
}

#[account]
#[derive(InitSpace)]
pub struct Warehouse {
    pub warehouse_id: u64,
    pub operator: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_NOTES_LEN)]
    pub pickup_notes: String,
    pub fee_bps: u16,
    #[max_len(MAX_URI_LEN)]
    pub delivery_fee_rules_uri: Option<String>,
    #[max_len(MAX_ZIP_PREFIXES)]
    pub deliver_zip_prefixes: Vec<ZipPrefix>,
}
```

Seeds: `[SEED_WAREHOUSE, warehouse_id.to_le_bytes()]`, `SEED_WAREHOUSE = b"warehouse"`. Size: `8 + INIT_SPACE = 8 + (8 + 32 + (4 + 100) + (4 + 500) + 2 + (1 + 4 + 200) + (4 + 100 * 5)) = 1367 bytes`. Derivation in `tests/helpers.ts` (`configPDA` is the read-only `ProgramConfig`):

```ts
const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const u64 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 8);

export const configPDA = pda(Buffer.from("config"));
export const warehousePDA = (id: number) => pda(Buffer.from("warehouse"), u64(id));
```

## Errors

Arg-bound errors (6004–6009) are in the Arguments table. The rest:

| error | code | raised when |
|---|---|---|
| `UnauthorizedAdmin` | 6002 | `admin` signer != `config.admin` (`has_one`) |
| "already in use" (System program, during `init`) | — | `warehouse_id` already has an account |
| `AccountNotInitialized` (Anchor) | 3012 | `config` PDA does not exist (`init_config` never ran); unreachable in the suite, the root `before` in `tests/helpers.ts` creates it |
| "Signature verification failed" (runtime) | — | `admin` overridden with a pubkey that is not in `.signers()` |

## Client call

From `tests/create_warehouse.ts`:

```ts
const create = (id: number, o: Partial<ReturnType<typeof valid>> = {}, signer?: anchor.web3.Keypair) => {
  const a = { ...valid(), ...o };
  const m = program.methods.createWarehouse(new BN(id), a.operator, a.name, a.notes, a.feeBps, a.prefixes, a.uri);
  return (signer ? m.accountsPartial({ admin: signer.publicKey }).signers([signer]) : m).rpc();
};
```

Fetch: `program.account.warehouse.fetch(warehousePDA(id))`; `warehouseId` comes back as `BN`, `deliveryFeeRulesUri` as `string | null`.

## Implementation notes

- Order of checks: (1) deserialize `config` (`AccountNotInitialized` if missing), `admin`, `system_program`; (2) `init` of `warehouse` (System `create_account`, rent paid by whoever signed as `admin`); (3) `config` seeds/bump and `has_one = admin`; (4) handler `require!` chain: name, notes, fee_bps, prefix count, prefix len, uri; (5) field writes. No `msg!`, no event, no `paused` check.
- String bounds are byte lengths (`String::len`), the same unit `InitSpace` uses for `#[max_len]`, so a value that passes `require!` always fits the allocated `space`.
