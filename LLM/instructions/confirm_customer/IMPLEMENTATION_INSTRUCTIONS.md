# confirm_customer: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/confirm_customer.rs` | `ConfirmCustomer` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `confirm_customer(ctx, notes_hash)` |
| `programs/farmer-core/src/states.rs` | `WarehouseCustomer`, `WarehouseCustomerStatus`, `Warehouse`, seeds |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, AlreadyConfirmed, UnauthorizedOperator}` |
| `programs/farmer-core/src/events.rs` | `CustomerConfirmed` |
| `tests/confirm_customer.ts` | Happy path with event, null hash, three named errors, re-admission |
| `tests/helpers.ts` | `fund`, `createWarehouse`, `registerCustomer`, `requestConfirmation` (returns `wcustomerPDA(warehouse, customer)`), `fails`, `events` |
| `target/idl/farmer_core.json` | Generated IDL (accounts, discriminator, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct ConfirmCustomer<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = warehouse_customer.status != WarehouseCustomerStatus::Confirmed @ FarmerCoreError::AlreadyConfirmed
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `warehouse_customer` | `Account<WarehouseCustomer>` | `mut`; `has_one = warehouse` else `WarehouseMismatch`; `status != Confirmed` else `AlreadyConfirmed` | must pass (`wcustomerPDA(warehouse, customer)`; no `seeds` here and the customer key is not an account) |
| `warehouse` | `Account<Warehouse>` | `has_one = operator` else `UnauthorizedOperator` | must pass (`warehousePDA(id)`) |
| `operator` | `Signer` | must sign | must pass + `.signers([operator])` (non-wallet signer) |

## Arguments

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `notes_hash` | `Option<[u8; 32]>` | `number[] \| null` | none in the handler; length is fixed at 32 by the Borsh layout (`option<array<u8,32>>` in the IDL) | n/a |

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
size 8 + INIT_SPACE = 115 bytes (32 + 32 + 1 + (1 + 8) + (1 + 32) = 107). Created by `request_customer_confirmation`.
The TS client decodes `status` as `{ pending: {} }` / `{ confirmed: {} }` / `{ revoked: {} }`, `confirmedAt` as `BN | null`, `notesHash` as `number[] | null`.

Read: `Warehouse` (seeds `[SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()]`, 8 + INIT_SPACE = 1367 bytes); used for `operator` (`has_one`) and for its key (`has_one = warehouse` on `warehouse_customer`).

## Errors

| Error | Code | Raised when |
|---|---|---|
| `WarehouseMismatch` | 6011 | `warehouse_customer.warehouse != warehouse.key()` (test: "rejects a relation that belongs to another warehouse") |
| `AlreadyConfirmed` | 6013 | `warehouse_customer.status == Confirmed` (test: "rejects an already confirmed customer") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator.key()` (test: "rejects a signer that is not the warehouse operator") |
| `AccountNotInitialized` (Anchor) | 3012 | `warehouse_customer` or `warehouse` address has no data; not exercised in this test file |
| "Signature verification failed" (runtime) | n/a | `operator` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

## Events

```rust
#[event]
pub struct CustomerConfirmed {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
}
```

Emitted after the three writes, with `wc.warehouse` / `wc.customer` from the account. The test reads it with `events(confirm(wc, notes))`
(`tests/helpers.ts`: rpc at commitment `confirmed`, logs decoded by `anchor.EventParser`) and asserts `name === "customerConfirmed"` (camelCase) and `data.warehouse.equals(warehouse)`.

## Client call

From `tests/confirm_customer.ts`:

```typescript
const confirm = (wc: anchor.web3.PublicKey, notes: number[] | null = null, signer = operator, wh = warehouse) =>
  program.methods
    .confirmCustomer(notes)
    .accountsPartial({ warehouseCustomer: wc, warehouse: wh, operator: signer.publicKey })
    .signers([signer]);
```

Fixtures (all from `tests/helpers.ts`): `operator = await fund()`, `warehouse = await createWarehouse(operator.publicKey)`, `wc = await requestConfirmation(warehouse, await registerCustomer())`.

## Implementation notes

- Order of checks: accounts deserialize in field order (`warehouse_customer`, `warehouse`, `operator`), then
  constraints run in field order. Within `warehouse_customer`, `has_one` is generated before `constraint`, so
  `WarehouseMismatch` precedes `AlreadyConfirmed`; `UnauthorizedOperator` (on `warehouse`) runs last. The tests
  trigger each error in isolation, so they do not pin this order.
- The handler has no `require!`. `Clock::get()?` is its only fallible call.
- The IDL marks `warehouse` with `relations: ["warehouse_customer"]` and `operator` with `relations: ["warehouse"]`
  (from the two `has_one`); the test still passes all three accounts explicitly and `operator` in `.signers`.
