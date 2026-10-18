# refuse_delivery: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/refuse_delivery.rs` | `RefuseDelivery` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `withdraw(token_program, escrow, mint, to, order, bump, amount)`: `transfer_checked` signed with the escrow seeds; `close(token_program, escrow, destination, order, bump)`: `close_account` with the same seeds |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `FulfillmentMode`, `LotOffer`, `Warehouse`, `SEED_ESCROW` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, OfferMismatch, MintMismatch, NotDeliveryOrder, InvalidOrderStatus, UnauthorizedOperator, UnauthorizedCustomer, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `OrderRefused` |
| `tests/refuse_delivery.ts` | Refund from each of the three statuses (balance, closed escrow, stock, status; rent and event on the pending case only), pickup order, wrong signer, foreign destination, replay |
| `tests/mark_in_transit.ts` | `InvalidOrderStatus` from the status constraint, with the escrow still alive |
| `tests/helpers.ts` | `market`, `createOrder`, `fund`, `fundTokens`, `tokenBalance`, `escrowPDA`, `escrowClosed`, `lamports`, `testMint`, `fails`, `events` |
| `target/idl/farmer_core.json` | Generated IDL (escrow PDA seeds, `relations`, discriminator, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct RefuseDelivery<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
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

    /// Escrow rent goes back to the customer, who paid it at `create_order`.
    #[account(mut)]
    pub customer: SystemAccount<'info>,

    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
```

Client resolution: `escrow` is a `pda` in the IDL (seeds from `order`); `warehouse`, `offer`, `mint` and `customer` carry
`relations: ["order"]` and `operator` `relations: ["warehouse"]`, so the TS client derives them from the fetched accounts. Only
`order` (no seeds in the struct), `customer_token_account` and `token_program` have to be passed, plus `operator` in `.signers`.
The tests pass the related accounts explicitly through `.accountsPartial`, to be able to build the wrong-signer case.

## Arguments

None: `refuse_delivery(ctx: Context<RefuseDelivery>)`. The amount is `escrow.amount`, the quantity `order.qty`.

## Account layout

Written fields only (`programs/farmer-core/src/states.rs`): `Order.status: OrderStatus` -> `Refused` (TS `{ refused: {} }`); `qty`,
`customer`, `escrow_bump`, `fulfillment_mode` and the four `has_one` keys are read. `LotOffer` (seeds `["offer", farmer, offer_id u64 LE]`,
8 + INIT_SPACE = 895 bytes): `qty_remaining: u64` += `order.qty` (TS `BN`). Escrow (`SEED_ESCROW = b"escrow"`): emptied, then closed, its
rent-exempt lamports credited to `customer`. Sizes and seeds of `Order` and the escrow: HOW_IT_WORKS.md "Data model".

## Errors

| Error | Code | Raised when |
|---|---|---|
| `NotDeliveryOrder` | 6029 | `order.fulfillment_mode != Delivery` (test: "rejects a pickup order") |
| `InvalidOrderStatus` | 6028 | status not in `{PendingDeliveryQuote, DeliveryQuoted, EscrowedReady}` (test: `tests/mark_in_transit.ts` "blocks refuse_delivery and reject_delivery_fee once in transit"; reachable only while the escrow still exists) |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator` (test: "rejects a signer that is not the warehouse operator") |
| `UnauthorizedCustomer` | 6027 | two sources, same code: `order.customer != customer` (the `SystemAccount` receiving the escrow rent, checked first) or `customer_token_account.owner != order.customer` (test: "rejects a refund destination not owned by the customer", stranger ATA of the same mint from `fundTokens(await fund(), 0)`) |
| `AccountNotInitialized` (Anchor) | 3012 | the escrow is gone, i.e. a terminal path already ran (test: "rejects a second refusal: the escrow is gone"); also any other data account with no data |
| `WarehouseMismatch` / `OfferMismatch` / `MintMismatch` | 6011 / 6026 / 6025 | `order.warehouse`, `order.offer` or `order.mint` differs from the account passed; not exercised |
| `MathOverflow` | 6024 | `qty_remaining + order.qty` overflows `u64`; not exercised (unreachable after the `checked_sub` of the same `qty` at `create_order`) |
| `ConstraintSeeds` (Anchor) | 2006 | `escrow` not at `["escrow", order]` with `order.escrow_bump` (the client derives it from the IDL); not exercised |
| `AccountHasWithheldTransferFees` (Token-2022) | n/a | the mint charges a transfer fee, so the escrow cannot be closed; prevented by `allowed_mints`, not by the program (README 11) |
| "Signature verification failed" (web3.js) | n/a | `operator` in `accountsPartial` but missing from `.signers`; the tx is never sent; not exercised |

## Events

```rust
#[event]
pub struct OrderRefused {
    pub order: Pubkey,
}
```

Emitted after the status write. The test reads it with `events(refuse(order))` (`tests/helpers.ts`: rpc at commitment `confirmed`, logs
decoded by `anchor.EventParser`) and asserts the only event is `orderRefused` (camelCase in the TS client, `OrderRefused` in Rust and in
the IDL) with `data.order` equal to the order PDA.

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

From `tests/refuse_delivery.ts`; `customer` is left out on purpose, resolved from the fetched `order`. `m = await market()` (operator,
warehouse `fee_bps` 250, approved farmer, offer qty 500 at 1_000_000, customer with 100_000_000), `delivery()` =
`createOrder(m.buyer, m.offer, m.warehouse, "delivery")` (qty 10, subtotal 10_000_000); `quote(order)` sets a 500_000 fee and
`accept(order)` escrows it for the `EscrowedReady` case.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): the nine accounts deserialize in field order first, then constraints run in
  field order: `order` (`has_one` warehouse, offer, mint, customer, then the raw constraints mode, status), `warehouse`
  (`has_one = operator`), `customer_token_account` (raw owner constraint, then `token::mint`: Anchor runs raw constraints before
  `token::` checks), `escrow` (seeds + bump). Mode is declared before status on purpose: a pickup order is in `EscrowedPickup`, which
  also fails the status set, and the test expects `NotDeliveryOrder`.
- Deserialization preceding every constraint is what makes a replay report `AccountNotInitialized` (3012) instead of
  `InvalidOrderStatus`: the escrow is gone, so `InterfaceAccount<TokenAccount>` fails before the status constraint runs. The status
  gate is exercised where the escrow is alive, in `tests/mark_in_transit.ts`.
- Handler: `escrow::withdraw` CPI with `ctx.accounts.escrow.amount` as deserialized at entry (never recomputed from `Order`), then
  `escrow::close` with `ctx.accounts.customer.to_account_info()` as destination, then `offer.qty_remaining = checked_add(order.qty)`,
  then `order.status = Refused`, then `emit!`. A failed CPI aborts before any write. `close_account` reads the on-chain balance, set
  to 0 by the withdrawal, so the stale `amount` in the deserialized struct does not matter.
- CPIs: `token_interface::transfer_checked` and `token_interface::close_account` via `CpiContext::new_with_signer`, both with signer
  seeds `[SEED_ESCROW, order.key(), [order.escrow_bump]]`; the escrow is `from`, `authority` and `account`. `transfer_checked` uses
  `decimals = mint.decimals`, hence `mint` is an account pinned by `has_one`. `escrow::close` takes its destination as
  `&AccountInfo`, so it serves both this instruction's `SystemAccount` and `reject_delivery_fee`'s `Signer`.
- `customer: SystemAccount` keeps the rent out of a token or program account, `has_one = customer` ties it to the order; the test
  asserts `escrowClosed(order)` (`getAccountInfo` returns `null`) and `lamports(customer) == before + lamports(escrow)`.
- The refund destination must already exist (no ATA creation); a customer-owned account of another mint passes the owner constraint
  and fails Anchor's `token::mint` check (`ConstraintTokenMint`, 2014).
- Compute: 25122 CU, the maximum over the suite, well inside the 200k default; no compute-budget instruction needed.
