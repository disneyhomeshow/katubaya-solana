# complete_order: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/complete_order.rs` | `CompleteOrder` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `withdraw(token_program, escrow, mint, to, order, bump, amount)`: `transfer_checked` signed with the escrow seeds, called twice; `close(token_program, escrow, destination, order, bump)`: `close_account` signed with the same seeds |
| `programs/farmer-core/src/lib.rs`, `instructions/mod.rs` | `#[program]` wrapper `complete_order(ctx)`; `pub mod complete_order; pub use complete_order::*;` |
| `programs/farmer-core/src/states.rs` | `ProgramConfig`, `Order`, `OrderStatus`, `Warehouse`, `SEED_CONFIG`, `SEED_ESCROW` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, MintMismatch, UnauthorizedCustomer, InvalidOrderStatus, UnauthorizedOperator, FarmerTokenAccountMismatch, LogisticsTokenAccountMismatch, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `OrderCompleted` |
| `tests/complete_order.ts` | Pickup payout with event, delivery fee added to logistics, stray token swept to logistics, zero-fee warehouse, not in transit, wrong signer, wrong farmer account, wrong logistics account, replay after the escrow is closed |
| `tests/helpers.ts` | `market`, `createOrder`, `readyOrder`, `markInTransit`, `ataOf`, `tokenBalance`, `escrowClosed`, `testMint`, `logisticsWallet`, `fails`, `events`, `fund`, `SUBTOTAL`, `SERVICE_FEE`; `provider`, `payer`, `escrowPDA` for the stray-token case; `createWarehouse(operator, id, feeBps)`, `approvedFarmer`, `publishOffer`, `confirmedCustomer` for the zero-fee case |
| `tests/flow_order.ts` | Last step of the end-to-end delivery flow (`FEE` 750_000), final balances asserted |
| `tests/token2022.ts` | One pickup order end to end on the Token-2022 mint: deposit, both payouts and the close through `token_interface` |
| `target/idl/farmer_core.json` | Generated IDL (`config` and `escrow` PDA seeds, `relations`, error codes, event) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct CompleteOrder<'info> {
    #[account(seeds = [SEED_CONFIG], bump)]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        constraint = order.status == OrderStatus::InTransit @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Must already exist; the program does not create payout accounts.
    #[account(
        mut,
        token::mint = mint,
        constraint = farmer_token_account.owner == order.farmer @ FarmerCoreError::FarmerTokenAccountMismatch
    )]
    pub farmer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        constraint = logistics_token_account.owner == config.logistics_wallet @ FarmerCoreError::LogisticsTokenAccountMismatch
    )]
    pub logistics_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    /// Escrow rent goes back to the customer, who paid it at `create_order`.
    #[account(mut)]
    pub customer: SystemAccount<'info>,

    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
```

Client resolution: `config` (const seeds) and `escrow` (seeds from `order`) resolve from the IDL; `warehouse`, `mint` and `customer`
carry `relations: ["order"]` and `operator` `relations: ["warehouse"]`, so the TS client can read them off the fetched `order` — the tests
rely on that for `customer` only and pass `warehouse` and `mint` themselves (one test overrides `warehouse`). Must be passed in any case:
`order` (no seeds in the struct), `farmer_token_account` (`ataOf(m.farmer.publicKey)`), `logistics_token_account` (`ataOf(logisticsWallet)`)
and `token_program` (`TOKEN_PROGRAM_ID`; SPL Token or Token-2022); `operator` resolves from the fetched `warehouse`, but its keypair still
has to go into `.signers` (tests: `.accountsPartial` + `.signers([signer])`). `mint` has no constraint: `order.has_one = mint` pins it.

## Arguments

None: `complete_order(ctx: Context<CompleteOrder>)`. The farmer's amount comes from the order, the logistics amount from the escrow.

## Account layout

`Order` (`programs/farmer-core/src/states.rs`, 8 + INIT_SPACE = 227 bytes): read `farmer`, `warehouse`, `mint`, `customer`,
`subtotal_minor`, `service_fee_minor` (fixed at creation: `subtotal * fee_bps / 10_000`), `delivery_fee_minor` (0 until quoted),
`escrow_bump`; written `status` only (`InTransit -> Fulfilled`, TS `{ fulfilled: {} }`). `ProgramConfig.logistics_wallet: Pubkey`
is read. The escrow token account (`SEED_ESCROW = b"escrow"` + order key, its own authority) is emptied and then closed, its 2_039_280
lamports of rent going to `order.customer`; 165 bytes, the `TokenAccount::LEN` that `create_order`'s `init` uses for SPL Token and for a
Token-2022 mint with no account extensions. Seeds: `SEED_CONFIG = b"config"`. No account layout changed in M6.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `InvalidOrderStatus` | 6028 | `order.status != InTransit` while the escrow is still open (test: "rejects an order that is not in transit" from `EscrowedReady`) |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator` (test: "rejects a signer that is not the warehouse operator") |
| `FarmerTokenAccountMismatch` | 6030 | `farmer_token_account.owner != order.farmer` (test: "rejects a farmer token account owned by someone else", the logistics ATA passed as farmer account) |
| `LogisticsTokenAccountMismatch` | 6031 | `logistics_token_account.owner != config.logistics_wallet` (test: "rejects a logistics token account owned by someone else", the farmer ATA passed as logistics account) |
| `AccountNotInitialized` (Anchor) | 3012 | any data account has no data — in practice a replay: the escrow was closed by the first completion (test: "rejects a second completion: the escrow is gone") |
| `UnauthorizedCustomer` | 6027 | the `customer` account passed is not `order.customer`, i.e. the rent would land elsewhere; only reachable by overriding the IDL-resolved account; not exercised here (the message, shared with the signer and token-account uses, reads "Signer or token account is not the order's customer") |
| `WarehouseMismatch` / `MintMismatch` / `MathOverflow` | 6011 / 6025 / 6024 | `order.warehouse` or `order.mint` differs from the account passed / `subtotal_minor - service_fee_minor` underflows (impossible with `fee_bps <= 10_000`) or `escrow.amount - farmer_payout` underflows (only if the escrow holds less than the farmer's share, e.g. a transfer-fee mint); none exercised |
| `ConstraintTokenMint` / `ConstraintSeeds` / `AccountNotSystemOwned` (Anchor); "Signature verification failed" (web3.js) | 2014 / 2006 / 3011; n/a | payout account of another mint owned by the right wallet / `config` or `escrow` at the wrong address (the client derives both from the IDL) / `customer` not owned by the system program; `operator` in `accountsPartial` but missing from `.signers` (tx never sent); none exercised |

## Events

`OrderCompleted { order: Pubkey, subtotal_minor, service_fee_minor, delivery_fee_minor, farmer_payout, logistics_payout: u64 }` (`events.rs`,
README 9 shape), emitted after the status write, with the amounts actually transferred. The pickup test reads it with `events(complete(order))`
(`tests/helpers.ts`: rpc at commitment `confirmed`, logs decoded by `anchor.EventParser`) and asserts the only event is `orderCompleted`
(camelCase in the TS client), `data.order` = the order PDA, `BN` fields `subtotalMinor` 10_000_000, `serviceFeeMinor` 250_000,
`deliveryFeeMinor` 0, `farmerPayout` 9_750_000, `logisticsPayout` 250_000.

## Client call

```typescript
  const complete = (order: anchor.PublicKey, o: Overrides = {}) => {
    const signer = o.signer ?? m.operator;
    return program.methods
      .completeOrder()
      .accountsPartial({
        order,
        warehouse: o.warehouse ?? m.warehouse,
        mint: testMint(),
        farmerTokenAccount: o.farmerAta ?? farmerAta,
        logisticsTokenAccount: o.logisticsAta ?? logisticsAta,
        operator: signer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer]);
  };
```

From `tests/complete_order.ts` (`Overrides` = optional `signer`, `farmerAta`, `logisticsAta`, `warehouse`). `before`: `m = await market()`
(operator, warehouse `fee_bps` 250, approved farmer, offer qty 500 at 1_000_000, customer with 100_000_000), `farmerAta = await ataOf(m.farmer.publicKey)`,
`logisticsAta = await ataOf(logisticsWallet)`. `inTransitPickup()` = `createOrder(..., "pickup")` + `markInTransit(order, m)`; delivery:
`readyOrder(m, 500_000)` + `markInTransit`. `tests/flow_order.ts` issues the same call with `FEE = 750_000`, `tests/token2022.ts` with
`TOKEN_2022_PROGRAM_ID` and the second allowed mint.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): the ten accounts deserialize in field order — `customer` as a `SystemAccount`,
  which checks system ownership there — then constraints run in field order: `config` (seeds), `order` (`mut`, `has_one` warehouse, mint,
  customer, then the raw status constraint), `warehouse` (`has_one = operator`), `farmer_token_account` (raw owner constraint, then
  `token::mint`: anchor-syn linearizes `token_account` after `raw`), `logistics_token_account` (same), `escrow` (seeds + `mut`), `customer`
  (`mut`). Deserialization comes first, which is why a replay reports the closed escrow (`AccountNotInitialized`, 3012) and never reaches
  the `InTransit` gate. Both wrong-destination tests swap ATAs of the same mint, so they do not pin the raw-before-`token::mint` order.
- Handler: `farmer_payout = order.subtotal_minor.checked_sub(order.service_fee_minor)`, then `logistics_payout =
  ctx.accounts.escrow.amount.checked_sub(farmer_payout)` — the balance as deserialized at entry, so the account ends at exactly zero and
  stray tokens go to logistics (test "sweeps a stray token in the escrow to logistics": 1 unit minted into the escrow PDA,
  `logisticsPayout` = `SERVICE_FEE + 1`); both map `None` to `MathOverflow`.
- CPIs: `token_interface::transfer_checked` via `CpiContext::new_with_signer`, `from` and `authority` both the escrow, signer seeds
  `[SEED_ESCROW, order.key(), [order.escrow_bump]]`, `decimals = mint.decimals`; zero amounts are sent unconditionally (the `fee_bps` 0
  pickup test moves 0 to the logistics account). Then `escrow::close` issues `close_account` with the same signer seeds and
  `destination = ctx.accounts.customer.to_account_info()` — `close` takes an `&AccountInfo`, so this `SystemAccount` and the `Signer` of
  `reject_delivery_fee` both fit. All three run before the status write; a failure aborts with no state change. ~37k CU measured over the
  suite, well inside the 200k default.
- Token-2022: fine on a plain mint (`tests/token2022.ts`), broken on a transfer-fee mint — the fee is withheld on the receiving account, so
  the escrow holds less than the subtotal and `close_account` returns `AccountHasWithheldTransferFees`. `allowed_mints` at `init_config` is
  the only guard; the program does not inspect mint extensions (README 11).
- `config.paused` is loaded but not checked; `expires_at` is not read; `LotOffer` is not an account (no stock change on completion).
  Untested branches: `WarehouseMismatch`, `MintMismatch`, `UnauthorizedCustomer`, `MathOverflow`, `ConstraintTokenMint`,
  `AccountNotSystemOwned`, missing payout account, missing signer.
