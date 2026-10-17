# refuse_delivery: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/refuse_delivery.rs` | `RefuseDelivery` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `withdraw(token_program, escrow, mint, to, order, bump, amount)`: `transfer_checked` signed with the escrow seeds |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `FulfillmentMode`, `LotOffer`, `Warehouse`, `SEED_ESCROW` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, OfferMismatch, MintMismatch, NotDeliveryOrder, InvalidOrderStatus, UnauthorizedOperator, UnauthorizedCustomer, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `OrderRefused` |
| `tests/refuse_delivery.ts` | Refund from each of the three statuses (balances, stock, status, event), pickup order, wrong signer, foreign destination, already refused |
| `tests/helpers.ts` | `market`, `createOrder`, `fund`, `fundTokens`, `tokenBalance`, `escrowPDA`, `testMint`, `fails`, `events` |
| `target/idl/farmer_core.json` | Generated IDL (escrow PDA seeds, discriminator, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct RefuseDelivery<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.fulfillment_mode == FulfillmentMode::Delivery @ FarmerCoreError::NotDeliveryOrder,
        constraint = matches!(
            order.status,
            OrderStatus::PendingDeliveryQuote | OrderStatus::DeliveryQuoted | OrderStatus::EscrowedReady
        ) @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    #[account(mut)]
    pub offer: Account<'info, LotOffer>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Any token account of the order's customer for this mint; the operator picks it, the owner check keeps the money with the customer.
    #[account(
        mut,
        token::mint = mint,
        constraint = customer_token_account.owner == order.customer @ FarmerCoreError::UnauthorizedCustomer
    )]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
```

Client resolution: `escrow` comes from the IDL (seeds from `order`); every other account must be passed: `order` (no seeds in the
struct), `warehouse`, `offer`, `mint` (`testMint()`), `customer_token_account` (`m.buyer.ata` in tests), `token_program`
(`TOKEN_PROGRAM_ID` in tests; SPL Token or Token-2022), and `operator` via `.accountsPartial({ operator })` + `.signers([operator])`.

## Arguments

None: `refuse_delivery(ctx: Context<RefuseDelivery>)`. The amount is `escrow.amount`, the quantity `order.qty`.

## Account layout

Written fields only (`programs/farmer-core/src/states.rs`): `Order.status: OrderStatus` -> `Refused` (TS `{ refused: {} }`); `qty`,
`customer`, `escrow_bump`, `fulfillment_mode` and the three `has_one` keys are read. `LotOffer` (seeds `["offer", farmer, offer_id u64 LE]`,
8 + INIT_SPACE = 895 bytes): `qty_remaining: u64` += `order.qty` (TS `BN`). Escrow (`SEED_ESCROW = b"escrow"`): balance to 0, kept open.
Sizes and seeds of `Order` and the escrow: HOW_IT_WORKS.md "Data model".

## Errors

| Error | Code | Raised when |
|---|---|---|
| `NotDeliveryOrder` | 6029 | `order.fulfillment_mode != Delivery` (test: "rejects a pickup order") |
| `InvalidOrderStatus` | 6028 | status not in `{PendingDeliveryQuote, DeliveryQuoted, EscrowedReady}` (test: "rejects an order that is already refused") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator` (test: "rejects a signer that is not the warehouse operator") |
| `UnauthorizedCustomer` | 6027 | `customer_token_account.owner != order.customer` (test: "rejects a refund destination not owned by the customer", stranger ATA of the same mint from `fundTokens(await fund(), 0)`) |
| `WarehouseMismatch` / `OfferMismatch` / `MintMismatch` | 6011 / 6026 / 6025 | `order.warehouse`, `order.offer` or `order.mint` differs from the account passed; not exercised |
| `MathOverflow` | 6024 | `qty_remaining + order.qty` overflows `u64`; not exercised (unreachable after the `checked_sub` of the same `qty` at `create_order`) |
| `ConstraintSeeds` / `AccountNotInitialized` (Anchor) | 2006 / 3012 | `escrow` not at `["escrow", order]` with `order.escrow_bump` (the client derives it from the IDL) / one of the six data accounts has no data; not exercised |
| "Signature verification failed" (web3.js) | n/a | `operator` in `accountsPartial` but missing from `.signers`; the tx is never sent; not exercised |

## Events

```rust
#[event]
pub struct OrderRefused {
    pub order: Pubkey,
}
```

Emitted after the status write. The test reads it with `events(refuse(order))` (`tests/helpers.ts`: rpc at commitment `confirmed`, logs
decoded by `anchor.EventParser`) and asserts the only event is `orderRefused` (camelCase) with `data.order` equal to the order PDA.

## Client call

```typescript
const refuse = (order: anchor.PublicKey, signer = m.operator, destination = m.buyer.ata) =>
  program.methods
    .refuseDelivery()
    .accountsPartial({
      order,
      warehouse: m.warehouse,
      offer: m.offer,
      mint: testMint(),
      customerTokenAccount: destination,
      operator: signer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([signer]);
```

From `tests/refuse_delivery.ts`; `m = await market()` (operator, warehouse `fee_bps` 250, approved farmer, offer qty 500 at 1_000_000,
customer with 100_000_000), `delivery()` = `createOrder(m.buyer, m.offer, m.warehouse, "delivery")` (qty 10, subtotal 10_000_000);
`quote(order)` sets a 500_000 fee and `accept(order)` escrows it for the `EscrowedReady` case.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): the eight accounts deserialize in field order, then constraints run in field
  order: `order` (`has_one` warehouse, offer, mint, then the raw constraints mode, status), `warehouse` (`has_one = operator`),
  `customer_token_account` (raw owner constraint, then `token::mint`: Anchor runs raw constraints before `token::` checks), `escrow`
  (seeds + bump). Mode is declared before status on purpose: a pickup order is in `EscrowedPickup`, which also fails the status set,
  and the test expects `NotDeliveryOrder`.
- Handler: `escrow::withdraw` CPI with `ctx.accounts.escrow.amount` as deserialized at entry (never recomputed from `Order`), then
  `offer.qty_remaining = checked_add(order.qty)`, then `order.status = Refused`, then `emit!`. A failed CPI aborts before any write.
- CPI: `token_interface::transfer_checked` via `CpiContext::new_with_signer`, `from` and `authority` both the escrow, signer seeds
  `[SEED_ESCROW, order.key(), [order.escrow_bump]]`, `decimals = mint.decimals`; hence `mint` is an account pinned by `has_one`.
- The destination must already exist (no ATA creation); a customer-owned account of another mint passes the owner constraint and
  fails Anchor's `token::mint` check (`ConstraintTokenMint`, 2014). `InvalidOrderStatus` from `Canceled` is untested (`InTransit` /
  `Fulfilled` arrive in M5).
