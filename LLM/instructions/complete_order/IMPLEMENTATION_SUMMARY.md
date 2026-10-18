# complete_order: change log

## Files

Program
- `programs/farmer-core/src/instructions/complete_order.rs` (created M5, modified M6): `CompleteOrder` + handler; M6 added `has_one = customer @ UnauthorizedCustomer` and the `customer: SystemAccount` (mut) field, switched the logistics amount to the escrow remainder and appended the `escrow::close` CPI
- `programs/farmer-core/src/instructions/mark_in_transit.rs` (created, M5): the sibling transition that produces the `InTransit` status this instruction requires
- `programs/farmer-core/src/escrow.rs` (created M4, modified M6): `deposit` / `withdraw`; M6 added `close(token_program, escrow, destination: &AccountInfo, order, bump)` (`close_account` via `CpiContext::new_with_signer`, the escrow its own authority), shared with `reject_delivery_fee`, `refuse_delivery` and `expire_order`
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod complete_order; pub use complete_order::*;` (and `mark_in_transit`), alphabetical
- `programs/farmer-core/src/lib.rs` (modified): `complete_order(ctx)` wrapper (and `mark_in_transit(ctx)`)
- `programs/farmer-core/src/errors.rs` (modified M5): `// ---- Payout` section appended at the end, `FarmerTokenAccountMismatch` 6030 and `LogisticsTokenAccountMismatch` 6031; this instruction also raises the pre-existing `UnauthorizedOperator` 6010, `WarehouseMismatch` 6011, `MathOverflow` 6024, `MintMismatch` 6025, `InvalidOrderStatus` 6028 and, since M6, `UnauthorizedCustomer` 6027. M6 appended a `// ---- Timeouts` section with `OrderNotExpired` 6032 for `expire_order`; codes 6000-6032, nothing shifted
- `programs/farmer-core/src/events.rs` (modified M5, M6): `OrderInTransit` and `OrderCompleted` appended in M5 (README 9 shapes), `OrderExpired` in M6 for `expire_order`; this instruction emits `OrderCompleted`, whose shape is unchanged — the amounts it reports are now the ones actually transferred
- `programs/farmer-core/src/states.rs` (unchanged in M5 and M6): reads `ProgramConfig.logistics_wallet`, `Order`, `OrderStatus::{InTransit, Fulfilled}`, `Warehouse.operator`, `SEED_CONFIG`, `SEED_ESCROW`; no layout change, `Order` stays 227 bytes

Tests
- `tests/complete_order.ts` (created M5, modified M6): pickup payout with event and balances, delivery fee added to the logistics payout, zero-fee warehouse pays the farmer everything, not in transit, wrong signer, farmer account owned by someone else, logistics account owned by someone else. M6 replaced the escrow-balance-0 assertions with `escrowClosed(order)`, turned "rejects an order already fulfilled" (`InvalidOrderStatus`) into "rejects a second completion: the escrow is gone" (`AccountNotInitialized`) and added "sweeps a stray token in the escrow to logistics" for the remainder payout
- `tests/mark_in_transit.ts` (created, M5): proves `refuse_delivery` and `reject_delivery_fee` return `InvalidOrderStatus` once `InTransit` — the status gate still answers whenever the escrow is alive
- `tests/token2022.ts` (created, M6): one pickup order end to end on the Token-2022 mint, including this instruction's two payouts and the close
- `tests/helpers.ts` (modified): M5 added `ataOf(owner)`, `quoteFee`, `acceptFee`, `markInTransit`, `readyOrder` and the `feeBps` parameter of `createWarehouse`; M6 added `escrowClosed(order)`, `lamports(account)`, `token2022Mint()`, the `tokenProgram` parameters of `tokenBalance` and `createOrderTx`, the `mint` and `tokenProgram` parameters of `ataOf`, and a second allowed mint on Token-2022
- `tests/flow_order.ts` (modified): M5 appended `mark_in_transit` then `complete_order` with `FEE = 750_000`; M6 changed the final escrow assertion to `escrowClosed(order)`

Docs
- `LLM/instructions/complete_order/HOW_IT_WORKS.md`, `IMPLEMENTATION_INSTRUCTIONS.md`, `IMPLEMENTATION_SUMMARY.md` (rewritten in M6 against the new payout rule, the close and the `customer` account)
- `README.md` (modified, M6): section 8.6 now states the logistics payout as whatever the escrow still holds after the farmer is paid, normally `service_fee + delivery_fee`, with the close-to-zero and stray-token rationale and the note that `OrderCompleted.logistics_payout` reports the amount actually transferred; section 8.7 gained the paragraph that every terminal path closes the escrow and returns its rent, and that a replay then fails with `AccountNotInitialized`; section 11 gained the transfer-fee Token-2022 warning
- `AGENTS.md` (modified): M5 helper list; M6 the litesvm clock-test rule and the ES-module / `tsc --skipLibCheck` entries
- `docs/DEVELOPMENT_PLAN.md` (modified, M6): the M6 entry names the escrow close and this instruction's remainder payout

## Decisions

- Signer is the operator, gated by `warehouse has_one = operator` with `order has_one = warehouse` (README 12 "completion").
- Single accepted status `InTransit` as a constraint on `order` (README 6, README 12 "Escrow release only from `IN_TRANSIT`"); `EscrowedReady` is rejected, so the escrow cannot be released early.
- Farmer payout from the order (`subtotal_minor - service_fee_minor`, `checked_sub` -> `MathOverflow`); logistics payout is the escrow remainder, `escrow.amount - farmer_payout`. Rationale: it equals the M5 formula `service_fee_minor + delivery_fee_minor` in every normal case, but it guarantees the escrow reaches exactly zero so `close_account` cannot fail, and it sweeps stray tokens sent to the escrow PDA to logistics instead of stranding them forever.
- Escrow closed with `escrow::close` and its rent (1_488_440 lamports) returned to `order.customer`, who paid it at `create_order`; the destination is pinned by `has_one = customer @ UnauthorizedCustomer`, so the operator cannot redirect it. Same close on all four terminal paths (README 8.7).
- The `customer` field is a mut `SystemAccount` with `relations: ["order"]` in the IDL, so clients do not pass it; `escrow::close` takes an `&AccountInfo` so this `SystemAccount` and the `Signer` of `reject_delivery_fee` share one helper.
- Accepted consequence of the close: a replayed completion fails at deserialization with `AccountNotInitialized` (3012) instead of `InvalidOrderStatus`. Tested explicitly; the status gate still covers every order whose escrow is alive.
- Known incompatibility: a transfer-fee Token-2022 mint withholds fees on the escrow, so the balance would fall short of the subtotal and `close_account` would return `AccountHasWithheldTransferFees`. `allowed_mints` at `init_config` is the only control; the program does not inspect mint extensions (README 11).
- Destinations picked by the operator, constrained to `owner == order.farmer` / `owner == config.logistics_wallet` plus `token::mint = mint`: neither payee signs, so `token::authority` is unavailable; any token account of the mint owned by the payee works.
- Two payout errors in an appended `// ---- Payout` section (6030, 6031) so the client sees which destination is wrong and existing codes never shift.
- Logistics destination validated against `config.logistics_wallet` at completion time; the order does not store it and `config` is loaded read-only.
- Payout accounts must exist: no ATA creation, no associated-token program, no payer; clients prepend `createAssociatedTokenAccountIdempotent`.
- Zero amounts go through `transfer_checked` unconditionally (no branch); proven by the `fee_bps` 0 test.
- All three CPIs signed by the program with `[SEED_ESCROW, order, order.escrow_bump]`, `mint.decimals` from the `has_one`-pinned `mint`.
- No pause gate, no `expires_at` check, no stock change; ~37k CU measured, so no compute-budget bump.
- `OrderCompleted` emitted after the status write with every amount (README 9), for the indexer and katubaya inventory reconciliation.
- Gates are `#[account]` constraints only; the handler has no `require!` and no args.

## Prerequisites

- `ProgramConfig` from `init_config`, whose `logistics_wallet` owns the logistics payout account, and whose `allowed_mints` must not contain a transfer-fee Token-2022 mint
- A `Warehouse` whose `operator` keypair signs; it is not `mut` and nothing is created, so it needs no lamports (the provider wallet pays the fee in tests)
- An `Order` in `InTransit` via `mark_in_transit`: a pickup order from `EscrowedPickup`, or a delivery order from `EscrowedReady` (after `quote_delivery_fee` + `accept_delivery_fee`)
- The escrow token account at `["escrow", order]` holding at least `subtotal_minor - service_fee_minor`, as left by those instructions; it is emptied and closed, so the instruction cannot run twice
- Two existing token accounts of `order.mint`: one owned by `order.farmer`, one owned by `config.logistics_wallet` (`ataOf` in tests); the program does not create them
- `order.customer` passed as a writable system-owned account (the IDL resolves it from the order) to receive the escrow rent
- No pause or expiry requirement

## History

- 2026-10-17 M5: created
- 2026-10-17 M6: logistics payout becomes the escrow remainder; escrow closed with its rent returned to `order.customer` via the new `escrow::close`; `customer: SystemAccount` added and pinned by `has_one = customer`; a replay now fails with `AccountNotInitialized`
