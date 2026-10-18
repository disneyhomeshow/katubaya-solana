# expire_order

## Purpose

Anyone sends `expire_order` on an order whose `expires_at` has passed while it still waits pre-transit. The
instruction refunds the whole escrow balance to a token account owned by the order's customer, closes the emptied
escrow token account and returns its rent to the customer, restores `offer.qty_remaining`, sets the order to
`Expired` and emits `OrderExpired`. It implements README.md section 8.7 "Timeouts / expirations" (callable by anyone
after `expires_at`, no signer at all; refund escrow; restore stock; status `EXPIRED`), the stock-restoration rule of
section 12 ("on any cancellation/refusal/expiry before completion, restore stock") and the escrow layout of section
5.8. Section 7 is not involved: nothing is paid to the farmer or the logistics wallet on an expiry.

It is permissionless because escrowed money must not stay hostage to an idle counterparty. Every pre-transit state
waits on somebody else: `EscrowedPickup` and `EscrowedReady` on the warehouse's transport (`mark_in_transit`),
`PendingDeliveryQuote` on the operator's quote, `DeliveryQuoted` on the customer's answer. Nothing obliges that party
to act, and the other exits are narrow: `refuse_delivery` is the operator's and only for delivery orders,
`reject_delivery_fee` is the customer's and only from `DeliveryQuoted`, so a pickup order left in `EscrowedPickup` has
no exit at all and its tokens plus the escrow rent would stay locked forever. The expiry is a fact of the clock, not a
decision, so the program asks for no authority: whoever pays the transaction fee may trigger it, and the money can
only go back to `order.customer`, no matter who sends it.

## Lifecycle

```mermaid
sequenceDiagram
    participant Any as Anyone (client, fee payer only)
    participant Pg as farmer_core::expire_order
    participant O as Order (PDA, mut)
    participant LO as LotOffer (PDA, mut)
    participant CTA as Customer token account (mut)
    participant ES as Escrow token account (PDA, mut)
    participant CU as Customer wallet (SystemAccount, mut)
    participant TP as Token program

    Any->>Pg: expireOrder() with order, customerTokenAccount, tokenProgram
    Note over Any,Pg: no Signer field in the struct: no account of the order signs anything
    Pg->>O: deserialize order, offer, mint, customer token account, escrow, customer
    Note over Pg,ES: escrow already closed by a terminal path -> AccountNotInitialized (3012)
    Pg->>O: has_one offer, has_one mint, has_one customer
    Note over Pg,O: fail -> OfferMismatch (6026), MintMismatch (6025), UnauthorizedCustomer (6027)
    Pg->>O: constraint status in EscrowedPickup, PendingDeliveryQuote, DeliveryQuoted, EscrowedReady
    Note over Pg,O: fail -> InvalidOrderStatus (6028)
    Pg->>CTA: constraint owner == order.customer, then token::mint = mint
    Note over Pg,CTA: fail -> UnauthorizedCustomer (6027), then ConstraintTokenMint (Anchor 2014)
    Pg->>ES: seeds escrow + order key, bump = order.escrow_bump
    Note over Pg,ES: wrong address -> ConstraintSeeds (2006)
    Pg->>Pg: require Clock::get().unix_timestamp strictly after order.expires_at
    Note over Pg,O: fail -> OrderNotExpired (6032); the exact expires_at second still fails
    Pg->>TP: transfer_checked(escrow to customer token account, escrow.amount, mint.decimals) signed with the escrow seeds
    TP-->>CTA: balance + escrow.amount
    Pg->>TP: close_account(escrow to customer) signed with the escrow seeds
    TP-->>ES: account gone
    TP-->>CU: lamports + the escrow rent
    Pg->>LO: qty_remaining = qty_remaining checked_add order.qty
    Note over Pg,LO: overflow -> MathOverflow (6024)
    Pg->>O: status = Expired
    Pg-->>Any: emit OrderExpired(order), Ok
```

Every gate except the clock is an `#[account]` constraint; the single `require!` is the `expires_at` comparison,
which no constraint can express because it needs `Clock::get()`. The two CPIs run before the state writes, so a
failed transfer or close leaves the order and the offer untouched.

## Components

| Instruction | Signer | Accounts (name, role, client resolution) | Args | Events |
|---|---|---|---|---|
| `expire_order` | none (the struct has no `Signer`; the transaction's fee payer is the only wallet involved and it spends nothing but the fee) | `order` (mut, status gate + source of `customer`, `qty`, `expires_at`, `escrow_bump`; must pass), `offer` (mut, stock restored; IDL `relations: ["order"]`), `mint` (read, `transfer_checked` decimals; IDL `relations: ["order"]`), `customer_token_account` (mut, refund destination owned by `order.customer`; caller picks it, must pass), `escrow` (mut, source of the refund, then closed; IDL `pda`, seeds from `order`), `customer` (mut `SystemAccount`, escrow rent destination; IDL `relations: ["order"]`), `token_program` (must pass, `TOKEN_PROGRAM_ID` in tests) | none | `OrderExpired { order }` |

Handler: `programs/farmer-core/src/instructions/expire_order.rs`; token CPIs: `escrow::withdraw` and `escrow::close`
in `programs/farmer-core/src/escrow.rs`; wrapper: `farmer_core::expire_order` in
`programs/farmer-core/src/lib.rs`.

## Data model

Mutated: `Order` (seeds `["order", offer, customer, order_id u64 LE]`, 8 + INIT_SPACE = 227 bytes): only `status`
changes, to `Expired`; `expires_at` keeps the value that triggered the expiry, so the account still records when the
window closed. `LotOffer`: `qty_remaining += order.qty` (checked). Escrow token account (seeds
`["escrow", order]`, 165-byte SPL token account, its own authority): emptied, then closed. Customer token account:
balance + the escrow balance. Customer wallet: lamports + the escrow rent (~0.00149 SOL for a 165-byte account),
which the customer paid at `create_order`.

| Status at expiry | `expires_at` last set by | Window | Escrow balance refunded |
|---|---|---|---|
| `EscrowedPickup` | `create_order` (pickup) | `EXPIRY_PICKUP_SECS` = 72 h | `subtotal_minor` |
| `PendingDeliveryQuote` | `create_order` (delivery) | `EXPIRY_PENDING_QUOTE_SECS` = 6 h | `subtotal_minor` |
| `DeliveryQuoted` | `quote_delivery_fee` | `EXPIRY_QUOTED_SECS` = 6 h | `subtotal_minor` |
| `EscrowedReady` | `accept_delivery_fee` | `EXPIRY_PICKUP_SECS` = 72 h | `subtotal_minor + delivery_fee_minor` |

Each of those three instructions writes `now + window`, so the clock restarts on every transition and a counterparty
that answers keeps the order alive. `mark_in_transit` does not touch `expires_at`, and `InTransit` is outside this
instruction's status set, so a locked transport never expires. Read: `Mint` for `decimals`.
Not touched: `ProgramConfig` (no pause gate), `Warehouse`, `WarehouseCustomer`, `FarmerProfile`, `CustomerProfile`.

## Design decisions

- **No signer at all.** `ExpireOrder` declares no `Signer` field, so the expiry needs no authority: a crank, the
  customer, the operator or a stranger can all send it. Verified by `tests/expire_order.ts`, which never calls
  `.signers(...)`, and by `tests/expire_order_clock.ts`, whose fee payer is a freshly generated keypair unrelated to
  the order.
- **Four accepted statuses via `matches!`.** `EscrowedPickup | PendingDeliveryQuote | DeliveryQuoted |
  EscrowedReady`: every state in which the escrow is funded and the order is still waiting on somebody.
  `InTransit` is excluded because the goods are already moving and the warehouse owns the outcome (README 6:
  `FULFILLED` only from `IN_TRANSIT`); `Fulfilled`, `Refused`, `Canceled` and `Expired` are excluded because they are
  terminal and their escrow is already settled. Verified by "rejects an order already in transit".
- **Strict `>` on `expires_at`, checked in the handler.** `require!(now > order.expires_at, OrderNotExpired)`: the
  exact `expires_at` second is still inside the window, and `tests/expire_order_clock.ts` pins both sides, rejecting
  `EXPIRES_AT` and accepting `EXPIRES_AT + 1`. It is the handler's only `require!` because `Clock::get()` cannot run
  in an `#[account]` constraint, and it runs after every account gate, so a wrong offer or a bad destination reports
  its own error even on an order that is not yet expired.
- **Refund `escrow.amount`, not a recomputed sum.** One path covers all four statuses and always moves the real
  balance, subtotal with or without an accepted delivery fee (AGENTS.md "escrow.rs").
- **Tokens to the customer's token account, rent to the customer's wallet.** The caller picks
  `customer_token_account`, and `constraint = customer_token_account.owner == order.customer` keeps the money with
  the customer; the rent destination is the `customer` account itself, pinned by `has_one = customer` on the order.
  Neither is a signer. The rent destination is therefore exact, while the token destination is only pinned to the
  customer's ownership: a stranger triggering the expiry can route the refund into a different token account of the
  customer's (one it created for them, say) but cannot take it out of the customer's hands. Verified by "rejects a
  refund destination not owned by the customer".
- **Escrow closed, rent returned.** `escrow::close` (new in M6) runs right after the withdrawal, so the emptied
  token account does not leak the customer's rent. The consequence is intentional: after any terminal path the escrow
  no longer exists, so a replayed `expire_order` fails at account deserialization with `AccountNotInitialized` (3012)
  instead of `InvalidOrderStatus`. The status gate still answers whenever the escrow is alive.
- **No pause gate.** `config` is not an account here, so an expiry refund stays possible while the market is paused;
  among the order instructions only `create_order` and `complete_order` load `config`.
- **Token-2022 transfer-fee mints are unsupported.** A transfer fee is withheld on the receiving account, so the
  escrow would hold less than the subtotal and `close_account` would fail with `AccountHasWithheldTransferFees`.
  The only control is `allowed_mints`, set once at `init_config`; the program does not inspect mint extensions
  (README 11).

## Source

- `programs/farmer-core/src/instructions/expire_order.rs`
- `programs/farmer-core/src/escrow.rs`
- `programs/farmer-core/src/states.rs`
- `programs/farmer-core/src/errors.rs`
- `programs/farmer-core/src/events.rs`
- `programs/farmer-core/src/lib.rs`
- `tests/expire_order.ts`
- `tests/expire_order_clock.ts`
- `tests/helpers.ts`
