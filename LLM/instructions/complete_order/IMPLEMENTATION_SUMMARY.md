# complete_order: change log

## Files

Program
- `programs/farmer-core/src/instructions/complete_order.rs` (created): `CompleteOrder` + handler
- `programs/farmer-core/src/instructions/mark_in_transit.rs` (created, M5): the sibling transition that produces the `InTransit` status this instruction requires
- `programs/farmer-core/src/escrow.rs` (created, M4): `deposit` / `withdraw`; this instruction calls `withdraw` twice
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod complete_order; pub use complete_order::*;` (and `mark_in_transit`), alphabetical
- `programs/farmer-core/src/lib.rs` (modified): `complete_order(ctx)` wrapper (and `mark_in_transit(ctx)`)
- `programs/farmer-core/src/errors.rs` (modified): `// ---- Payout` section appended at the end, `FarmerTokenAccountMismatch` 6030 and `LogisticsTokenAccountMismatch` 6031; this instruction also raises the pre-existing `UnauthorizedOperator` 6010, `WarehouseMismatch` 6011, `MathOverflow` 6024, `MintMismatch` 6025, `InvalidOrderStatus` 6028
- `programs/farmer-core/src/events.rs` (modified): `OrderInTransit` and `OrderCompleted` appended (README 9 shapes); this instruction emits `OrderCompleted`
- `programs/farmer-core/src/states.rs` (unchanged in M5): reads `ProgramConfig.logistics_wallet`, `Order`, `OrderStatus::{InTransit, Fulfilled}`, `Warehouse.operator`, `SEED_CONFIG`, `SEED_ESCROW`; no layout change, `Order` stays 227 bytes

Tests
- `tests/complete_order.ts` (created): pickup payout with event and balances, delivery fee added to the logistics payout, zero-fee warehouse pays the farmer everything, not in transit, wrong signer, farmer account owned by someone else, logistics account owned by someone else, already fulfilled
- `tests/mark_in_transit.ts` (created, M5): proves `refuse_delivery` and `reject_delivery_fee` return `InvalidOrderStatus` once `InTransit`
- `tests/helpers.ts` (modified): `createWarehouse(operator, id, feeBps = 250)` gains the fee parameter; `ataOf(owner)`, `quoteFee`, `acceptFee`, `markInTransit`, `readyOrder` added
- `tests/flow_order.ts` (modified): two steps appended, `mark_in_transit` then `complete_order` with `FEE = 750_000`; asserts farmer `SUBTOTAL - SERVICE_FEE`, logistics `+ SERVICE_FEE + FEE`, escrow 0, customer `start - SUBTOTAL - FEE`, status `fulfilled`

Docs
- `LLM/instructions/complete_order/HOW_IT_WORKS.md`
- `LLM/instructions/complete_order/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/complete_order/IMPLEMENTATION_SUMMARY.md`
- `AGENTS.md` (modified): helper list gains `quoteFee`, `acceptFee`, `readyOrder`, `markInTransit`, `ataOf(owner)`
- `README.md` section 8.6 and `docs/DEVELOPMENT_PLAN.md` M5 entry: unchanged, the implementation follows them

## Decisions

- Signer is the operator, gated by `warehouse has_one = operator` with `order has_one = warehouse` (README 12 "completion").
- Single accepted status `InTransit` as a constraint on `order` (README 6, README 12 "Escrow release only from `IN_TRANSIT`"); `EscrowedReady` and `Fulfilled` are rejected, so no double release.
- Payouts computed from the order (`subtotal_minor - service_fee_minor`, `service_fee_minor + delivery_fee_minor`) with `checked_sub` / `checked_add` -> `MathOverflow`; `escrow.amount` is never the basis, any surplus stays in the escrow.
- Destinations picked by the operator, constrained to `owner == order.farmer` / `owner == config.logistics_wallet` plus `token::mint = mint`: neither payee signs, so `token::authority` is unavailable; any token account of the mint owned by the payee works.
- Two new errors in an appended `// ---- Payout` section (6030, 6031) so the client sees which destination is wrong and existing codes never shift.
- Logistics destination validated against `config.logistics_wallet` at completion time; the order does not store it and `config` is loaded read-only.
- Payout accounts must exist: no ATA creation, no associated-token program, no payer; clients prepend `createAssociatedTokenAccountIdempotent`.
- Zero amounts go through `transfer_checked` unconditionally (no branch); proven by the `fee_bps` 0 test.
- Both CPIs signed by the program with `[SEED_ESCROW, order, order.escrow_bump]`, `mint.decimals` from the `has_one`-pinned `mint`.
- Escrow not closed (M6 closes escrows and returns rent to the customer on every terminal path); no pause gate, no `expires_at` check, no stock change.
- `OrderCompleted` emitted after the status write with every amount (README 9), for the indexer and katubaya inventory reconciliation.
- Gates are `#[account]` constraints only; the handler has no `require!` and no args.

## Prerequisites

- `ProgramConfig` from `init_config`, whose `logistics_wallet` owns the logistics payout account
- A `Warehouse` whose `operator` keypair signs; it is not `mut` and nothing is created, so it needs no lamports (the provider wallet pays the fee in tests)
- An `Order` in `InTransit` via `mark_in_transit`: a pickup order from `EscrowedPickup`, or a delivery order from `EscrowedReady` (after `quote_delivery_fee` + `accept_delivery_fee`)
- The escrow token account at `["escrow", order]` holding `subtotal_minor + delivery_fee_minor`, as left by those instructions
- Two existing token accounts of `order.mint`: one owned by `order.farmer`, one owned by `config.logistics_wallet` (`ataOf` in tests); the program does not create them
- No pause or expiry requirement

## History

- 2026-10-17 M5: created
