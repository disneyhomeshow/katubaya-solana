# accept_delivery_fee: change log

## Files

Program
- `programs/farmer-core/src/instructions/accept_delivery_fee.rs` (created): `AcceptDeliveryFee` + handler
- `programs/farmer-core/src/escrow.rs` (created, M4): `deposit` (used here, customer-signed) and `withdraw` (PDA-signed refunds); the only module issuing token CPIs
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod accept_delivery_fee; pub use accept_delivery_fee::*;` (alphabetical, first entry)
- `programs/farmer-core/src/lib.rs` (modified): `pub mod escrow;` and the `accept_delivery_fee(ctx)` wrapper
- `programs/farmer-core/src/states.rs` (modified, M4): `Order`, `OrderStatus`, `FulfillmentMode`, `EXPIRY_PENDING_QUOTE_SECS` / `EXPIRY_QUOTED_SECS` / `EXPIRY_PICKUP_SECS` added; `SEED_ORDER`, `SEED_ESCROW` pre-existing
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended at the end, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `MathOverflow`, `MintMismatch`, `UnauthorizedCustomer`, `InvalidOrderStatus`
- `programs/farmer-core/src/events.rs` (modified, M4): `DeliveryFeeAccepted` (emitted here) appended with `OrderCreated`, `DeliveryFeeQuoted`, `DeliveryFeeRejected`, `OrderRefused`
- `programs/farmer-core/Cargo.toml` (modified, M4): `anchor-spl = "0.32.1"`; `anchor-spl/idl-build` wired into the `idl-build` feature
- `Cargo.lock` (modified, M4): `blake3` pinned 1.5.5 and `zeroize_derive` 1.4.2, the SBF cargo (platform-tools v1.48, rustc 1.84.1) cannot read edition-2024 crates

Tests
- `tests/accept_delivery_fee.ts` (created): happy path (event, customer and escrow balances, `EscrowedReady`, 72 h expiry), zero fee, wrong customer, not quoted
- `tests/helpers.ts` (modified, M4): real SPL mint in the root `before`, `payer`, `testMint`, `fundTokens`, `tokenBalance`, funded `confirmedCustomer`, `orderPDA`, `escrowPDA`, `createOrderTx` / `createOrder`, `market`, `SUBTOTAL`, `SERVICE_FEE`, `H6`, `H72`, `Buyer`
- `tests/flow_order.ts` (created, M4): confirm -> publish -> create (delivery) -> quote -> accept; asserts escrow = `SUBTOTAL + FEE`, customer = `start - SUBTOTAL - FEE`
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev)
- `tsconfig.json` (modified, M4): `lib` es2015 -> es2020

Docs
- `LLM/instructions/accept_delivery_fee/HOW_IT_WORKS.md`
- `LLM/instructions/accept_delivery_fee/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/accept_delivery_fee/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified, M4): section 5.8 gains `mint` and `escrow_bump` and the escrow-is-its-own-authority wording; section 8.7 notes the 6 h / 6 h / 72 h constants, `ESCROWED_READY` reusing 72 h (the window this instruction sets); section 8.5 unchanged
- `AGENTS.md` (modified, M4): `escrow.rs` in the tree and file responsibilities, token helpers and `market()` in Testing Guidelines, `edition2024` and `startup_wait` entries in Common Errors
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the layout, "token CPIs only through `escrow.rs`"
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- No args: the amount is `order.delivery_fee_minor` as written by `quote_delivery_fee`; the customer cannot accept a different figure.
- Gates are `#[account]` constraints, no `require!`: `has_one = customer @ UnauthorizedCustomer`, `has_one = mint @ MintMismatch`, `status == DeliveryQuoted @ InvalidOrderStatus`.
- Authorization by `has_one = customer` on the signer; `CustomerProfile` / `WarehouseCustomer` are not loaded (eligibility was checked at `create_order`).
- Escrow addressed by `seeds = [SEED_ESCROW, order]` with `bump = order.escrow_bump` (no re-derivation); its `token::` constraints live in `create_order`'s `init`.
- Deposit via `escrow::deposit` (`CpiContext::new`, customer signs) before the state writes; the program signs only withdrawals.
- `status -> EscrowedReady`, `expires_at = now + EXPIRY_PICKUP_SECS` (72 h) through `checked_add @ MathOverflow`; `expires_at` is never checked here (`expire_order`, M6).
- No pause gate: quote / accept / reject / refuse do not load `config`.
- Zero fee accepted (`transfer_checked(0)` succeeds), so a free delivery still reaches `EscrowedReady`.
- Test file covers `UnauthorizedCustomer` and `InvalidOrderStatus` once each; `MintMismatch`, `MathOverflow`, token-account constraints, insufficient funds (covered for the subtotal in `tests/create_order.ts`) and missing signer are not exercised.

## Prerequisites

- `ProgramConfig` created via `init_config` with the offer's mint in `allowed_mints` (checked once at `publish_offer`); `paused` is not checked here
- A `Warehouse`, an approved farmer and an active `LotOffer` (see `market()` in `tests/helpers.ts`)
- The customer registered and confirmed for that warehouse, holding a token account for `offer.mint` (`confirmedCustomer` funds an ATA with 100_000_000 minor units)
- An `Order` created by that customer via `create_order` with `mode = Delivery` (escrow token account exists and holds `subtotal_minor`)
- `quote_delivery_fee` run by the warehouse operator: `status == DeliveryQuoted`, `delivery_fee_minor` set (zero allowed)
- The customer's token account balance >= `delivery_fee_minor`; the customer keypair signs (no rent: nothing is created)

## History

- 2026-10-17 M4: created
