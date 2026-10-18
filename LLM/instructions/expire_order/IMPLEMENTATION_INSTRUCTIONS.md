# expire_order: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/expire_order.rs` | `ExpireOrder` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `withdraw(...)`: `transfer_checked` signed with the escrow seeds; `close(token_program, escrow, destination, order, bump)`: `close_account`, the rent to `destination` |
| `programs/farmer-core/src/states.rs` | `Order`, `OrderStatus`, `LotOffer`, `SEED_ESCROW` used here; `EXPIRY_PICKUP_SECS`, `EXPIRY_PENDING_QUOTE_SECS`, `EXPIRY_QUOTED_SECS` are the windows the earlier instructions write into `expires_at`, this one only reads the field |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{OfferMismatch, MintMismatch, UnauthorizedCustomer, InvalidOrderStatus, OrderNotExpired, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `OrderExpired` |
| `tests/expire_order.ts` | Gates on the validator: `OrderNotExpired`, in-transit order, foreign refund destination, foreign mint, foreign offer |
| `tests/expire_order_clock.ts` | litesvm: the refund path with a set clock, plus the exact `expires_at` second |
| `tests/helpers.ts` | everything `tests/expire_order.ts` imports: `program`, `market`, `createOrder`, `markInTransit`, `publishOffer`, `fund`, `fundTokens`, `testMint`, `token2022Mint`, `fails`. `tests/expire_order_clock.ts` imports none of it: litesvm needs no validator fixtures |
| `target/idl/farmer_core.json` | Generated IDL (account resolution, escrow PDA seeds, discriminator, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct ExpireOrder<'info> {
    #[account(
        mut,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        constraint = matches!(
            order.status,
            OrderStatus::EscrowedPickup
                | OrderStatus::PendingDeliveryQuote
                | OrderStatus::DeliveryQuoted
                | OrderStatus::EscrowedReady
        ) @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub offer: Account<'info, LotOffer>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Any token account of the order's customer for this mint; the owner check keeps the refund with the customer.
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

    pub token_program: Interface<'info, TokenInterface>,
}
```

Client resolution, from the IDL: `escrow` is a `pda` (seeds `b"escrow"` + the `order` key); `offer`, `mint` and
`customer` carry `relations: ["order"]`, so the Anchor TS client fetches `order` and reads them off it. Only `order`,
`customer_token_account` and `token_program` must be passed, and there is no `signers` list — the provider wallet
appears as fee payer only. `tests/expire_order.ts` still passes `offer` and `mint` through `.accountsPartial`,
because one case deliberately sends a foreign offer.

## Arguments

None: `expire_order(ctx: Context<ExpireOrder>)`. The amount is `escrow.amount`, the quantity `order.qty`, the deadline
`order.expires_at`, the bump `order.escrow_bump`.

## Account layout

Written fields only (`programs/farmer-core/src/states.rs`): `Order.status: OrderStatus` -> `Expired` (TS
`{ expired: {} }`); `expires_at`, `qty`, `customer`, `escrow_bump` and the `has_one` keys are only read. `LotOffer`
(seeds `["offer", farmer, offer_id u64 LE]`, 8 + INIT_SPACE = 895 bytes): `qty_remaining: u64` += `order.qty` (TS
`BN`). Escrow (`SEED_ESCROW = b"escrow"`): balance to 0, then closed, its lamports to `customer`. Seeds and sizes of
`Order` and the escrow, plus the per-status escrow balance: HOW_IT_WORKS.md "Data model".

## Errors

| Error | Code | Raised when |
|---|---|---|
| `OrderNotExpired` | 6032 | `Clock::get()?.unix_timestamp <= order.expires_at`, the only `require!` in the handler (tests: "rejects an order that has not reached expires_at" on the validator, "rejects the exact expires_at second" on litesvm) |
| `InvalidOrderStatus` | 6028 | status not in `{EscrowedPickup, PendingDeliveryQuote, DeliveryQuoted, EscrowedReady}` (test: "rejects an order already in transit") |
| `UnauthorizedCustomer` | 6027 | two sources, same code: `order.customer != customer` (the `SystemAccount` receiving the escrow rent, checked first) or `customer_token_account.owner != order.customer` (test: "rejects a refund destination not owned by the customer", stranger ATA of the same mint from `fundTokens(await fund(), 0)`) |
| `OfferMismatch` | 6026 | `order.offer` differs from the `offer` account passed (test: "rejects an offer that is not the order's", a second offer of the same farmer) |
| `MintMismatch` | 6025 | `order.mint` differs from the `mint` account passed (test: "rejects a mint that is not the order's", which passes the second allowed mint, the Token-2022 one) |
| `MathOverflow` | 6024 | `qty_remaining + order.qty` overflows `u64`; not exercised (unreachable after the `checked_sub` of the same `qty` at `create_order`) |
| `AccountNotInitialized` (Anchor) | 3012 | the escrow is gone, i.e. a terminal path already ran, so a replay reports this instead of `InvalidOrderStatus`; not exercised here (the replays live in `tests/refuse_delivery.ts` and `tests/complete_order.ts`) |
| `ConstraintSeeds` (Anchor) | 2006 | `escrow` not at `["escrow", order]` with `order.escrow_bump` (the client derives it from the IDL); not exercised |
| `ConstraintTokenMint` (Anchor) | 2014 | a customer-owned token account of another mint: it passes the owner constraint and fails `token::mint`; not exercised |
| `AccountHasWithheldTransferFees` (Token-2022) | n/a | the escrow is on a transfer-fee mint, so `close_account` refuses; prevented only by `allowed_mints` (README 11) |

## Events

```rust
#[event]
pub struct OrderExpired {
    pub order: Pubkey,
}
```

Emitted after the status write. `tests/expire_order_clock.ts` decodes the logs with `anchor.EventParser` and asserts
the only event is `OrderExpired` with `data.order` equal to the order account — PascalCase there because that parser
runs on a `BorshCoder` built from the raw IDL. A client built through `Program` (and so the `events(builder)` helper,
which uses `program.coder`) camelCases the IDL first and reports the same event as `orderExpired`; the Rust and IDL
name stays `OrderExpired`.

## Client call

```typescript
const expire = (order: anchor.PublicKey, o: Overrides = {}) =>
  program.methods.expireOrder().accountsPartial({
    order,
    offer: o.offer ?? m.offer,
    mint: testMint(),
    customerTokenAccount: o.customerAta ?? m.buyer.ata,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
```

From `tests/expire_order.ts`; `m = await market()` (warehouse `fee_bps` 250, approved farmer, offer qty 500 at
1_000_000, customer with 100_000_000), orders from `createOrder(m.buyer, m.offer, m.warehouse, "pickup")` (qty 10,
subtotal 10_000_000). No `.signers(...)` anywhere: the call is permissionless.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): the seven accounts deserialize in field order, then
  constraints run in field order: `order` (`has_one` offer, mint, customer, then the raw status constraint), then
  `customer_token_account` (raw owner constraint, then `token::mint`: Anchor runs raw constraints before `token::`
  checks), then `escrow` (seeds + bump). The handler's `require!` on the clock runs last, after every account gate.
  The destination must already exist (no ATA creation): a stranger's ATA of the same mint fails the owner constraint,
  a customer-owned account of another mint fails `token::mint`.
- Handler sequence: `escrow::withdraw` of `ctx.accounts.escrow.amount` as deserialized at entry, `escrow::close` to
  `ctx.accounts.customer.to_account_info()`, `offer.qty_remaining = checked_add(order.qty)`,
  `order.status = Expired`, `emit!(OrderExpired)`. Both CPIs precede the writes, so a failure aborts with no state
  change.
- `escrow::close` (new in M6) takes its destination as `&AccountInfo`, so the four terminal paths pass whatever they
  already hold: a `Signer` in `reject_delivery_fee` (the customer signs there, the field only became `mut`), a
  `SystemAccount` here, in `refuse_delivery` and in `complete_order` — `refuse_delivery` and `complete_order` gained
  that `customer: SystemAccount` field in M6, bound by `has_one = customer @ UnauthorizedCustomer`, and `ExpireOrder`
  was written with it. `SystemAccount` rather than `UncheckedAccount` makes Anchor assert the system program owns it;
  `mut` is required to receive lamports.
- Compute units, maximum over the suite out of the 200k default: `expire_order` 13887, against `create_order` 56600
  and `complete_order` 36822. No compute-budget instruction is needed.
- `tests/expire_order.ts` cannot reach the refund: `expires_at` is `now + 6 h` or `now + 72 h` from the constants in
  `states.rs` and `solana-test-validator` cannot be warped. The refund therefore lives in
  `tests/expire_order_clock.ts` on litesvm (dev dependency `litesvm` 1.6.0), which loads the real
  `target/deploy/farmer_core.so`, injects `Order`, `LotOffer`, the mint, the customer ATA and a funded escrow with
  `svm.setAccount` (plain generated pubkeys work because `ExpireOrder` puts no `seeds` on `order`) and moves
  `getClock()` / `setClock()`. It encodes the call from the raw IDL through `BorshCoder` and calls
  `svm.expireBlockhash()` between the two otherwise identical sends, else rejected as `AlreadyProcessed`.
- `tests/token2022.ts` runs one pickup order end to end on the Token-2022 mint in `config.allowed_mints`, covering
  `deposit`, both payout withdrawals and `close` against that program; `expire_order` reuses those same CPIs and is
  not re-run there.
