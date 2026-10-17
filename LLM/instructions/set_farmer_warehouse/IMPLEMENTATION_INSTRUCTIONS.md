# set_farmer_warehouse: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/set_farmer_warehouse.rs` | `SetFarmerWarehouse` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `set_farmer_warehouse(ctx)` |
| `programs/farmer-core/src/states.rs` | `FarmerProfile`, `Warehouse`, seeds, size constants |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{UnauthorizedOperator, WarehouseMismatch}` |
| `tests/set_farmer_warehouse.ts` | Happy path, idempotency, both named errors |
| `tests/helpers.ts` | `fund`, `createWarehouse`, `registerFarmer`, `fails`, PDA derivers |
| `target/idl/farmer_core.json` | Generated IDL (accounts, discriminator, error codes) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct SetFarmerWarehouse<'info> {
    #[account(
        mut,
        constraint = farmer_profile.warehouse == warehouse.key() @ FarmerCoreError::WarehouseMismatch
    )]
    pub farmer_profile: Account<'info, FarmerProfile>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `farmer_profile` | `Account<FarmerProfile>` | `mut`; `farmer_profile.warehouse == warehouse.key()` else `WarehouseMismatch` | must pass (`farmerPDA(farmer)`; seed is the farmer key, not an account here) |
| `warehouse` | `Account<Warehouse>` | `has_one = operator` else `UnauthorizedOperator` | must pass (`warehousePDA(id)`) |
| `operator` | `Signer` | must sign | must pass + `.signers([operator])` (non-wallet signer) |

No `system_program`, no `ProgramConfig`, no PDA seeds verified on this instruction.

## Arguments

None. The warehouse being approved is read from `farmer_profile.warehouse`.

## Account layout

Mutated:

```rust
#[account]
#[derive(InitSpace)]
pub struct FarmerProfile {
    pub authority: Pubkey,
    pub warehouse: Pubkey,
    pub warehouse_approved: bool,
    #[max_len(MAX_NAME_LEN)]
    pub display_name: String,
    #[max_len(MAX_URI_LEN)]
    pub public_profile_uri: String,
}
```

Seeds `[SEED_FARMER, farmer.key().as_ref()]` (`SEED_FARMER = b"farmer"`); size 8 + INIT_SPACE = 381 bytes
(32 + 32 + 1 + (4 + 100) + (4 + 200) = 373). Created by `register_farmer`.

Read:

```rust
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

Seeds `[SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()]` (`SEED_WAREHOUSE = b"warehouse"`); size 8 + INIT_SPACE = 1367 bytes.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `WarehouseMismatch` | 6011 | `farmer_profile.warehouse != warehouse.key()` (test: "rejects a warehouse the farmer did not request") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator.key()` (test: "rejects a signer that is not the warehouse operator") |
| `AccountNotInitialized` (Anchor) | 3012 | `farmer_profile` or `warehouse` address has no data; not exercised in this test file |
| "Signature verification failed" (runtime) | n/a | `operator` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

## Client call

From `tests/set_farmer_warehouse.ts`:

```typescript
const approve = (wh = warehouse, signer = operator) =>
  program.methods
    .setFarmerWarehouse()
    .accountsPartial({ farmerProfile: profile, warehouse: wh, operator: signer.publicKey })
    .signers([signer])
    .rpc();
const approved = async () => (await program.account.farmerProfile.fetch(profile)).warehouseApproved;
```

Fixtures: `operator = await fund()`, `warehouse = await createWarehouse(operator.publicKey)`,
`({ profile } = await registerFarmer(warehouse))` (all in `tests/helpers.ts`).

## Implementation notes

- Order of checks: Anchor deserializes accounts in field order (`farmer_profile`, `warehouse`,
  `operator`), then evaluates constraints in field order: `WarehouseMismatch` before
  `UnauthorizedOperator`. The handler body has no `require!`.
- Idempotent: the handler unconditionally sets `warehouse_approved = true`; a second call
  succeeds and leaves the account unchanged.
- The IDL marks `operator` with `relations: ["warehouse"]` (from `has_one`); the test passes all
  three accounts explicitly and `operator` in `.signers`.
