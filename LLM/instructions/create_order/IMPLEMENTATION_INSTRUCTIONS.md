# create_order: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/create_order.rs` | `CreateOrder` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `deposit` (used here) and `withdraw`; the only token CPIs, both `transfer_checked` via `anchor_spl::token_interface` |
| `programs/farmer-core/src/states.rs` | `Order`, `FulfillmentMode`, `OrderStatus`, `SEED_ORDER`, `SEED_ESCROW`, `SEED_WCUSTOMER`, `SEED_CONFIG`, `MAX_FEE_BPS`, `EXPIRY_PICKUP_SECS`, `EXPIRY_PENDING_QUOTE_SECS` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{ProgramPaused, WarehouseMismatch, OfferInactive, CustomerNotConfirmed, MintMismatch, InvalidQuantity, OfferExpired, MathOverflow, InsufficientStock}` |
| `programs/farmer-core/src/events.rs` | `OrderCreated` |
| `tests/create_order.ts` | Pickup happy path (event, balances, stock, every field), delivery status/expiry, twelve failure cases |
| `tests/helpers.ts` | `market`, `confirmedCustomer`, `fundTokens`, `tokenBalance`, `orderPDA`, `escrowPDA`, `createOrderTx`, `createOrder`, `testMint`, `SUBTOTAL`, `SERVICE_FEE`, `H6`, `H72` |
| `tests/flow_order.ts` | Delivery flow: create (delivery) -> quote -> accept |
| `target/idl/farmer_core.json` | Generated IDL (PDA seeds incl. the `offer.warehouse` path, `FulfillmentMode`, error codes, event) |

## Accounts struct

```rust
/// Confirmed customer buys `qty` from an active offer: stock is reserved and the subtotal escrowed in one transaction.
#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CreateOrder<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump,
        constraint = !config.paused @ FarmerCoreError::ProgramPaused
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = offer.active @ FarmerCoreError::OfferInactive
    )]
    pub offer: Account<'info, LotOffer>,

    pub warehouse: Account<'info, Warehouse>,

    #[account(
        seeds = [SEED_WCUSTOMER, offer.warehouse.as_ref(), customer.key().as_ref()],
        bump,
        constraint = warehouse_customer.status == WarehouseCustomerStatus::Confirmed @ FarmerCoreError::CustomerNotConfirmed
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    #[account(
        init,
        payer = customer,
        space = 8 + Order::INIT_SPACE,
        seeds = [SEED_ORDER, offer.key().as_ref(), customer.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,

    #[account(constraint = mint.key() == offer.mint @ FarmerCoreError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = customer)]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = customer,
        token::mint = mint,
        token::authority = escrow,
        token::token_program = token_program,
        seeds = [SEED_ESCROW, order.key().as_ref()],
        bump
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub customer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

Client: `offer`, `warehouse`, `mint`, `customerTokenAccount` (the customer's ATA in tests), `customer` and `tokenProgram` (`TOKEN_PROGRAM_ID`;
an `Interface` has no fixed address) go through `.accountsPartial`, plus `.signers([customer])`. The IDL resolves `config` (const seeds),
`warehouse_customer` (the TS resolver fetches `offer` for the `offer.warehouse` seed), `order` (seeds incl. the `order_id` arg), `escrow`
(from the resolved `order`) and `system_program`; `warehouse` carries `relations = ["offer"]` in the IDL but the tests pass it explicitly.

## Arguments

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `order_id` | `u64` | `BN` | none; seed of `order`, a reused id for the same offer + customer fails at `init` | "already in use" (system program) |
| `qty` | `u64` | `BN` | `> 0`; `qty * price_minor` fits `u64`; `<= offer.qty_remaining` | `InvalidQuantity`, `MathOverflow`, `InsufficientStock` |
| `mode` | `FulfillmentMode` | `{ pickup: {} } \| { delivery: {} }` | none; selects status and expiry window | n/a |

## Account layout

`Order` (`states.rs`; 15 fields in this order: `order_id: u64`; `offer`, `farmer`, `warehouse`, `customer`, `mint: Pubkey`; `qty`, `subtotal_minor`,
`service_fee_minor`, `delivery_fee_minor: u64`; `fulfillment_mode: FulfillmentMode`; `status: OrderStatus`; `created_at`, `expires_at: i64`;
`escrow_bump: u8`), 8 + INIT_SPACE = 227 bytes (8 + 32 * 5 + 8 * 4 + 1 + 1 + 8 + 8 + 1 = 219), seeds `["order", offer, customer, order_id u64 LE]`.
`FulfillmentMode { Pickup, Delivery }`; `OrderStatus { EscrowedPickup, PendingDeliveryQuote, DeliveryQuoted, EscrowedReady, InTransit,
Fulfilled, Refused, Canceled, Expired }`. TS decodes the `u64`/`i64` fields as `BN`, enums as `{ pickup: {} }` / `{ escrowedPickup: {} }`.
Escrow: plain SPL token account (165 bytes) at `["escrow", order]`, mint `offer.mint`, owner itself; withdrawals later sign with
`[SEED_ESCROW, order, order.escrow_bump]`.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `ProgramPaused` | 6001 | `config.paused` (test: "rejects while the program is paused") |
| `WarehouseMismatch` | 6011 | `warehouse != offer.warehouse` (test: "rejects a warehouse that is not the offer's"; variant reused from the Farmer section, `#[msg]` "Farmer did not request this warehouse") |
| `OfferInactive` | 6020 | `!offer.active` (test: "rejects an inactive offer") |
| `CustomerNotConfirmed` | 6021 | `warehouse_customer.status != Confirmed` (tests: "...confirmation is still pending", "rejects a revoked customer") |
| `MintMismatch` | 6025 | `mint.key() != offer.mint` (test: "rejects a mint that is not the offer's") |
| `InvalidQuantity` | 6017 | `qty == 0` (test: "rejects qty of zero") |
| `OfferExpired` | 6022 | `offer.expires_at` is `Some` and `<= now` (test: "rejects an expired offer", expiry now + 2 s, sleeps 4 s) |
| `InsufficientStock` | 6023 | `qty > offer.qty_remaining` (test: "rejects qty above the remaining stock", 501 of 500) |
| `MathOverflow` | 6024 | `qty * price_minor`, the u128 fee math or `now + window` overflows; not exercised |
| `AccountNotInitialized` (Anchor) | 3012 | `warehouse_customer` has no data: the customer never called `request_customer_confirmation` (test: "rejects a customer that never requested confirmation") |
| "already in use" (system program) | n/a | the `order` PDA already exists for this offer + customer + `order_id` (test: "rejects a duplicate order_id"; `fails` returns the raw string) |
| "custom program error: 0x1" (SPL Token) | n/a | `customer_token_account.amount < subtotal` in `transfer_checked` (test: "rejects a customer without enough tokens", funded with 1 minor unit; `include("0x1")`) |

## Events

`OrderCreated { order, offer, farmer, warehouse, customer: Pubkey, qty, subtotal_minor, service_fee_minor: u64, mode: FulfillmentMode }`
(`events.rs`), emitted after the writes and the deposit. The test reads it with `events(create("pickup", {}, id))` (`tests/helpers.ts`: rpc at
`confirmed`, `anchor.EventParser`) and asserts the only event is `orderCreated` with pubkeys as `PublicKey`, `qty` / `subtotalMinor` /
`serviceFeeMinor` as `BN` and `mode` deep-equal to `{ pickup: {} }`.

## Client call

`createOrderTx(buyer, offer, warehouse, id, qty, mode, mint = testMint())` in `tests/helpers.ts` builds
`program.methods.createOrder(new BN(id), new BN(qty), { pickup: {} } | { delivery: {} }).accountsPartial({ offer, warehouse, mint,
customerTokenAccount: buyer.ata, customer: buyer.customer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).signers([buyer.customer])`;
`Buyer = { customer: Keypair; ata: PublicKey }`. Fixture: `m = await market()` (warehouse `fee_bps` 250, offer qty 500 at 1_000_000, customer
funded with 100_000_000); the test's `create(mode, overrides, id)` defaults to qty 10, so `SUBTOTAL = 10_000_000`, `SERVICE_FEE = 250_000`.

## Implementation notes

- Order of checks: non-`init` accounts deserialize in field order, then `order` then `escrow` are created (the escrow seed needs `order.key()`),
  then constraints in field order, then the handler (see the lifecycle in `HOW_IT_WORKS.md`). Tests trigger each error in isolation and do not pin this order.
- Arithmetic: `qty.checked_mul(price_minor)` in `u64`; fee as `(subtotal as u128).checked_mul(fee_bps).checked_div(MAX_FEE_BPS)` then `as u64`
  (division truncates); `qty_remaining.checked_sub(qty)` -> `InsufficientStock`; `now.checked_add(window)` -> `MathOverflow`. `now` is read once, after the `qty` check.
- Token CPI: `escrow::deposit` = `transfer_checked(subtotal, mint.decimals)` with `authority = customer` (`CpiContext::new`); nothing is PDA-signed here.
  It runs after the `Order` and `LotOffer` writes, so an SPL failure (`0x1`) reverts the stock decrement too.
- Untested: `MathOverflow` (all three), offers with `expires_at = None`, `fee_bps = 0`, Token-2022 mints, token-account constraint failures, missing signer.
