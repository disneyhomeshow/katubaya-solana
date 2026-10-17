# create_order: change log

## Files

Program
- `programs/farmer-core/src/instructions/create_order.rs` (created): `CreateOrder` + handler
- `programs/farmer-core/src/escrow.rs` (created, M4): `deposit` (used here) and `withdraw`, the only token CPIs; both `transfer_checked` via `anchor_spl::token_interface`
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod create_order; pub use create_order::*;`
- `programs/farmer-core/src/lib.rs` (modified): `pub mod escrow;`, `use crate::states::{FulfillmentMode, ZipPrefix};`, `create_order(ctx, order_id, qty, mode)` wrapper
- `programs/farmer-core/src/states.rs` (modified, M4): `Order`, `FulfillmentMode`, `OrderStatus`, `SEED_ORDER`, `SEED_ESCROW`, `EXPIRY_PENDING_QUOTE_SECS`, `EXPIRY_QUOTED_SECS`, `EXPIRY_PICKUP_SECS` added; `MAX_FEE_BPS`, `SEED_WCUSTOMER` reused
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended at the end, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `CustomerNotConfirmed`, `OfferExpired`, `InsufficientStock`, `MathOverflow`, `MintMismatch` plus the pre-existing `ProgramPaused`, `WarehouseMismatch`, `OfferInactive`, `InvalidQuantity`
- `programs/farmer-core/src/events.rs` (modified, M4): `OrderCreated` (emitted here), `DeliveryFeeQuoted`, `DeliveryFeeAccepted`, `DeliveryFeeRejected`, `OrderRefused` appended; imports `FulfillmentMode`
- `programs/farmer-core/Cargo.toml` (modified, M4): `anchor-spl = "0.32.1"`; `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`
- `Cargo.lock` (modified, M4): anchor-spl tree; `blake3` pinned to 1.5.5 and `zeroize_derive` to 1.4.2 because the SBF cargo (platform-tools v1.48, rustc 1.84.1) cannot read edition-2024 crates

Tests
- `tests/create_order.ts` (created): pickup happy path (event, balances, stock, every field, `escrow_bump`), delivery status + 6 h expiry, pending customer, revoked customer, never-requested customer (`AccountNotInitialized`), inactive offer, expired offer, qty above stock, qty zero, paused (unpause in `finally`), wrong warehouse, wrong mint, insufficient tokens (`0x1`), duplicate id
- `tests/helpers.ts` (modified, M4): real SPL mint in the root `before` (`createMint`, 6 decimals, pushed to `allowedMints` / `config.allowed_mints`), `payer`, `DECIMALS`, `testMint`, `orderPDA`, `escrowPDA`, `fundTokens`, `tokenBalance`, `confirmedCustomer` (registers, confirms and funds an ATA), `Mode`, `Buyer`, `createOrderTx`, `createOrder`, `market`, `SUBTOTAL`, `SERVICE_FEE`, `H6`, `H72`
- `tests/flow_order.ts` (created, M4): confirm -> publish -> create (delivery) -> quote -> accept, asserting escrow and customer balances; M5 extends it through `complete_order`
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev); `yarn.lock` updated
- `tsconfig.json` (modified, M4): `lib` `es2015` -> `es2020` (`getAccount().amount` is a `bigint`)

Docs
- `LLM/instructions/create_order/HOW_IT_WORKS.md`
- `LLM/instructions/create_order/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/create_order/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified, M4): section 5.8 gains `mint` and `escrow_bump` and describes the escrow as a token account that is its own authority; section 8.7 notes the three expiry constants (6 h, 6 h, 72 h)
- `AGENTS.md` (modified, M4): `escrow.rs` in the tree, module list and File Responsibilities; token helpers and order fixtures in Testing Guidelines; Common Errors gains "feature edition2024 is required" and "Test validator does not look started"
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the layout and the "token CPIs only through escrow.rs" rule
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- Args `order_id`, `qty`, `mode` mirror README 8.5; `offer` is an account, not an arg. Explicit `order_id`, no counter, seeds `["order", offer, customer, order_id LE]`; a duplicate fails at `init` ("already in use").
- Escrow is an SPL token account at `["escrow", order]` that is its own authority; `escrow_bump` stored on the order so later withdrawals sign with `[SEED_ESCROW, order, bump]` without re-deriving. Customer pays rent for `Order` (227 bytes) and the escrow (165 bytes); no `close` in M4, so refunds do not reclaim the escrow rent.
- `warehouse_customer` derived from `offer.warehouse` + `customer`, gated by `status == Confirmed`; `warehouse` loaded only for `fee_bps`, bound by `has_one` on the offer (`WarehouseMismatch` reused).
- `mint` is an `InterfaceAccount` constrained to `offer.mint` and copied into the order; `transfer_checked` via `anchor_spl::token_interface` so Token-2022 also works (README 11). Allowlist not re-checked (enforced once in `publish_offer`, README 12).
- Status and expiry by mode: Pickup -> `EscrowedPickup` + 72 h, Delivery -> `PendingDeliveryQuote` + 6 h; `expires_at` is stored, enforced only by `expire_order` (M6).
- Test file covers each named error once; `MathOverflow`, offers without expiry, `fee_bps = 0`, Token-2022 and token-account constraint failures are not exercised. Design rationale: `HOW_IT_WORKS.md`.

## Prerequisites

- `ProgramConfig` created via `init_config` with `paused = false` (or reset through `set_paused`)
- A `Warehouse` (its `fee_bps` sets the service fee) and a `FarmerProfile` approved for it (`set_farmer_warehouse`)
- An active `LotOffer` by that farmer (`publish_offer`) with `qty_remaining >= qty` and `expires_at` in the future or `None`
- A `WarehouseCustomer` for (`offer.warehouse`, customer) in status `Confirmed` (`request_customer_confirmation` + `confirm_customer`; a revoked one must be re-confirmed)
- A token account for `offer.mint` owned by the customer holding at least `qty * price_minor` (tests: `fundTokens` mints into the customer's ATA)
- The customer keypair funded in SOL: it signs, pays rent for the 227-byte `Order` and the 165-byte escrow, and signs the token transfer (tests: `fund()` airdrops 2 SOL)
- `TOKEN_PROGRAM_ID` (or the Token-2022 id matching the mint) passed as `token_program`; an `order_id` not yet used for this offer + customer (`freshId()` in tests)

## History

- 2026-10-17 M4: created
