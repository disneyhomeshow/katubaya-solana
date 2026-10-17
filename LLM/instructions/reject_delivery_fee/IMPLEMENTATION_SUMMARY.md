# reject_delivery_fee: change log

## Files

Program
- `programs/farmer-core/src/instructions/reject_delivery_fee.rs` (created): `RejectDeliveryFee` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod reject_delivery_fee; pub use reject_delivery_fee::*;`
- `programs/farmer-core/src/lib.rs` (modified): `pub mod escrow;` and the `reject_delivery_fee(ctx)` wrapper
- `programs/farmer-core/src/escrow.rs` (created, M4): `deposit` / `withdraw`, the only token CPIs; this instruction calls `withdraw`
- `programs/farmer-core/src/states.rs` (modified, M4): `Order`, `OrderStatus`, `FulfillmentMode`, `EXPIRY_*_SECS` added; `SEED_ORDER`, `SEED_ESCROW` pre-existing
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended at the end, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `MintMismatch`, `OfferMismatch`, `UnauthorizedCustomer`, `InvalidOrderStatus`, `MathOverflow`
- `programs/farmer-core/src/events.rs` (modified, M4): `OrderCreated`, `DeliveryFeeQuoted`, `DeliveryFeeAccepted`, `DeliveryFeeRejected` (emitted here), `OrderRefused` appended
- `programs/farmer-core/Cargo.toml` (modified, M4): `anchor-spl = "0.32.1"`, `anchor-spl/idl-build` in the `idl-build` feature
- `Cargo.lock` (modified, M4): `blake3` pinned to 1.5.5 and `zeroize_derive` to 1.4.2 (SBF cargo cannot read edition-2024 crates)

Tests
- `tests/reject_delivery_fee.ts` (created): refund + stock + status + event, not quoted, signer not the customer, offer not the order's
- `tests/helpers.ts` (modified, M4): real SPL mint in the root `before`, `testMint`, `fundTokens`, `tokenBalance`, `confirmedCustomer` returns `{ customer, ata }`, `Buyer`, `orderPDA`, `escrowPDA`, `createOrderTx` / `createOrder`, `market`, `SUBTOTAL`, `SERVICE_FEE`, `H6`, `H72`
- `tests/flow_order.ts` (created, M4): confirm → publish → create (delivery) → quote → accept; does not call this instruction
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev); `tsconfig.json`: `lib` es2015 → es2020

Docs
- `LLM/instructions/reject_delivery_fee/HOW_IT_WORKS.md`
- `LLM/instructions/reject_delivery_fee/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/reject_delivery_fee/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified, M4): 5.8 gains `mint` and `escrow_bump`, escrow described as a token account that is its own authority; 8.7 names the `states.rs` constants; 8.5 unchanged
- `AGENTS.md` (modified, M4): `escrow.rs` section, token helpers in "Testing Guidelines", `edition2024` and validator-startup entries in "Common Errors"
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the tree, "token CPIs only through `escrow.rs`"
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- No args: the customer, offer, mint, qty and escrow bump all come from `order`; the client only names accounts.
- Gates as constraints on `order`, in struct order: `has_one = customer` → `UnauthorizedCustomer`, `has_one = offer` → `OfferMismatch`, `has_one = mint` → `MintMismatch`, `status == DeliveryQuoted` → `InvalidOrderStatus`; the handler has no `require!`.
- Refund amount is `escrow.amount`, the real balance, never `order.subtotal_minor` (AGENTS.md `escrow.rs` rule); the escrow ends at exactly 0.
- Withdrawal signed by the program with `[SEED_ESCROW, order, order.escrow_bump]`: the escrow is its own authority and the bump is stored at `create_order`, so no re-derivation.
- Destination constrained only by `token::mint = mint` and `token::authority = customer`: any token account of the order's mint owned by the signer qualifies, not only the original ATA.
- Status gate only, no `fulfillment_mode` check: `DeliveryQuoted` is reachable by delivery orders alone.
- Stock restored with `checked_add` → `MathOverflow`, same pattern as every refund path (AGENTS.md "Checked arithmetic"); overflow is unreachable in practice and untested.
- No pause gate and no `expires_at` check: `config` is not loaded, and only `expire_order` (M6) will read expiry.
- Emits `DeliveryFeeRejected { order }` only; README 9's `OrderCanceled` has no instruction behind it.
- The emptied escrow is not closed in M4; the customer's rent for it stays locked.
- `MintMismatch`, missing-account and missing-signer cases are not tested (single-mint fixture, framework-level errors).

## Prerequisites

- An `Order` in `DeliveryQuoted`: `create_order` with `mode = Delivery` (which itself needs `ProgramConfig` unpaused, an active `LotOffer`, a `WarehouseCustomer` in `Confirmed`, a funded customer token account) followed by `quote_delivery_fee` signed by the warehouse operator
- The keypair stored in `order.customer` signs; it pays only the transaction fee (no rent, no `mut`)
- A token account for `order.mint` owned by that customer, passed as `customer_token_account` (tests reuse the ATA from `confirmedCustomer`)
- The escrow token account created at `create_order`, resolved from the IDL as `["escrow", order]`
- `token_program` matching the mint's program (`TOKEN_PROGRAM_ID` in tests)
- No pause state or expiry window applies

## History

- 2026-10-17 M4: created
