# quote_delivery_fee: change log

## Files

Program
- `programs/farmer-core/src/instructions/quote_delivery_fee.rs` (created): `QuoteDeliveryFee` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified, M4): `pub mod quote_delivery_fee; pub use quote_delivery_fee::*;` (alphabetical)
- `programs/farmer-core/src/lib.rs` (modified, M4): `quote_delivery_fee(ctx, delivery_fee_minor)` wrapper; `pub mod escrow;` added for the sibling instructions
- `programs/farmer-core/src/states.rs` (modified, M4): `Order`, `FulfillmentMode`, `OrderStatus`, `EXPIRY_PENDING_QUOTE_SECS` / `EXPIRY_QUOTED_SECS` / `EXPIRY_PICKUP_SECS` added (`SEED_ORDER` / `SEED_ESCROW` pre-existed); this instruction uses `Order`, `OrderStatus`, `EXPIRY_QUOTED_SECS`
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `InvalidOrderStatus` 6028 and `MathOverflow` 6024 plus the pre-existing `UnauthorizedOperator` 6010 and `WarehouseMismatch` 6011
- `programs/farmer-core/src/events.rs` (modified, M4): `OrderCreated`, `DeliveryFeeQuoted` (emitted here), `DeliveryFeeAccepted`, `DeliveryFeeRejected`, `OrderRefused` appended
- `programs/farmer-core/src/escrow.rs` (created, M4): `deposit` / `withdraw`; not used by this instruction
- `programs/farmer-core/Cargo.toml` + `Cargo.lock` (modified, M4): `anchor-spl 0.32.1` with `idl-build` wired in; `blake3 1.5.5` and `zeroize_derive 1.4.2` pinned for the SBF toolchain (platform-tools v1.48, rustc 1.84.1). Needed by the M4 build, not by this handler

Tests
- `tests/quote_delivery_fee.ts` (created): happy path + event + stored fields and expiry window, wrong signer, wrong warehouse, pickup order, already quoted
- `tests/helpers.ts` (modified, M4): `orderPDA`, `escrowPDA`, `fundTokens`, `tokenBalance`, `confirmedCustomer`, `createOrderTx` / `createOrder`, `market`, `SUBTOTAL`, `SERVICE_FEE`, `H6`, `H72`; the root `before` now creates the SPL mint in `config.allowed_mints`
- `tests/flow_order.ts` (created, M4): confirm -> publish -> create (delivery) -> quote -> accept, balances asserted; M5 extends it
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev); `tsconfig.json`: `lib` es2020

Docs
- `LLM/instructions/quote_delivery_fee/HOW_IT_WORKS.md`
- `LLM/instructions/quote_delivery_fee/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/quote_delivery_fee/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified, M4): 5.8 adds `mint` and `escrow_bump`, escrow is a token account that is its own authority; 8.7 names the expiry constants (6 h / 6 h / 72 h). The 8.5 "Quote delivery fee" entry is unchanged
- `AGENTS.md` (modified, M4): `escrow.rs` section, helpers list, Common Errors entries for `edition2024` and validator startup
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the tree, "Token CPIs only through `escrow.rs`"
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- Signer checked through two `has_one` hops (`order.warehouse`, `warehouse.operator`); `Order` never stores the operator (README 12).
- Status gate `constraint = order.status == PendingDeliveryQuote @ InvalidOrderStatus` on `order`; it covers pickup orders and repeated quotes, so no `NotDeliveryOrder` check here.
- `WarehouseMismatch` (6011, Farmer section) reused for the wrong-warehouse case; variants are only appended, never re-sectioned.
- One `u64` arg, no `require!`: zero and any size accepted; the customer accepts or rejects.
- `expires_at` reset to `now + EXPIRY_QUOTED_SECS` (6 h) via `checked_add` (`MathOverflow`); the pending window is not checked (no M4 transition checks expiry; `expire_order` lands in M6).
- No `config` account, so no pause gate; the gate stays on `publish_offer` and `create_order`.
- No token CPI and no rent: `operator` is a plain `Signer`; the fee moves at `accept_delivery_fee`, signed by the customer.
- `emit!(DeliveryFeeQuoted { order, delivery_fee_minor })` after the writes, README 9 shape.

## Prerequisites

- A `Warehouse` created by the admin via `create_warehouse`, whose `operator` is the signer
- An `Order` created via `create_order` with `mode = Delivery` by a customer confirmed for that warehouse, still in `PendingDeliveryQuote` (its escrow already holds `subtotal_minor`); the account key is passed explicitly, the client cannot derive it here
- `ProgramConfig`, the mint and token accounts are not read: they only matter upstream at `create_order`
- No SOL needed by the operator for this instruction: `operator` is not `mut` and the tx fee goes to the fee payer (the provider wallet in the tests)

## History

- 2026-10-17 M4: created
