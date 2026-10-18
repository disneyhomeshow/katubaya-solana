# refuse_delivery: change log

## Files

Program
- `programs/farmer-core/src/instructions/refuse_delivery.rs` (created M4, modified M6): `RefuseDelivery` + handler; M6 added `has_one = customer @ UnauthorizedCustomer` on `order`, the `customer: SystemAccount` (mut) rent destination and the `escrow::close` call after the refund
- `programs/farmer-core/src/escrow.rs` (created M4, modified M6): `deposit` / `withdraw`, plus `close` (M6: `token_interface::close_account` signed with `[SEED_ESCROW, order, bump]`, destination as `&AccountInfo`); this instruction calls `withdraw` then `close`
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod refuse_delivery; pub use refuse_delivery::*;`
- `programs/farmer-core/src/lib.rs` (modified): `pub mod escrow;` and the `refuse_delivery(ctx)` wrapper
- `programs/farmer-core/src/states.rs` (modified, M4): `Order` (227 B), `FulfillmentMode`, `OrderStatus`, `EXPIRY_*` constants; this instruction reads `SEED_ESCROW`, `FulfillmentMode::Delivery`, `OrderStatus::{PendingDeliveryQuote, DeliveryQuoted, EscrowedReady, Refused}`
- `programs/farmer-core/src/errors.rs` (modified, M4): Order section appended at the end, `CustomerNotConfirmed` 6021 through `NotDeliveryOrder` 6029; this instruction raises `NotDeliveryOrder`, `InvalidOrderStatus`, `UnauthorizedCustomer`, `OfferMismatch`, `MintMismatch`, `MathOverflow` plus the pre-existing `UnauthorizedOperator`, `WarehouseMismatch`. The Payout section (`FarmerTokenAccountMismatch` 6030, `LogisticsTokenAccountMismatch` 6031) came with M5 and M6 appended `OrderNotExpired` 6032, both for other instructions; no code used here shifted
- `programs/farmer-core/src/events.rs` (modified, M4): `OrderRefused` appended (with `OrderCreated`, `DeliveryFeeQuoted`, `DeliveryFeeAccepted`, `DeliveryFeeRejected`); M6 appended `OrderExpired` for `expire_order`, `OrderRefused` itself unchanged
- `programs/farmer-core/Cargo.toml` (modified, M4): `anchor-spl = "0.32.1"`, `idl-build` feature extended with `anchor-spl/idl-build`
- `Cargo.lock` (modified, M4): anchor-spl tree; `blake3` pinned 1.5.5 and `zeroize_derive` 1.4.2 (SBF cargo cannot read edition-2024 crates)

Tests
- `tests/refuse_delivery.ts` (created M4, modified M6): refund from pending (with event, closed escrow and rent landing on the customer wallet), quoted and ready (subtotal + fee) orders asserting customer balance, closed escrow, stock and status; pickup order, wrong signer, destination not owned by the customer, replay rejected with `AccountNotInitialized`
- `tests/mark_in_transit.ts` (M5): "blocks refuse_delivery and reject_delivery_fee once in transit" is now the coverage for this instruction's status constraint, the escrow being alive there
- `tests/helpers.ts` (modified M4, M6): `market`, `confirmedCustomer`, `createOrder` / `createOrderTx`, `fundTokens`, `tokenBalance`, `escrowPDA`, `orderPDA`, `testMint`, `payer`; M6 added `escrowClosed(order)` and `lamports(account)`
- `tests/flow_order.ts` (created M4, extended M5, modified M6): confirm -> publish -> create -> quote -> accept -> transit -> complete, its final assertion now `escrowClosed(order)` instead of a zero escrow balance; does not call `refuse_delivery`
- `package.json` (modified, M4): `@solana/spl-token ^0.4.9` (dev); `tsconfig.json` (modified, M4): `lib` es2015 -> es2020

Docs
- `LLM/instructions/refuse_delivery/HOW_IT_WORKS.md`
- `LLM/instructions/refuse_delivery/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/refuse_delivery/IMPLEMENTATION_SUMMARY.md`
- `README.md` (modified M4, M6): section 5.8 gained `mint`, `escrow_bump` and the escrow-as-own-authority wording; section 8.5 (this instruction) unchanged; M6 added the terminal-path escrow-close paragraph to 8.7 and the Token-2022 transfer-fee warning to 11
- `AGENTS.md` (modified, M4): `escrow.rs` section, token helpers and `market()` in the helper list, "edition2024" and "validator does not look started" entries
- `docs/DEVELOPMENT_PLAN.md` (modified, M4): `escrow.rs` in the tree, "token CPIs only through `escrow.rs`"
- `Anchor.toml` (modified, M4): `[test] startup_wait = 30000`

## Decisions

- Signer is the operator, gated by `warehouse has_one = operator` with `order has_one = warehouse`: the operator of the order's warehouse, nobody else (README 12).
- Accepted statuses `PendingDeliveryQuote | DeliveryQuoted | EscrowedReady` via `matches!` (README 8.5); `InTransit` and terminal states excluded.
- `NotDeliveryOrder` is a separate error declared before the status constraint, so a pickup order (status `EscrowedPickup`) reports its mode, not its status.
- Refund destination chosen by the operator but constrained to `owner == order.customer` (raw constraint, checked first) and `token::mint = mint`: the customer does not sign, so `token::authority = customer` is unavailable.
- Refund amount is `escrow.amount`, the real balance, covering subtotal-only and subtotal + fee with one path (AGENTS.md escrow rule); it also leaves the escrow at exactly zero, which `close_account` requires.
- M6: the emptied escrow is closed and its rent returned to `order.customer`, who paid it at `create_order` — otherwise ~0.00149 SOL stayed locked in a dead token account on every refusal. Rationale for the shape: the customer never signs a refusal, so the destination is a separate `customer: SystemAccount` (mut) pinned by `has_one = customer @ UnauthorizedCustomer` on the order; `SystemAccount` keeps the rent out of a token or program account, and the IDL `relations: ["order"]` means clients do not have to pass it.
- M6 consequence, accepted: with the escrow closed, a replayed refusal fails at deserialization with `AccountNotInitialized` (3012) instead of `InvalidOrderStatus`, because Anchor 0.32 deserializes every non-`init` account before running any constraint. The status gate keeps its own coverage in `tests/mark_in_transit.ts`, where the escrow is still alive.
- Both CPIs sign with `[SEED_ESCROW, order, order.escrow_bump]`; `transfer_checked` with `mint.decimals`, hence `mint` as an account pinned by `has_one`. `escrow::close` is shared with `reject_delivery_fee`, `expire_order` and `complete_order`, which is why its destination is `&AccountInfo`.
- Token-2022 transfer-fee mints would break the close (`AccountHasWithheldTransferFees`) and the payout arithmetic; the only control is `allowed_mints` at `init_config`, the program does not inspect mint extensions (README 11).
- Stock restored with `checked_add` -> `MathOverflow`; status `Refused`; `OrderRefused { order }` emitted after the writes.
- No pause gate (`config` not loaded) and no `expires_at` check: `expire_order` owns the timeout path.
- Gates are `#[account]` constraints only; the handler has no `require!` and no args.
- Tests cover the three refundable statuses and each named error reachable with the fixtures; `has_one` mismatches, overflow and seed errors are not exercised.

## Prerequisites

- An `Order` created by `create_order` with `mode = Delivery`, in `PendingDeliveryQuote` (fresh), `DeliveryQuoted` (after `quote_delivery_fee`) or `EscrowedReady` (after `accept_delivery_fee`); this implies the `ProgramConfig`, the `Warehouse`, an approved farmer's active `LotOffer` and a confirmed customer existed at creation
- The escrow token account at `["escrow", order]` holding the subtotal (plus the accepted fee), as left by those instructions; no other terminal path may have closed it already
- A token account of `order.mint` owned by `order.customer` (the customer's ATA in tests); the program does not create it
- `order.customer` itself as a System-Program-owned account, to receive the escrow rent; it does not sign
- The `warehouse.operator` keypair to sign; it is not `mut` and nothing is created, so it needs no lamports (the provider wallet pays the fee in tests)
- A mint without a Token-2022 transfer fee (enforced only by `config.allowed_mints` at `init_config`)
- No pause or expiry requirement

## History

- 2026-10-17 M4: created
- 2026-10-17 M6: `customer: SystemAccount` + `has_one = customer`, escrow closed and rent refunded, replay now `AccountNotInitialized`
