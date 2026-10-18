# reject_delivery_fee: change log

## Files

Program
- `programs/farmer-core/src/instructions/reject_delivery_fee.rs` (created M4, modified M6): `RejectDeliveryFee` + handler; M6 added `#[account(mut)]` on the existing `customer: Signer` and the `escrow::close` call after the refund — the whole diff for this instruction
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod reject_delivery_fee; pub use reject_delivery_fee::*;`
- `programs/farmer-core/src/lib.rs` (modified): `pub mod escrow;` and the `reject_delivery_fee(ctx)` wrapper
- `programs/farmer-core/src/escrow.rs` (created M4, modified M6): `deposit` / `withdraw`, plus `close` (M6: `token_interface::close_account` signed with `[SEED_ESCROW, order, bump]`, destination as `&AccountInfo`); this instruction calls `withdraw` then `close`
- `programs/farmer-core/src/states.rs` (modified, M4): `Order`, `OrderStatus`, `FulfillmentMode`, `EXPIRY_*_SECS` added; `SEED_ORDER`, `SEED_ESCROW` pre-existing
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended at the end, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `MintMismatch`, `OfferMismatch`, `UnauthorizedCustomer`, `InvalidOrderStatus`, `MathOverflow`. M5 and M6 appended `FarmerTokenAccountMismatch` 6030 .. `OrderNotExpired` 6032 for other instructions; the 33-variant enum now spans 6000-6032 and no code used here shifted
- `programs/farmer-core/src/events.rs` (modified, M4): `OrderCreated`, `DeliveryFeeQuoted`, `DeliveryFeeAccepted`, `DeliveryFeeRejected` (emitted here), `OrderRefused` appended; M6 appended `OrderExpired` for `expire_order`, `DeliveryFeeRejected` untouched
- `programs/farmer-core/Cargo.toml` (modified, M4): `anchor-spl = "0.32.1"`, `anchor-spl/idl-build` in the `idl-build` feature
- `Cargo.lock` (modified, M4): `blake3` pinned to 1.5.5 and `zeroize_derive` to 1.4.2 (SBF cargo cannot read edition-2024 crates)

Tests
- `tests/reject_delivery_fee.ts` (created M4, modified M6): refund + stock + status + event, not quoted, signer not the customer, offer not the order's; M6 swapped the `tokenBalance(escrowPDA(order)) == 0` assertion for `escrowClosed(order)`
- `tests/mark_in_transit.ts` (M5): "blocks refuse_delivery and reject_delivery_fee once in transit" is the status-gate coverage that survives the close, the escrow being alive on an `InTransit` order
- `tests/helpers.ts` (modified M4, M6): real SPL mint in the root `before`, `testMint`, `fundTokens`, `tokenBalance`, `confirmedCustomer` returns `{ customer, ata }`, `Buyer`, `orderPDA`, `escrowPDA`, `createOrderTx` / `createOrder`, `market`, `SUBTOTAL`, `SERVICE_FEE`, `H6`, `H72`; M6 added `escrowClosed(order)` and `lamports(account)`
- `tests/flow_order.ts` (created, M4): confirm → publish → create (delivery) → quote → accept → transit → complete; does not call this instruction
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev); `tsconfig.json`: `lib` es2015 → es2020

Docs
- `LLM/instructions/reject_delivery_fee/HOW_IT_WORKS.md`
- `LLM/instructions/reject_delivery_fee/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/reject_delivery_fee/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified M4, M6): 5.8 gains `mint` and `escrow_bump`, escrow described as a token account that is its own authority; 8.7 names the `states.rs` constants; 8.5 (this instruction) unchanged; M6 added the terminal-path escrow-close paragraph to 8.7 and the Token-2022 transfer-fee warning to 11
- `AGENTS.md` (modified, M4): `escrow.rs` section, token helpers in "Testing Guidelines", `edition2024` and validator-startup entries in "Common Errors"
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the tree, "token CPIs only through `escrow.rs`"
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- No args: the customer, offer, mint, qty and escrow bump all come from `order`; the client only names accounts.
- Gates as constraints on `order`, in struct order: `has_one = customer` → `UnauthorizedCustomer`, `has_one = offer` → `OfferMismatch`, `has_one = mint` → `MintMismatch`, `status == DeliveryQuoted` → `InvalidOrderStatus`; the handler has no `require!`.
- Refund amount is `escrow.amount`, the real balance, never `order.subtotal_minor` (AGENTS.md `escrow.rs` rule); the escrow ends at exactly 0, which is also what `close_account` requires.
- Both CPIs signed by the program with `[SEED_ESCROW, order, order.escrow_bump]`: the escrow is its own authority and the bump is stored at `create_order`, so no re-derivation.
- M6: the emptied escrow is closed and its rent (~0.00149 SOL) returned to the customer, who paid it at `create_order` — otherwise every rejection left a dead token account holding the customer's lamports forever. README 8.7 makes this the rule for all four terminal paths.
- M6, why no new account here: the rent destination must be `order.customer`, and in this instruction the customer is the signer, so the field already existed and `has_one = customer` already pinned it. Adding `mut` to `customer: Signer` was the whole account change. `refuse_delivery` and `complete_order` are operator-signed and `expire_order` has no signer, so each had to gain a `customer: SystemAccount` (mut) plus `has_one = customer @ UnauthorizedCustomer`. The shared `escrow::close` takes its destination as `&AccountInfo` so a `Signer` and a `SystemAccount` both fit.
- M6 consequence, accepted: with the escrow gone, a replayed rejection fails at account deserialization with `AccountNotInitialized` (3012) instead of `InvalidOrderStatus`, since Anchor 0.32 deserializes every non-`init` account before running any constraint. The status gate keeps its coverage in `tests/mark_in_transit.ts`, where the escrow is still alive.
- Token-2022 mints that charge a transfer fee are incompatible: the withheld fee leaves the escrow short of the subtotal and `close_account` fails with `AccountHasWithheldTransferFees`. The only control is `config.allowed_mints` at `init_config`; the program does not inspect mint extensions (README 11).
- Destination constrained only by `token::mint = mint` and `token::authority = customer`: any token account of the order's mint owned by the signer qualifies, not only the original ATA.
- Status gate only, no `fulfillment_mode` check: `DeliveryQuoted` is reachable by delivery orders alone.
- Stock restored with `checked_add` → `MathOverflow`, same pattern as every refund path (AGENTS.md "Checked arithmetic"); overflow is unreachable in practice and untested.
- No pause gate and no `expires_at` check: `config` is not loaded, and `expire_order` owns the timeout path; past the 6 h quote window either instruction can refund the same escrow to the same customer, whichever runs first.
- Emits `DeliveryFeeRejected { order }` only (`deliveryFeeRejected` in the TS client); README 9's `OrderCanceled` has no instruction behind it.
- The `Order` PDA is still not closed: only the escrow is, so the `Canceled` record and its rent stay on chain.
- `MintMismatch`, missing-account and missing-signer cases are not tested (single-mint fixture, framework-level errors).
- Compute: ~23k CU (measured as the suite maximum and rounded: the figure drifts by a few thousand between runs), well inside the 200k default; the close CPI did not require a compute-budget bump.

## Prerequisites

- An `Order` in `DeliveryQuoted`: `create_order` with `mode = Delivery` (which itself needs `ProgramConfig` unpaused, an active `LotOffer`, a `WarehouseCustomer` in `Confirmed`, a funded customer token account) followed by `quote_delivery_fee` signed by the warehouse operator
- The keypair stored in `order.customer` signs, and its account must be writable (`mut` since M6): it receives the escrow rent
- A token account for `order.mint` owned by that customer, passed as `customer_token_account` (tests reuse the ATA from `confirmedCustomer`)
- The escrow token account created at `create_order`, resolved from the IDL as `["escrow", order]`, not yet closed by another terminal path
- `token_program` matching the mint's program (`TOKEN_PROGRAM_ID` in tests), on a mint without a Token-2022 transfer fee (enforced only by `config.allowed_mints` at `init_config`)
- No pause state or expiry window applies

## History

- 2026-10-17 M4: created
- 2026-10-17 M6: `customer: Signer` became `mut` and the emptied escrow is closed with its rent refunded to it; a replay now reports `AccountNotInitialized`
