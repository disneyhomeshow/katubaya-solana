# mark_in_transit: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/mark_in_transit.rs` | `MarkInTransit` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `mark_in_transit(ctx)` |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `FulfillmentMode`, `Warehouse` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, InvalidOrderStatus, UnauthorizedOperator}` |
| `programs/farmer-core/src/events.rs` | `OrderInTransit` |
| `tests/mark_in_transit.ts` | Pickup happy path with event, delivery happy path, pending delivery, quoted-not-accepted delivery, wrong signer, already in transit, refuse/reject blocked after transit |
| `tests/helpers.ts` | `market`, `createOrder`, `quoteFee`, `readyOrder`, `markInTransit`, `fund`, `fails`, `events`, `testMint` |
| `tests/flow_order.ts` | In-transit step of the end-to-end delivery flow (accept -> mark_in_transit -> complete_order) |
| `tests/complete_order.ts` | Calls `markInTransit` as the precondition of every completion except "rejects an order that is not in transit" |
| `target/idl/farmer_core.json` | Generated IDL (`warehouse` `relations: ["order"]`, `operator` `relations: ["warehouse"]`, discriminator, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct MarkInTransit<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = matches!(
            (order.fulfillment_mode, order.status),
            (FulfillmentMode::Pickup, OrderStatus::EscrowedPickup)
                | (FulfillmentMode::Delivery, OrderStatus::EscrowedReady)
        ) @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `order` | `Account<Order>` | `mut`, `has_one = warehouse @ WarehouseMismatch`, `constraint = matches!((order.fulfillment_mode, order.status), (Pickup, EscrowedPickup) \| (Delivery, EscrowedReady)) @ InvalidOrderStatus` | must pass via `.accountsPartial({ order })` (seeds need offer, customer and `order_id`, none of them in this instruction) |
| `warehouse` | `Account<Warehouse>` | `has_one = operator @ UnauthorizedOperator` | passed explicitly in every test; the IDL marks it `relations: ["order"]` |
| `operator` | `Signer` | none (not `mut`) | must pass via `.accountsPartial({ operator })` + `.signers([operator])` (non-wallet signer); IDL `relations: ["warehouse"]` |

## Arguments

None: `mark_in_transit(ctx: Context<MarkInTransit>)`.

## Account layout

`Order` fields this instruction touches (`programs/farmer-core/src/states.rs`; `warehouse` sits six fields above the other two):
`warehouse` and `fulfillment_mode` are read, `status` is read and written.

```rust
    pub warehouse: Pubkey,
    pub fulfillment_mode: FulfillmentMode,
    pub status: OrderStatus,
```

`FulfillmentMode { Pickup, Delivery }`; `OrderStatus { EscrowedPickup, PendingDeliveryQuote, DeliveryQuoted, EscrowedReady, InTransit,
Fulfilled, Refused, Canceled, Expired }` (both derive `Copy`, which lets the constraint build the `(mode, status)` tuple from the borrowed account).

`Order` seeds `["order", offer_pubkey, customer_pubkey, order_id u64 LE]` (`SEED_ORDER = b"order"`); Order: 8 + INIT_SPACE = 227 bytes.
The escrow token account (`SEED_ESCROW = b"escrow"`, seeds `["escrow", order]`, bump in `order.escrow_bump`) is not an account of this
instruction and `escrow_bump` is not read. The TS client decodes `status` as `{ inTransit: {} }`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `WarehouseMismatch` | 6011 | `order.warehouse != warehouse.key()`; not exercised in this test file |
| `InvalidOrderStatus` | 6028 | `(fulfillment_mode, status)` is neither `(Pickup, EscrowedPickup)` nor `(Delivery, EscrowedReady)` (tests: "rejects a delivery order still waiting for a quote", "rejects a delivery order whose quote was not accepted", "rejects an order already in transit") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator.key()` (test: "rejects a signer that is not the warehouse operator", a fresh `fund()` keypair) |
| `AccountNotInitialized` (Anchor) | 3012 | `order` or `warehouse` has no data; not exercised |
| "Signature verification failed" (web3.js) | n/a | `operator` in `accountsPartial` but missing from `.signers`; the tx is never sent; not exercised |

No framework error is exercised by `tests/mark_in_transit.ts`. The file also asserts `InvalidOrderStatus` from `refuse_delivery` and
`reject_delivery_fee` on an order this instruction moved to `InTransit`; those come from the status gates of the other two instructions.

## Events

```rust
#[event]
pub struct OrderInTransit {
    pub order: Pubkey,
}
```

Emitted after the status write; `order` is the account key. The test reads it with `events(transit(order))` (`tests/helpers.ts`: rpc at
commitment `confirmed`, logs decoded by `anchor.EventParser`) and asserts the only event is `orderInTransit` (camelCase) with
`data.order` (`PublicKey`) equal to the order PDA.

## Client call

```typescript
  const transit = (order: anchor.PublicKey, signer = m.operator) =>
    program.methods
      .markInTransit()
      .accountsPartial({ order, warehouse: m.warehouse, operator: signer.publicKey })
      .signers([signer]);
```

From `tests/mark_in_transit.ts`; `m = await market()` builds operator, warehouse (`fee_bps` 250), approved farmer, offer (qty 500,
price 1 000 000) and a confirmed customer with 100 000 000 minor units. Pickup orders come from `createOrder(m.buyer, m.offer,
m.warehouse, "pickup")`, delivery orders in `EscrowedReady` from `readyOrder(m)` (create -> `quoteFee` 500 000 -> `acceptFee`).
`tests/helpers.ts` exports the same call as `markInTransit(order, m)` (ends in `.rpc()`), used by `tests/complete_order.ts`;
`tests/flow_order.ts` issues it inline and asserts `status` is `{ inTransit: {} }` before `complete_order`.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): `order`, `warehouse`, `operator` deserialize in field order (owner +
  discriminator, missing data -> 3012, signer flag), then constraints in field order: `order` `has_one` (`WarehouseMismatch`) then the raw
  `matches!` constraint (`InvalidOrderStatus`), then `warehouse` `has_one` (`UnauthorizedOperator`). The wrong-signer test uses a fresh
  pickup order so the status gate passes and 6010 is reached; each error is triggered in isolation, so the tests do not pin this order.
- Handler: one write (`order.status = InTransit`), then `emit!`. No `Clock`, no checked arithmetic, no `require!`, no CPI; `escrow.rs` is
  not touched, the escrow balance and `offer.qty_remaining` are unchanged.
- The pair match ties each status to its mode. `create_order` chooses the entry status from the mode (`Pickup -> EscrowedPickup`,
  `Delivery -> PendingDeliveryQuote`), so the cross pairs never occur and no `NotDeliveryOrder` check is needed.
- Lock verified from the other side: "blocks refuse_delivery and reject_delivery_fee once in transit" marks a `readyOrder` and expects
  `InvalidOrderStatus` from both; `tests/complete_order.ts` "rejects an order that is not in transit" completes a `readyOrder` without
  this step and expects `InvalidOrderStatus`.
- Untested branches: `WarehouseMismatch` (a second warehouse), `AccountNotInitialized`, missing signature, and `InvalidOrderStatus` from
  the terminal states `Fulfilled` / `Refused` / `Canceled` / `Expired` (the last unreachable until M6's `expire_order`).
