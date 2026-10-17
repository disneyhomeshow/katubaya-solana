# mark_in_transit: change log

## Files

Program
- `programs/farmer-core/src/instructions/mark_in_transit.rs` (created): `MarkInTransit` + handler
- `programs/farmer-core/src/instructions/mod.rs` (modified, M5): `pub mod mark_in_transit; pub use mark_in_transit::*;` (alphabetical, between `init_config` and `publish_offer`)
- `programs/farmer-core/src/lib.rs` (modified, M5): `mark_in_transit(ctx)` wrapper (with the sibling `complete_order(ctx)`)
- `programs/farmer-core/src/errors.rs` (modified, M5): Payout section appended, `FarmerTokenAccountMismatch` 6030 and `LogisticsTokenAccountMismatch` 6031, both for `complete_order`; this instruction raises only the pre-existing `UnauthorizedOperator` 6010, `WarehouseMismatch` 6011, `InvalidOrderStatus` 6028
- `programs/farmer-core/src/events.rs` (modified, M5): `OrderInTransit` (emitted here) and `OrderCompleted` appended
- `programs/farmer-core/src/states.rs`, `programs/farmer-core/src/escrow.rs`: unchanged in M5 (`Order` stays 227 bytes; no token CPI here)

Tests
- `tests/mark_in_transit.ts` (created): pickup happy path with event and status, delivery happy path, pending delivery, quoted-not-accepted delivery, wrong signer, already in transit, refuse/reject blocked after transit
- `tests/helpers.ts` (modified, M5): `quoteFee`, `acceptFee`, `markInTransit`, `readyOrder`, `ataOf`; `createWarehouse` gained `feeBps = 250`
- `tests/flow_order.ts` (modified, M5): "warehouse marks the order in transit" and "warehouse completes" steps appended after accept; asserts `{ inTransit: {} }`, then farmer `SUBTOTAL - SERVICE_FEE`, logistics `+ SERVICE_FEE + FEE`, escrow 0, customer `start - SUBTOTAL - FEE`, status `{ fulfilled: {} }`
- `tests/complete_order.ts` (created, M5): calls `markInTransit` before every completion except the "rejects an order that is not in transit" case

Docs
- `LLM/instructions/mark_in_transit/HOW_IT_WORKS.md`
- `LLM/instructions/mark_in_transit/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/mark_in_transit/IMPLEMENTATION_SUMMARY.md`
- `AGENTS.md` (modified, M5): helper list gained `quoteFee`, `acceptFee`, `readyOrder`, `markInTransit`, `ataOf(owner)`
- `README.md` 8.6 and `docs/DEVELOPMENT_PLAN.md` M5 entry: unchanged, they already specified the instruction

## Decisions

- One `matches!` on `(fulfillment_mode, status)` accepting `(Pickup, EscrowedPickup) | (Delivery, EscrowedReady)` -> `InvalidOrderStatus` (README 8.6 per-mode requirement); both modes are legal, so no `NotDeliveryOrder`.
- Signer checked through `order has_one = warehouse` and `warehouse has_one = operator`; `Order` never stores the operator (README 12).
- `WarehouseMismatch` (6011, Farmer section) reused for the wrong warehouse; variants are only appended.
- Only `status` is written; `expires_at` untouched (no expiry constant for `InTransit`; `expire_order` lands in M6).
- No `config` account, so no pause gate; the gate stays on `publish_offer` and `create_order`.
- No token CPI and no rent: `operator` is a plain `Signer`; the escrow balance moves only at `complete_order`.
- Lock semantics come from the status gates of `refuse_delivery` and `reject_delivery_fee` (exclude `InTransit`) and `complete_order` (requires it); asserted in `tests/mark_in_transit.ts` and `tests/complete_order.ts`.
- `emit!(OrderInTransit { order })` after the write, README 9 shape.
- Tests cover each named error reachable with one fixture; `WarehouseMismatch` and framework errors are not exercised.

## Prerequisites

- A `Warehouse` created by the admin via `create_warehouse`, whose `operator` keypair signs; it is not `mut` and needs no lamports (the provider wallet pays the fee in tests)
- An `Order` in `EscrowedPickup` (pickup, straight from `create_order`) or `EscrowedReady` (delivery, after `quote_delivery_fee` and `accept_delivery_fee`; `readyOrder(m)` in tests); the account key is passed explicitly, the client cannot derive it here
- The escrow at `["escrow", order]` holds the subtotal (plus the accepted fee); it is neither read nor touched
- `ProgramConfig`, the mint and token accounts are not read; no pause or expiry requirement

## History

- 2026-10-17 M5: created
