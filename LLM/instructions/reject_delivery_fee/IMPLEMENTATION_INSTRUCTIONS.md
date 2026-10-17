# reject_delivery_fee: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/reject_delivery_fee.rs` | `RejectDeliveryFee` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `withdraw(token_program, escrow, mint, to, order, bump, amount)`: the signed `transfer_checked` CPI |
| `programs/farmer-core/src/lib.rs` | `pub mod escrow;` and the `#[program]` wrapper `reject_delivery_fee(ctx)` |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `LotOffer`, `SEED_ESCROW` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{UnauthorizedCustomer, OfferMismatch, MintMismatch, InvalidOrderStatus, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `DeliveryFeeRejected` |
| `tests/reject_delivery_fee.ts` | Happy path with balances, stock, status and event; not quoted; wrong customer; wrong offer |
| `tests/helpers.ts` | `market`, `createOrder`, `confirmedCustomer`, `publishOffer`, `tokenBalance`, `escrowPDA`, `testMint`, `events`, `fails`, `Buyer` |
| `target/idl/farmer_core.json` | Generated IDL (`escrow` PDA seeds, `relations: ["order"]` on `offer`, `mint`, `customer`, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct RejectDeliveryFee<'info> {
    #[account(
        mut,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.status == OrderStatus::DeliveryQuoted @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub offer: Account<'info, LotOffer>,

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
| `order` | `Account<Order>` | `mut`, `has_one = customer`, `has_one = offer`, `has_one = mint`, `status == DeliveryQuoted` | must pass (`order` PDA from `orderPDA(offer, customer, id)`) |
| `offer` | `Account<LotOffer>` | `mut` | must pass; IDL lists it as a relation of `order` |
| `mint` | `InterfaceAccount<Mint>` | none (checked through `has_one = mint` on `order`) | must pass (`testMint()`); relation of `order` |
| `customer_token_account` | `InterfaceAccount<TokenAccount>` | `mut`, `token::mint = mint`, `token::authority = customer` | must pass (`buyer.ata`) |
| `escrow` | `InterfaceAccount<TokenAccount>` | `mut`, `seeds = [SEED_ESCROW, order.key()]`, `bump = order.escrow_bump` | auto from IDL (seeds from `order`) |
| `customer` | `Signer` | none (`mut` not needed: no rent) | must pass via `.accountsPartial({ customer })` + `.signers([customer])` |
| `token_program` | `Interface<TokenInterface>` | none | must pass (`TOKEN_PROGRAM_ID`; an interface has no fixed address) |

## Arguments

None: the handler signature is `reject_delivery_fee(ctx: Context<RejectDeliveryFee>)`; everything comes from `order`.

## Account layout

- `Order` (227 bytes): writes only `status` (`DeliveryQuoted` → `Canceled`, decoded `{ canceled: {} }`); reads `customer`, `offer`, `mint`, `qty`, `escrow_bump`.
- `LotOffer` (895 bytes): writes only `qty_remaining: u64` (`+= order.qty`, a `BN` client-side).
- Escrow: plain SPL token account (165 bytes) at `["escrow", order]`, its own authority; its `amount` goes to 0.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `InvalidOrderStatus` | 6028 | `order.status != DeliveryQuoted` (test: "rejects an order that was not quoted", a fresh `PendingDeliveryQuote` order) |
| `UnauthorizedCustomer` | 6027 | `order.customer != customer` (test: "rejects a signer that is not the order's customer", another confirmed customer with their own ATA) |
| `OfferMismatch` | 6026 | `order.offer != offer` (test: "rejects an offer that is not the order's", a second offer by the same farmer) |
| `MintMismatch` | 6025 | `order.mint != mint`; not exercised: the fixture has a single mint |
| `MathOverflow` | 6024 | `offer.qty_remaining + order.qty` overflows `u64`; unreachable in practice, not exercised |
| `ConstraintSeeds` / `ConstraintTokenMint` / `ConstraintTokenOwner` / `AccountNotInitialized` (Anchor), "Signature verification failed" (runtime) | 2006 / 2014 / 2015 / 3012 / n/a | `escrow` overridden with a wrong PDA; `customer_token_account` of another mint or not owned by `customer`; `order` or `offer` has no data; `customer` missing from `.signers`; none exercised. SPL Token `0x1` (insufficient funds) cannot occur: the amount is the escrow's own balance |

## Events

```rust
#[event]
pub struct DeliveryFeeRejected {
    pub order: Pubkey,
}
```

Emitted after the stock and status writes. The test reads it with `events(reject(order))` (`tests/helpers.ts`, `anchor.EventParser`
over the confirmed tx logs) and asserts the only event is `deliveryFeeRejected` (camelCase) with `data.order` equal to the order PDA.

## Client call

```typescript
  const quoted = async () => {
    const order = await createOrder(m.buyer, m.offer, m.warehouse, "delivery");
    await program.methods
      .quoteDeliveryFee(new BN(500_000))
      .accountsPartial({ order, warehouse: m.warehouse, operator: m.operator.publicKey })
      .signers([m.operator])
      .rpc();
    return order;
  };
  const reject = (order: anchor.PublicKey, buyer: Buyer = m.buyer, offer = m.offer) =>
    program.methods
      .rejectDeliveryFee()
      .accountsPartial({
        order,
        offer,
        mint: testMint(),
        customerTokenAccount: buyer.ata,
        customer: buyer.customer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer.customer]);
```

From `tests/reject_delivery_fee.ts`; `m = await market()` (`tests/helpers.ts`) supplies operator, warehouse, approved farmer, offer
(qty 500, price 1_000_000) and a buyer holding 100_000_000 minor units; the default order (qty 10) escrows 10_000_000.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init` accounts): all seven accounts deserialize in field order
  (`AccountNotInitialized`), then constraints in field order: `order` (`UnauthorizedCustomer`, `OfferMismatch`,
  `MintMismatch`, `InvalidOrderStatus`), `customer_token_account` (`token::mint`, `token::authority`), `escrow`
  (`seeds` with `bump = order.escrow_bump` → `ConstraintSeeds`). The tests trigger each error in isolation, so they do not pin this order.
- Handler order: `escrow::withdraw`, then `offer.qty_remaining = checked_add(order.qty)`, `order.status = Canceled`, `emit!`.
- The CPI is `anchor_spl::token_interface::transfer_checked` with `mint.decimals`, `from = escrow`, `to = customer_token_account`,
  `authority = escrow`, `CpiContext::new_with_signer` with `&[SEED_ESCROW, order.as_ref(), &[bump]]`. The customer signs the transaction, not the transfer.
- `amount` is `ctx.accounts.escrow.amount`, never `order.subtotal_minor` (equal at `DeliveryQuoted`: the fee is only escrowed by
  `accept_delivery_fee`). `delivery_fee_minor`, `expires_at` and `fulfillment_mode` are not read.
