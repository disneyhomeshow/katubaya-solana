# request_customer_confirmation: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/request_customer_confirmation.rs` | `RequestCustomerConfirmation` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `request_customer_confirmation(ctx)`; declares `pub mod events` |
| `programs/farmer-core/src/states.rs` | `WarehouseCustomer`, `WarehouseCustomerStatus`, `SEED_WCUSTOMER`, `SEED_CUSTOMER` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError` Customer section (no variant raised by this instruction) |
| `programs/farmer-core/src/events.rs` | `CustomerConfirmationRequested` |
| `tests/request_customer_confirmation.ts` | Happy path + event, missing profile, missing warehouse, duplicate pair |
| `tests/helpers.ts` | `fund`, `createWarehouse`, `registerCustomer`, `requestConfirmation`, `wcustomerPDA`, `fails`, `events` |

## Accounts struct

```rust
/// Registered customer asks `warehouse` to confirm them; creates the `WarehouseCustomer` PDA as `Pending`.
#[derive(Accounts)]
pub struct RequestCustomerConfirmation<'info> {
    #[account(
        init,
        payer = customer,
        space = 8 + WarehouseCustomer::INIT_SPACE,
        seeds = [SEED_WCUSTOMER, warehouse.key().as_ref(), customer.key().as_ref()],
        bump
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    pub warehouse: Account<'info, Warehouse>,

    #[account(seeds = [SEED_CUSTOMER, customer.key().as_ref()], bump)]
    pub customer_profile: Account<'info, CustomerProfile>,

    #[account(mut)]
    pub customer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `warehouse_customer` | `Account<WarehouseCustomer>` | `init`, `payer = customer`, `space = 8 + WarehouseCustomer::INIT_SPACE`, `seeds = [SEED_WCUSTOMER, warehouse.key(), customer.key()]`, `bump` | auto from IDL (`pda` seeds reference `warehouse` and `customer`); `wcustomerPDA(warehouse, customer)` to fetch |
| `warehouse` | `Account<Warehouse>` | type check only (owner, discriminator) | must pass (`warehousePDA(id)`; seed is `warehouse_id`, not an account here) |
| `customer_profile` | `Account<CustomerProfile>` | `seeds = [SEED_CUSTOMER, customer.key()]`, `bump` | auto from IDL |
| `customer` | `Signer` | `mut` (pays rent); must sign | must pass + `.signers([customer])` (non-wallet signer) |
| `system_program` | `Program<System>` | address `11111111111111111111111111111111` | auto from IDL |

No `ProgramConfig`, no `has_one`, no pause gate.

## Arguments

None. The warehouse is an account (its key is a seed of `warehouse_customer`); the customer is the signer.

## Account layout

```rust
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

Seeds `[SEED_WCUSTOMER (b"wcustomer"), warehouse, customer]`; size 8 + INIT_SPACE = 115 bytes
(32 + 32 + 1 + (1 + 8) + (1 + 32) = 107). `WarehouseCustomerStatus` is the unit enum `Pending | Confirmed | Revoked`
(1 byte); the TS client decodes it as `{ pending: {} }` / `{ confirmed: {} }` / `{ revoked: {} }`, and `Option::None` as `null`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `AccountNotInitialized` (Anchor) | 3012 | `customer_profile` has no data, i.e. the signer never called `register_customer` (test "rejects a customer without a profile"); or `warehouse` has no data (test "rejects a warehouse that does not exist") |
| "already in use" (system program) | n/a (raw string) | `init` on a `WarehouseCustomer` PDA that already exists for this pair (test "rejects a second request for the same pair") |
| "Signature verification failed" (runtime) | n/a (raw string) | `customer` passed in `accountsPartial` but missing from `.signers`; not exercised |
| `ConstraintSeeds` (Anchor) | 2006 | a `customer_profile` address that is not the signer's PDA; unreachable with IDL resolution, not exercised |

No `FarmerCoreError` variant is raised; `CustomerNotFound` (6012) stays defined for upcoming use, `AlreadyConfirmed`
(6013) / `AlreadyRevoked` (6014) belong to `confirm_customer` / `revoke_customer`. `fails()` returns the Anchor
error code when present, else `String(e)`, hence `.to.include("already in use")` for the duplicate case.

## Events

```rust
#[event]
pub struct CustomerConfirmationRequested {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
}
```

Emitted once, after the field writes. `events(builder)` (`tests/helpers.ts`) sends with `commitment: "confirmed"` and
runs `anchor.EventParser` over the tx `logMessages`; the test asserts `["customerConfirmationRequested"]` (camelCase)
and that `data.warehouse` / `data.customer` equal the inputs.

## Client call

From `tests/request_customer_confirmation.ts`:

```typescript
const request = (customer: anchor.web3.Keypair, wh = warehouse) =>
  program.methods
    .requestCustomerConfirmation()
    .accountsPartial({ customer: customer.publicKey, warehouse: wh })
    .signers([customer]);

const evs = await events(request(customer));
const wc = await program.account.warehouseCustomer.fetch(wcustomerPDA(warehouse, customer.publicKey));
```

Fixtures: `warehouse = await createWarehouse(Keypair.generate().publicKey)`, `customer = await registerCustomer()`
(funds the keypair, then registers). `tests/confirm_customer.ts` and `tests/revoke_customer.ts` use
`requestConfirmation(warehouse, customer)` from `tests/helpers.ts`: same call, returns the `WarehouseCustomer` address.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`): signature verification before the program runs; non-init
  accounts deserialized in field order (`warehouse`, `customer_profile`, `customer`, `system_program`), the
  source of `AccountNotInitialized`; then the `init` of `warehouse_customer` ("already in use" on a
  duplicate); then the remaining constraints in field order (`customer_profile` seeds). No `require!`, no `msg!`.
- All five fields are written explicitly, including `confirmed_at = None` and `notes_hash = None`; the test
  checks `confirmedAt === null` and `notesHash === null`.
- Rent is paid by `customer` (`#[account(mut)]`), which is why `registerCustomer()` starts with `fund()`.
- `warehouse` and `customer` are both seeds and stored fields, so `wc.warehouse == warehouse.key()` holds by
  construction for the `has_one = warehouse` check in `confirm_customer` / `revoke_customer`.
