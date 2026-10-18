# complete_order

## Purpose

The warehouse operator signs to complete an order that is `InTransit`. The instruction releases the escrow in two
`transfer_checked` CPIs signed by the program: `subtotal_minor - service_fee_minor` to a token account owned by
`order.farmer`, then everything the escrow still holds to a token account owned by `config.logistics_wallet`; it
closes the emptied escrow token account and returns its rent to `order.customer`, sets the order to `Fulfilled` and
emits `OrderCompleted`. It implements README.md section 8.6 "Warehouse completes order (releases escrow)", the
section 6 rules "`FULFILLED` can only be reached from `IN_TRANSIT`" and "Warehouse controls `IN_TRANSIT` and
`FULFILLED`", the section 7 payout formulas (fees to `logistics_wallet`, `farmer_payout = subtotal_minor -
service_fee_minor`), the section 8.7 rule that every terminal path closes the escrow and refunds its rent to the
customer, and the section 12 rules (operator match for completion, "Escrow release only from `IN_TRANSIT`").

## Lifecycle

```mermaid
sequenceDiagram
    participant Op as Operator (client, signer)
    participant Pg as farmer_core::complete_order
    participant C as ProgramConfig (PDA, read)
    participant O as Order (PDA, mut)
    participant W as Warehouse (PDA, read)
    participant FTA as Farmer token account (mut)
    participant LTA as Logistics token account (mut)
    participant ES as Escrow token account (PDA, mut)
    participant Cu as Customer wallet (SystemAccount, mut)
    participant TP as Token program

    Op->>Pg: completeOrder() with order, warehouse, mint, farmerTokenAccount, logisticsTokenAccount, operator, tokenProgram (config, escrow and customer from the IDL)
    Note over Op,Pg: operator missing from .signers -> "Signature verification failed" (web3.js, tx never sent)
    Pg->>C: deserialize the ten accounts in field order (config, order, warehouse, mint, both payout accounts, escrow, customer, operator, token program)
    Note over Pg,Cu: a data account with no data -> AccountNotInitialized (3012); on a replay the escrow is already closed and fails here, before the status gate
    Note over Pg,Cu: customer not owned by the system program -> AccountNotSystemOwned (3011)
    Pg->>C: seeds config
    Note over Pg,C: wrong address -> ConstraintSeeds (2006), resolved from the IDL
    Pg->>O: has_one warehouse, has_one mint, has_one customer
    Note over Pg,O: fail -> WarehouseMismatch (6011), MintMismatch (6025), UnauthorizedCustomer (6027)
    Pg->>O: constraint status == InTransit
    Note over Pg,O: fail -> InvalidOrderStatus (6028)
    Pg->>W: has_one operator
    Note over Pg,W: fail -> UnauthorizedOperator (6010)
    Pg->>FTA: constraint owner == order.farmer, then token::mint = mint
    Note over Pg,FTA: fail -> FarmerTokenAccountMismatch (6030), then ConstraintTokenMint (2014)
    Pg->>LTA: constraint owner == config.logistics_wallet, then token::mint = mint
    Note over Pg,LTA: fail -> LogisticsTokenAccountMismatch (6031), then ConstraintTokenMint (2014)
    Pg->>ES: seeds escrow + order key, bump = order.escrow_bump
    Note over Pg,ES: wrong address -> ConstraintSeeds (2006)
    Pg->>Pg: farmer_payout = subtotal_minor checked_sub service_fee_minor
    Pg->>Pg: logistics_payout = escrow.amount checked_sub farmer_payout
    Note over Pg: underflow -> MathOverflow (6024)
    Pg->>TP: transfer_checked(escrow to farmer token account, farmer_payout) signed with the escrow seeds
    TP-->>FTA: balance + farmer_payout
    Pg->>TP: transfer_checked(escrow to logistics token account, logistics_payout) signed with the escrow seeds
    TP-->>LTA: balance + logistics_payout
    TP-->>ES: balance 0
    Pg->>TP: close_account(escrow, destination customer) signed with the escrow seeds
    TP-->>ES: account closed
    TP-->>Cu: lamports + the escrow rent
    Pg->>O: status = Fulfilled
    Pg-->>Op: emit OrderCompleted(order, subtotal_minor, service_fee_minor, delivery_fee_minor, farmer_payout, logistics_payout), Ok
```

Every gate is an `#[account]` constraint; the handler has no `require!`. The three CPIs run before the status write.

## Components

| Instruction | Signer | Accounts (name, role, client resolution) | Args | Events |
|---|---|---|---|---|
| `complete_order` | `operator` (the `warehouse.operator` wallet; not `mut`, no lamports move; the provider wallet pays the tx fee in tests) | `config` (read, source of `logistics_wallet`; auto from IDL, const seeds), `order` (mut, status gate + source of `farmer`, amounts, `escrow_bump`; must pass), `warehouse` (read, operator gate; `relations: ["order"]`, still passed explicitly in tests), `mint` (read, `transfer_checked` decimals; `relations: ["order"]`, still passed explicitly in tests), `farmer_token_account` (mut, payout owned by `order.farmer`; must pass), `logistics_token_account` (mut, payout owned by `config.logistics_wallet`; must pass), `escrow` (mut, source of both payouts, closed at the end; auto from IDL, seeds from `order`), `customer` (mut `SystemAccount`, destination of the escrow rent; auto from `relations: ["order"]`, never passed by the tests), `operator` (signer; `relations: ["warehouse"]`, so only the signature is mandatory), `token_program` (must pass, `TOKEN_PROGRAM_ID` in tests) | none | `OrderCompleted { order, subtotal_minor, service_fee_minor, delivery_fee_minor, farmer_payout, logistics_payout }` |

Handler `instructions/complete_order.rs`; both payouts through `escrow::withdraw` and the close through `escrow::close`
(`escrow.rs`); wrapper `farmer_core::complete_order` (`lib.rs`).

## Data model

Mutated: `Order` (seeds `["order", offer, customer, order_id u64 LE]`, 8 + INIT_SPACE = 227 bytes): only `status` changes,
`InTransit -> Fulfilled`; `expires_at` and every other field keep their values (no new expiry window). Read from the order:
`farmer`, `warehouse`, `mint`, `customer`, `subtotal_minor`, `service_fee_minor`, `delivery_fee_minor`, `escrow_bump`.

Token balances and rent (escrow token account at `["escrow", order]`, its own authority):

| Destination | Amount | Test (`SUBTOTAL` 10_000_000, `SERVICE_FEE` 250_000) |
|---|---|---|
| `farmer_token_account` | `subtotal_minor - service_fee_minor` | +9_750_000 (pickup and delivery); +10_000_000 with a `fee_bps` 0 warehouse |
| `logistics_token_account` | `escrow.amount - farmer_payout`, i.e. the whole remainder | +250_000 (pickup); +750_000 with a 500_000 delivery fee; +250_001 with one stray token minted into the escrow; unchanged with `fee_bps` 0 on a pickup |
| escrow | balance to 0, then the account is closed | `escrowClosed(order)` is true after the pickup, delivery, stray-token, flow and Token-2022 tests |
| `customer` (lamports) | the escrow rent, 1_488_440 lamports (~0.00149 SOL) for a 165-byte token account | not asserted here; `tests/refuse_delivery.ts` and `tests/expire_order_clock.ts` assert it for the shared `escrow::close` |

Read: `ProgramConfig` (`logistics_wallet` only; `paused` is not checked), `Warehouse` (`operator`), `Mint` (`decimals`).
Not touched: `LotOffer` (stock reserved at `create_order` is not restored by a sale), `WarehouseCustomer`,
`FarmerProfile`, `CustomerProfile`.

## Design decisions

- **Operator gate through the order's warehouse.** `order has_one = warehouse` plus `warehouse has_one = operator`:
  only the operator of the warehouse stored in the order can complete (README 12 "completion"). Verified by "rejects
  a signer that is not the warehouse operator".
- **Single accepted status, `InTransit`.** README 6 "`FULFILLED` can only be reached from `IN_TRANSIT`" and README 12
  "Escrow release only from `IN_TRANSIT`". `EscrowedReady` is rejected ("rejects an order that is not in transit"), so
  the escrow cannot be released early.
- **Farmer's share from the order, logistics' share from the escrow.** `farmer_payout = subtotal_minor -
  service_fee_minor` is deterministic from fields fixed at creation; `logistics_payout = escrow.amount -
  farmer_payout` is whatever is left, which in every normal case is exactly `service_fee_minor + delivery_fee_minor`,
  the two amounts `create_order` and `accept_delivery_fee` escrowed (README 8.6). Reading the real balance guarantees
  the escrow reaches zero — `close_account` refuses a token account that still holds tokens — and sweeps stray tokens
  sent to the escrow PDA to logistics instead of stranding them: "sweeps a stray token in the escrow to logistics"
  mints 1 unit into the escrow and asserts a `logistics_payout` of `SERVICE_FEE + 1`. `checked_sub` twice, mapped to
  `MathOverflow`.
- **Escrow closed, rent back to the customer.** `escrow::close` (`close_account` CPI, the escrow its own authority,
  signed with `[SEED_ESCROW, order, order.escrow_bump]`) sends the ~0.00149 SOL of rent to the `customer`
  `SystemAccount`, who paid it at `create_order`; `has_one = customer @ UnauthorizedCustomer` pins that destination so
  the operator cannot redirect it. The same close runs on all four terminal paths (`reject_delivery_fee`,
  `refuse_delivery`, `expire_order`, this one), README 8.7.
- **A replayed completion fails on account resolution, not on the status gate.** With the escrow gone, a second
  `complete_order` fails at deserialization with `AccountNotInitialized` (3012) before any constraint runs ("rejects a
  second completion: the escrow is gone"). The `InTransit` gate still answers for every order whose escrow is alive
  ("rejects an order that is not in transit").
- **Not compatible with a transfer-fee Token-2022 mint.** Such a mint withholds the fee on the receiving account, so
  the escrow would hold less than the subtotal: the logistics payout would silently absorb the shortfall (or underflow
  to `MathOverflow` once the withheld amount exceeds the fees in the escrow) and `close_account` would fail with
  `AccountHasWithheldTransferFees`. The only control is `allowed_mints`, set once at `init_config`; the program does
  not inspect mint extensions (README 11). A plain Token-2022 mint is fine: `tests/token2022.ts` runs one end to end.
- **Operator picks the destinations, owner checks keep the money with the payees.** Neither payee signs, so
  `token::authority` is unavailable; `constraint = owner == order.farmer @ FarmerTokenAccountMismatch` (6030) /
  `owner == config.logistics_wallet @ LogisticsTokenAccountMismatch` (6031), both with `token::mint = mint`, accept any
  token account of the order's mint owned by the right wallet (not only the ATA), and tell the client which one is
  wrong; the two codes form a `// ---- Payout` section appended to `FarmerCoreError`, one test each.
- **Logistics destination validated against `config.logistics_wallet` at completion time.** The order never stores
  the logistics wallet; `config` is loaded read-only (const seeds, resolved by the client from the IDL) so the
  current wallet is the authority (README 7 "paid to `logistics_wallet`").
- **Payout accounts must already exist, zero amounts included.** No ATA creation, no associated-token program and no
  payer: the only lamports that move are the escrow rent, and a missing account fails with `AccountNotInitialized`
  (the tests call `ataOf(owner)` first, clients prepend `createAssociatedTokenAccountIdempotent`). There is no branch
  on either payout, and the `fee_bps` 0 pickup test proves a `transfer_checked` of 0 succeeds.
- **No pause gate, no expiry check.** `config.paused` is not read (the gate stays on `publish_offer` and
  `create_order`, AGENTS.md "Validation Rules"); transitions never read `expires_at`, and `InTransit` is outside the
  status set of `expire_order`, so an in-transit order can no longer be expired out from under the operator.
- **Event carries every amount.** `OrderCompleted` (README 9) reports the payouts actually made, so the indexer and
  katubaya's inventory reconciliation record the sale without fetching the order.

## Source

- `programs/farmer-core/src/instructions/complete_order.rs`
- `programs/farmer-core/src/escrow.rs`
- `programs/farmer-core/src/states.rs`
- `programs/farmer-core/src/errors.rs`
- `programs/farmer-core/src/events.rs`
- `programs/farmer-core/src/lib.rs`
- `tests/complete_order.ts`
- `tests/helpers.ts`
- `tests/flow_order.ts`
- `tests/token2022.ts`
- `tests/expire_order_clock.ts` (rent landing on the customer, for the shared `escrow::close`)
