# revoke_customer: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/revoke_customer.rs` | `RevokeCustomer` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `revoke_customer(ctx)` |
| `programs/farmer-core/src/states.rs` | `WarehouseCustomer`, `WarehouseCustomerStatus`, `Warehouse`, seeds |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{UnauthorizedOperator, WarehouseMismatch, AlreadyRevoked}` |
| `programs/farmer-core/src/events.rs` | `CustomerRevoked` |
| `tests/revoke_customer.ts` | Happy paths (from Confirmed and from Pending), event, all three named errors |
| `tests/helpers.ts` | `fund`, `createWarehouse`, `registerCustomer`, `requestConfirmation`, `wcustomerPDA`, `fails`, `events` |
| `target/idl/farmer_core.json` | Generated IDL (accounts, discriminator, error codes, events) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct RevokeCustomer<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = warehouse_customer.status != WarehouseCustomerStatus::Revoked @ FarmerCoreError::AlreadyRevoked
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `warehouse_customer` | `Account<WarehouseCustomer>` | `mut`; `has_one = warehouse` else `WarehouseMismatch`; `status != Revoked` else `AlreadyRevoked` | must pass (`wcustomerPDA(warehouse, customer)`; no seeds constraint here, the customer key is not an account) |
| `warehouse` | `Account<Warehouse>` | `has_one = operator` else `UnauthorizedOperator` | must pass (`warehousePDA(id)`) |
| `operator` | `Signer` | must sign | must pass + `.signers([operator])` (non-wallet signer) |

No `system_program`, no `ProgramConfig`, no PDA seeds verified on this instruction. IDL `relations`:
`warehouse` -> `["warehouse_customer"]`, `operator` -> `["warehouse"]`; the test still passes all three.

## Arguments

None. `warehouse` and `customer` are read from `warehouse_customer`.

## Account layout

Mutated:

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum WarehouseCustomerStatus {
    Pending,
    Confirmed,
    Revoked,
}

#[account]
#[derive(InitSpace)]
pub struct WarehouseCustomer {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
    pub status: WarehouseCustomerStatus,
    pub confirmed_at: Option<i64>,
    pub notes_hash: Option<[u8; 32]>, // hash of the off-chain record, never PII
}
```

Seeds `[SEED_WCUSTOMER, warehouse.key().as_ref(), customer.key().as_ref()]` (`SEED_WCUSTOMER = b"wcustomer"`);
size 8 + INIT_SPACE = 115 bytes (32 + 32 + 1 + (1 + 8) + (1 + 32) = 107); created by `request_customer_confirmation`.
TS decodes `status` as `{ pending: {} }` / `{ confirmed: {} }` / `{ revoked: {} }`. Read: `Warehouse`, seeds
`[SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()]`, 1367 bytes (struct in `LLM/instructions/set_farmer_warehouse/IMPLEMENTATION_INSTRUCTIONS.md`).

## Errors

| Error | Code | Raised when |
|---|---|---|
| `WarehouseMismatch` | 6011 | `warehouse_customer.warehouse != warehouse.key()` (test: "rejects a relation that belongs to another warehouse") |
| `AlreadyRevoked` | 6014 | `warehouse_customer.status == Revoked` (test: "rejects an already revoked customer") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator.key()` (test: "rejects a signer that is not the warehouse operator") |
| `AccountNotInitialized` (Anchor) | 3012 | `warehouse_customer` or `warehouse` address has no data; not exercised in this test file |
| "Signature verification failed" (runtime) | n/a | `operator` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

## Events

```rust
#[event]
pub struct CustomerRevoked {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
}
```

Emitted after the status write from `wc.warehouse` / `wc.customer`. The test decodes it with
`events(builder)` (`tests/helpers.ts`: `.rpc({ commitment: "confirmed" })`, then `anchor.EventParser` over
the tx logs) and asserts exactly one event named `"customerRevoked"` (camelCase) whose `data.warehouse` equals `warehouse`.

## Client call

From `tests/revoke_customer.ts`:

```typescript
const pending = async () => requestConfirmation(warehouse, await registerCustomer());
const revoke = (wc: anchor.web3.PublicKey, signer = operator, wh = warehouse) =>
  program.methods
    .revokeCustomer()
    .accountsPartial({ warehouseCustomer: wc, warehouse: wh, operator: signer.publicKey })
    .signers([signer]);

const evs = await events(revoke(wc));
```

Fixtures in the `before` hook: `operator = await fund()`, `warehouse = await createWarehouse(operator.publicKey)`
(helpers from `tests/helpers.ts`). `revoke` returns the builder (no `.rpc()`) so it feeds both `events()` and `.rpc()`.

## Implementation notes

- Order of checks: accounts deserialize in field order (`warehouse_customer`, `warehouse`, `operator`),
  then constraints in field order: `WarehouseMismatch`, `AlreadyRevoked` (Anchor emits `has_one`
  before `constraint`), then `UnauthorizedOperator`. The handler body has no `require!`.
- `confirmed_at` and `notes_hash` (both `Option`) are left as stored: after revoking a confirmed customer
  `confirmed_at` is `Some` and `notes_hash` is whatever `confirm_customer` received (`None` in the test,
  which passes `confirmCustomer(null)`); both `None` after revoking a pending one. No `Clock` read, no rent, fee only.
