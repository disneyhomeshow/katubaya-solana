# expire_order: change log

## Files

Program
- `programs/farmer-core/src/instructions/expire_order.rs` (created): `ExpireOrder` + handler
- `programs/farmer-core/src/escrow.rs` (modified): `close(token_program, escrow, destination, order, bump)` added next to `deposit` / `withdraw`; `close_account` via `CpiContext::new_with_signer` with `[SEED_ESCROW, order, bump]`, destination as `&AccountInfo` so a `Signer` and a `SystemAccount` both fit
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod expire_order; pub use expire_order::*;`
- `programs/farmer-core/src/lib.rs` (modified): the `expire_order(ctx)` wrapper
- `programs/farmer-core/src/errors.rs` (modified): `// ---- Timeouts` section appended with `OrderNotExpired` 6032; the M6 follow-up appended `MintExtensionNotAllowed` 6033 for `publish_offer`, so the enum is now 34 variants, 6000-6033 and this code did not shift
- `programs/farmer-core/src/events.rs` (modified): `OrderExpired { order }` appended
- `programs/farmer-core/src/instructions/reject_delivery_fee.rs` (modified): `escrow::close`; `customer: Signer` became `mut` as the rent destination
- `programs/farmer-core/src/instructions/refuse_delivery.rs` (modified): `escrow::close`; gained `customer: SystemAccount` (mut) bound by `has_one = customer @ UnauthorizedCustomer`
- `programs/farmer-core/src/instructions/complete_order.rs` (modified): `escrow::close`; same `customer: SystemAccount`; `logistics_payout = escrow.amount - farmer_payout` instead of `service_fee_minor + delivery_fee_minor`
- `programs/farmer-core/src/states.rs` (unchanged): this instruction reads `SEED_ESCROW`, `OrderStatus::{EscrowedPickup, PendingDeliveryQuote, DeliveryQuoted, EscrowedReady, Expired}` and `Order.expires_at`, written by `create_order`, `quote_delivery_fee` and `accept_delivery_fee` from `EXPIRY_PICKUP_SECS` / `EXPIRY_PENDING_QUOTE_SECS` / `EXPIRY_QUOTED_SECS`

Tests
- `tests/expire_order.ts` (created): validator gates — `OrderNotExpired`, in-transit order, refund destination not owned by the customer, foreign offer; no `.signers(...)` anywhere
- `tests/expire_order_clock.ts` (created): litesvm refund path — the second before `expires_at` rejected, then at the exact `expires_at` second refund, stock restore, closed escrow, rent on the customer wallet, status `Expired`, `OrderExpired`
- `tests/token2022.ts` (created): one pickup order end to end on a Token-2022 mint (deposit, both payouts, close)
- `tests/helpers.ts` (modified): second allowed mint on Token-2022 (`token2022Mint()`), `escrowClosed(order)`, `lamports(account)`, `tokenBalance` and `createOrderTx` take a token program
- `tests/complete_order.ts`, `tests/refuse_delivery.ts`, `tests/reject_delivery_fee.ts`, `tests/flow_order.ts` (modified): `escrowClosed(order)` instead of a zero escrow balance; `refuse_delivery.ts` also asserts the rent landing on the customer; the two replay tests, in `complete_order.ts` and `refuse_delivery.ts`, now expect `AccountNotInitialized`
- `package.json` (modified): `litesvm` 1.6.0 (dev), with its tree in `yarn.lock`; `tsconfig.json` (modified): `skipLibCheck: true` for the `@solana/kit` types litesvm pulls in

Docs
- `LLM/instructions/expire_order/HOW_IT_WORKS.md`
- `LLM/instructions/expire_order/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/expire_order/IMPLEMENTATION_SUMMARY.md`
- `LLM/instructions/{create_order,reject_delivery_fee,refuse_delivery,complete_order}/` (modified, M6): the escrow close, the rent refund and the `AccountNotInitialized` replay documented in each affected instruction's own folder
- `README.md` (modified, M6): section 8.7 spells out "no signer at all", the escrow close on every terminal path and the `AccountNotInitialized` replay; section 11 forbids allowlisting a transfer-fee Token-2022 mint
- `AGENTS.md` (modified, M6): "Clock-dependent tests run on litesvm" and the ES-module / `tsc --skipLibCheck` entries
- `docs/DEVELOPMENT_PLAN.md` (modified, M6): M6 deliverables rewritten around `expire_order`, the escrow close and the two test harnesses

## Decisions

- No `Signer` field: the expiry is a fact of the clock, so escrowed money cannot be held hostage by an idle counterparty; whoever sends the transaction pays its fee and gains nothing (README 8.7).
- Accepted statuses `EscrowedPickup | PendingDeliveryQuote | DeliveryQuoted | EscrowedReady` via `matches!`: every funded, still-waiting state. `InTransit` excluded (the warehouse owns the outcome once goods move), terminal states excluded (escrow already settled).
- Inclusive `>=` on `expires_at`, so the exact second already expires the order, the same reading `create_order` and `publish_offer` give the field; it is the handler's only `require!` because `Clock::get()` cannot run in an `#[account]` constraint, and it runs after every account gate.
- Refund amount is `escrow.amount`, the real balance, covering subtotal-only and subtotal + accepted fee with one path (AGENTS.md escrow rule).
- Tokens go to a caller-chosen `customer_token_account` constrained to `owner == order.customer`; the escrow rent goes to `customer`, pinned by `has_one = customer`. Neither is a signer: the rent lands on exactly one account, while the tokens can be routed to any token account the customer owns — a stranger can pick which, never whose.
- Handler order: withdraw, close, restore stock, status `Expired`, `emit!(OrderExpired { order })` — CPIs first, so a failure writes nothing.
- The escrow is closed on all four terminal paths, so the customer's rent never leaks; the accepted consequence is that a replayed terminal call fails with `AccountNotInitialized` (3012) rather than `InvalidOrderStatus`.
- No pause gate and no `config` account: a refund must stay possible while the market is paused.
- Transfer-fee Token-2022 mints never get this far: they would underfund the escrow and make `close_account` fail with `AccountHasWithheldTransferFees`, so `publish_offer` rejects them with `MintExtensionNotAllowed`, behind `allowed_mints` at `init_config`.
- Two harnesses: the validator covers the gates, litesvm covers the refund because `expires_at` comes from the 6 h / 6 h / 72 h constants and a validator clock cannot be warped.

## Prerequisites

- An `Order` created by `create_order` in `EscrowedPickup`, `PendingDeliveryQuote`, `DeliveryQuoted` or `EscrowedReady`, with `expires_at` in the past; this implies the `ProgramConfig`, the `Warehouse`, an approved farmer's active `LotOffer` and a confirmed customer existed at creation
- The escrow token account at `["escrow", order]` still open and holding the subtotal (plus the accepted fee), as left by those instructions
- A token account of `order.mint` owned by `order.customer` (the customer's ATA in tests); the program does not create it
- The `order.customer` wallet passed as a writable `SystemAccount`, to receive the escrow rent (~0.00149 SOL)
- A fee payer with lamports for the transaction; no other signer, no pause requirement, no operator and no customer signature
- `target/deploy/farmer_core.so` built before `tests/expire_order_clock.ts` runs: litesvm loads the compiled program directly

## History

- 2026-10-17 M6: created
- 2026-10-17 M6 follow-up: the expiry boundary became inclusive (`now >= order.expires_at`), so the exact `expires_at` second already expires the order
