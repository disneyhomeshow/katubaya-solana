# refuse_delivery: change log

## Files

Program
- `programs/farmer-core/src/instructions/refuse_delivery.rs` (created): `RefuseDelivery` + handler
- `programs/farmer-core/src/escrow.rs` (created, M4): `deposit` / `withdraw`; this instruction calls `withdraw`
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod refuse_delivery; pub use refuse_delivery::*;`
- `programs/farmer-core/src/lib.rs` (modified): `pub mod escrow;` and the `refuse_delivery(ctx)` wrapper
- `programs/farmer-core/src/states.rs` (modified, M4): `Order` (227 B), `FulfillmentMode`, `OrderStatus`, `EXPIRY_*` constants; this instruction reads `SEED_ESCROW`, `FulfillmentMode::Delivery`, `OrderStatus::{PendingDeliveryQuote, DeliveryQuoted, EscrowedReady, Refused}`
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended at the end, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `NotDeliveryOrder`, `InvalidOrderStatus`, `UnauthorizedCustomer`, `OfferMismatch`, `MintMismatch`, `MathOverflow` plus the pre-existing `UnauthorizedOperator`, `WarehouseMismatch`
- `programs/farmer-core/src/events.rs` (modified, M4): `OrderRefused` appended (with `OrderCreated`, `DeliveryFeeQuoted`, `DeliveryFeeAccepted`, `DeliveryFeeRejected`)
- `programs/farmer-core/Cargo.toml` (modified, M4): `anchor-spl = "0.32.1"`, `idl-build` feature extended with `anchor-spl/idl-build`
- `Cargo.lock` (modified, M4): anchor-spl tree; `blake3` pinned 1.5.5 and `zeroize_derive` 1.4.2 (SBF cargo cannot read edition-2024 crates)

Tests
- `tests/refuse_delivery.ts` (created): refund from pending (with event), quoted and ready (subtotal + fee) orders asserting customer balance, escrow 0, stock and status; pickup order, wrong signer, destination not owned by the customer, already refused
- `tests/helpers.ts` (modified, M4): `market`, `confirmedCustomer`, `createOrder` / `createOrderTx`, `fundTokens`, `tokenBalance`, `escrowPDA`, `orderPDA`, `testMint`, `payer`; root `before` creates the real SPL mint
- `tests/flow_order.ts` (created, M4): confirm -> publish -> create -> quote -> accept; does not call `refuse_delivery`
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev); `tsconfig.json` (modified, M4): `lib` es2015 -> es2020

Docs
- `LLM/instructions/refuse_delivery/HOW_IT_WORKS.md`
- `LLM/instructions/refuse_delivery/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/refuse_delivery/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified, M4): section 5.8 gained `mint`, `escrow_bump` and the escrow-as-own-authority wording; section 8.7 names the expiry constants; section 8.5 (this instruction) unchanged
- `AGENTS.md` (modified, M4): `escrow.rs` section, token helpers and `market()` in the helper list, "edition2024" and "validator does not look started" entries
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the tree, "token CPIs only through `escrow.rs`"
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- Signer is the operator, gated by `warehouse has_one = operator` with `order has_one = warehouse`: the operator of the order's warehouse, nobody else (README 12).
- Accepted statuses `PendingDeliveryQuote | DeliveryQuoted | EscrowedReady` via `matches!` (README 8.5); `InTransit` and terminal states excluded, so no double refusal.
- `NotDeliveryOrder` is a separate error declared before the status constraint, so a pickup order (status `EscrowedPickup`) reports its mode, not its status.
- Refund destination chosen by the operator but constrained to `owner == order.customer` (raw constraint, checked first) and `token::mint = mint`: the customer does not sign, so `token::authority = customer` is unavailable.
- Refund amount is `escrow.amount`, the real balance, covering subtotal-only and subtotal + fee with one path (AGENTS.md escrow rule).
- Withdrawal signed by the program with `[SEED_ESCROW, order, order.escrow_bump]`; `transfer_checked` with `mint.decimals`, hence `mint` as an account pinned by `has_one`.
- Stock restored with `checked_add` -> `MathOverflow`; status `Refused`; `OrderRefused { order }` emitted after the writes.
- No pause gate (`config` not loaded), no `expires_at` check (`expire_order`, M6), no escrow close (rent stays with the account).
- Gates are `#[account]` constraints only; the handler has no `require!` and no args.
- Tests cover the three refundable statuses and each named error reachable with the fixtures; `has_one` mismatches, overflow and framework errors are not exercised.

## Prerequisites

- An `Order` created by `create_order` with `mode = Delivery`, in `PendingDeliveryQuote` (fresh), `DeliveryQuoted` (after `quote_delivery_fee`) or `EscrowedReady` (after `accept_delivery_fee`); this implies the `ProgramConfig`, the `Warehouse`, an approved farmer's active `LotOffer` and a confirmed customer existed at creation
- The escrow token account at `["escrow", order]` holding the subtotal (plus the accepted fee), as left by those instructions
- A token account of `order.mint` owned by `order.customer` (the customer's ATA in tests); the program does not create it
- The `warehouse.operator` keypair to sign; it is not `mut` and nothing is created, so it needs no lamports (the provider wallet pays the fee in tests)
- No pause or expiry requirement

## History

- 2026-10-17 M4: created
