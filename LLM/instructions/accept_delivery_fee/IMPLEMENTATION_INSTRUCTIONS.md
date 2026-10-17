# accept_delivery_fee: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/accept_delivery_fee.rs` | `AcceptDeliveryFee` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `deposit(token_program, from, mint, escrow, customer, amount)`: the `transfer_checked` CPI used here (`withdraw` is for refunds) |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod` + `pub use` of the instruction |
| `programs/farmer-core/src/lib.rs` | `pub mod escrow;` and the `#[program]` wrapper `accept_delivery_fee(ctx)` |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `EXPIRY_PICKUP_SECS`, `SEED_ESCROW` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{UnauthorizedCustomer, MintMismatch, InvalidOrderStatus, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `DeliveryFeeAccepted` |
| `tests/accept_delivery_fee.ts` | Happy path with event and balances, zero fee, wrong customer, not quoted |
| `tests/flow_order.ts` | End-to-end delivery flow ending at this instruction (M4) |
| `tests/helpers.ts` | `market`, `createOrder`, `confirmedCustomer`, `tokenBalance`, `escrowPDA`, `testMint`, `events`, `fails`, `SUBTOTAL`, `H72`, `Buyer` |
| `target/idl/farmer_core.json` | Generated IDL (`escrow` PDA seeds, `relations` on `mint` / `customer`, discriminators, error codes, event) |

## Accounts struct

```rust
/// Customer accepts the quoted delivery fee and escrows it; the order is ready for transport.
#[derive(Accounts)]
pub struct AcceptDeliveryFee<'info> {
    #[account(
        mut,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.status == OrderStatus::DeliveryQuoted @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = customer)]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    pub customer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `order` | `Account<Order>` | `mut`, `has_one = customer @ UnauthorizedCustomer`, `has_one = mint @ MintMismatch`, `constraint = status == DeliveryQuoted @ InvalidOrderStatus` | must pass (`orderPDA(offer, customer, id)` in tests) |
| `mint` | `InterfaceAccount<Mint>` | none of its own; bound by `has_one = mint` on `order` | must pass (`testMint()`); IDL lists `relations: ["order"]` |
| `customer_token_account` | `InterfaceAccount<TokenAccount>` | `mut`, `token::mint = mint`, `token::authority = customer` | must pass (`buyer.ata`) |
| `escrow` | `InterfaceAccount<TokenAccount>` | `mut`, `seeds = [SEED_ESCROW, order.key()]`, `bump = order.escrow_bump` | auto from IDL (seeds from `order`) |
| `customer` | `Signer` | signer; bound by `has_one = customer` on `order` | must pass via `.accountsPartial({ customer })` + `.signers([customer])`; IDL lists `relations: ["order"]` |
| `token_program` | `Interface<TokenInterface>` | none (SPL Token or Token-2022) | must pass (`TOKEN_PROGRAM_ID`) |

## Arguments

None. The amount is `order.delivery_fee_minor`, written by `quote_delivery_fee`.

## Account layout

`Order` (seeds `["order", offer, customer, order_id u64 LE]`, 8 + INIT_SPACE = 227 bytes). Fields written here, verbatim from `states.rs`:

```rust
    pub status: OrderStatus,
    pub expires_at: i64,
```

`status`: `DeliveryQuoted -> EscrowedReady` (TS: `{ deliveryQuoted: {} }` -> `{ escrowedReady: {} }`); `expires_at`: `now + EXPIRY_PICKUP_SECS` (259 200 s, TS `BN`).
Fields read: `customer`, `mint` (`has_one`), `delivery_fee_minor` (CPI amount), `escrow_bump` (escrow seeds).

## Errors

| Error | Code | Raised when |
|---|---|---|
| `UnauthorizedCustomer` | 6027 | `order.customer != customer` (test: "rejects a signer that is not the order's customer", a second confirmed customer) |
| `MintMismatch` | 6025 | `order.mint != mint`; not exercised in this test file |
| `InvalidOrderStatus` | 6028 | `order.status != DeliveryQuoted` (test: "rejects an order that was not quoted", a `PendingDeliveryQuote` order) |
| `MathOverflow` | 6024 | `now.checked_add(EXPIRY_PICKUP_SECS)` overflows `i64`; unreachable with real clock values, untested |
| `ConstraintTokenMint` (Anchor) | 2014 | `customer_token_account.mint != mint`; not exercised |
| `ConstraintTokenOwner` (Anchor) | 2015 | `customer_token_account.owner != customer`; not exercised |
| `ConstraintSeeds` (Anchor) | 2006 | `escrow` is not `["escrow", order]` with `order.escrow_bump`; cannot happen when the IDL resolves it; not exercised |
| `AccountNotInitialized` (Anchor) | 3012 | `order` (or a token account) has no data; not exercised in this test file (`tests/create_order.ts` covers it) |
| "custom program error: 0x1" (SPL Token) | n/a | customer balance below `delivery_fee_minor`; not exercised here (`tests/create_order.ts` hits it for the subtotal) |

## Events

```rust
#[event]
pub struct DeliveryFeeAccepted {
    pub order: Pubkey,
}
```

Emitted after the writes with `order.key()`. The test reads it with `events(accept(order))` (`tests/helpers.ts`: rpc at commitment `confirmed`, logs
decoded by `anchor.EventParser`) and asserts `evs.map((e) => e.name)` equals `["deliveryFeeAccepted"]` (camelCase) and `evs[0].data.order.equals(order)`.

## Client call

```typescript
  const accept = (order: anchor.PublicKey, buyer: Buyer = m.buyer) =>
    program.methods
      .acceptDeliveryFee()
      .accountsPartial({
        order,
        mint: testMint(),
        customerTokenAccount: buyer.ata,
        customer: buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer.customer]);
```

From `tests/accept_delivery_fee.ts`; `m = await market()` supplies operator, warehouse (fee_bps 250), approved farmer, offer (qty 500, price 1_000_000) and a
confirmed buyer holding 100_000_000 minor units; `quoted(fee = 500_000)` runs `createOrder(..., "delivery")` then `quoteDeliveryFee` as the operator.
`tests/flow_order.ts` issues the same call inline with `FEE = 750_000`.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`): there is no `init`, so the six accounts deserialize in field order (`order`, `mint`,
  `customer_token_account`, `escrow`, `customer`, `token_program`), then constraints run in field order: `order` (`mut`, `has_one customer`,
  `has_one mint`, status), `customer_token_account` (`mut`, `token::mint`, `token::authority`), `escrow` (seeds with the stored bump, then `mut`),
  `customer` signer. Then the handler: `Clock::get()`, `escrow::deposit`, two writes, `emit!`.
- The IDL marks `mint` and `customer` with `relations: ["order"]` (from the `has_one`s); the tests pass both explicitly anyway.
- Arithmetic: the only operation is `now.checked_add(EXPIRY_PICKUP_SECS)` -> `MathOverflow`; `now` feeds only `expires_at`. The fee is forwarded
  as stored; nothing is recomputed or compared against `escrow.amount` (the test asserts `SUBTOTAL + fee` on the escrow).
- Token CPI: `escrow::deposit` calls `anchor_spl::token_interface::transfer_checked(amount, mint.decimals)` with `CpiContext::new`; the
  customer signs as authority of the source account, the program signs nothing. The CPI runs before the state writes; a failed transfer
  (insufficient funds) aborts the transaction, so an order never reaches `EscrowedReady` without the fee in escrow.
- `token_program` is an `Interface<TokenInterface>`: it must be the program that owns the mint and both token accounts; the fixtures use the
  classic SPL Token program. The Token-2022 path is not tested.
