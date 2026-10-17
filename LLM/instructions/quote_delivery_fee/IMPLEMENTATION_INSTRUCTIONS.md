# quote_delivery_fee: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/quote_delivery_fee.rs` | `QuoteDeliveryFee` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `quote_delivery_fee(ctx, delivery_fee_minor)` |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `Warehouse`, `EXPIRY_QUOTED_SECS` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, InvalidOrderStatus, UnauthorizedOperator, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `DeliveryFeeQuoted` |
| `tests/quote_delivery_fee.ts` | Happy path with event and stored fields, wrong signer, wrong warehouse, pickup order, already quoted |
| `tests/helpers.ts` | `market`, `createOrder`, `createWarehouse`, `fund`, `fails`, `events`, `BN`, `H6` |
| `tests/flow_order.ts` | Quote step of the end-to-end delivery flow (create -> quote -> accept) |
| `target/idl/farmer_core.json` | Generated IDL (accounts with `relations`, discriminator, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct QuoteDeliveryFee<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = order.status == OrderStatus::PendingDeliveryQuote @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `order` | `Account<Order>` | `mut`, `has_one = warehouse @ WarehouseMismatch`, `constraint = order.status == OrderStatus::PendingDeliveryQuote @ InvalidOrderStatus` | must pass via `.accountsPartial({ order })` (seeds need offer, customer and `order_id`, none of them in this instruction) |
| `warehouse` | `Account<Warehouse>` | `has_one = operator @ UnauthorizedOperator` | passed explicitly in both tests; the IDL marks it `relations: ["order"]` |
| `operator` | `Signer` | none (not `mut`) | must pass via `.accountsPartial({ operator })` + `.signers([operator])` (non-wallet signer) |

## Arguments

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `delivery_fee_minor` | `u64` | `BN` | none: zero accepted, no upper bound, stored as given | n/a |

## Account layout

`Order` fields written by this instruction (non-adjacent lines of `states.rs`):

```rust
    pub delivery_fee_minor: u64, // 0 until quoted
    pub status: OrderStatus,
    pub expires_at: i64,
```

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    EscrowedPickup,
    PendingDeliveryQuote,
    DeliveryQuoted,
    EscrowedReady,
    InTransit,
    Fulfilled,
    Refused,
    Canceled,
    Expired,
}
```

`Order` seeds `["order", offer_pubkey, customer_pubkey, order_id u64 LE]` (`SEED_ORDER = b"order"`), size 8 + INIT_SPACE = 227 bytes
(8 + 32 * 5 + 8 * 4 + 1 + 1 + 8 + 8 + 1 = 219). Not re-derived here: the account is passed by key and validated by owner, discriminator and
`has_one`. The TS client decodes `deliveryFeeMinor` and `expiresAt` as `BN`, `status` as `{ deliveryQuoted: {} }`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `WarehouseMismatch` | 6011 | `order.warehouse != warehouse.key()` (test: "rejects a warehouse that is not the order's") |
| `InvalidOrderStatus` | 6028 | `order.status != PendingDeliveryQuote`: a pickup order (`EscrowedPickup`) or a second quote (tests: "rejects a pickup order", "rejects an order that is already quoted") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator.key()` (test: "rejects a signer that is not the warehouse operator") |
| `MathOverflow` | 6024 | `now.checked_add(EXPIRY_QUOTED_SECS)` overflows `i64`; unreachable with a real clock, not tested |
| `AccountNotInitialized` (Anchor) | 3012 | `order` or `warehouse` has no data; not exercised in this test file |
| "Signature verification failed" (runtime) | n/a | `operator` passed in `accountsPartial` but missing from `.signers`; not exercised in this test file |

## Events

```rust
#[event]
pub struct DeliveryFeeQuoted {
    pub order: Pubkey,
    pub delivery_fee_minor: u64,
}
```

Emitted after the three writes; `order` is the account key, `delivery_fee_minor` the arg. The test reads it with `events(quote(order))`
(`tests/helpers.ts`: rpc at commitment `confirmed`, logs decoded by `anchor.EventParser`) and asserts the only event is `deliveryFeeQuoted`
(camelCase) with `data.order` (`PublicKey`) equal to the order and `data.deliveryFeeMinor` (`BN`) equal to 500 000.

## Client call

```typescript
  const delivery = () => createOrder(m.buyer, m.offer, m.warehouse, "delivery");
  const quote = (order: anchor.PublicKey, fee = 500_000, signer = m.operator, warehouse = m.warehouse) =>
    program.methods
      .quoteDeliveryFee(new BN(fee))
      .accountsPartial({ order, warehouse, operator: signer.publicKey })
      .signers([signer]);
```

From `tests/quote_delivery_fee.ts`; `m = await market()` builds operator, warehouse (`fee_bps` 250), approved farmer, offer (qty 500,
price 1 000 000) and a confirmed customer with 100 000 000 minor units; `createOrder` defaults to qty 10 and a fresh `order_id`.
`tests/flow_order.ts` issues the same call with `FEE = 750_000` and asserts `status` is `{ deliveryQuoted: {} }` before `accept_delivery_fee`.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`): no `init` accounts; `order`, `warehouse`, `operator` deserialize in field order (owner +
  discriminator, missing data -> 3012, signer flag), then constraints in field order: `order` `has_one` (`WarehouseMismatch`) then status
  (`InvalidOrderStatus`), then `warehouse` `has_one` (`UnauthorizedOperator`). The tests trigger each error in isolation (the wrong-warehouse
  test uses a second warehouse of the same operator, so `has_one = operator` still passes), so they do not pin this order.
- Handler: `now` read once from `Clock::get()?`, three writes, `checked_add` on the expiry only (a new 6 h window from the quote time
  overwrites the pending-quote window; neither is checked); no `require!`, no arithmetic on the fee. The test asserts `expiresAt` within
  60 s of `now + H6`.
- No token CPI: `escrow.rs` is not touched; `tests/flow_order.ts` asserts escrow == `SUBTOTAL` after create, `SUBTOTAL + FEE` only after accept.
- `delivery_fee_minor` is set at quote time: `states.rs` comments it "0 until quoted"; README 5.8 says "0 until accepted", which holds for
  the escrow balance, not for the field.
