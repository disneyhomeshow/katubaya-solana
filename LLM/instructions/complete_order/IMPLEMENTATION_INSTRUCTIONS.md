# complete_order: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/complete_order.rs` | `CompleteOrder` accounts struct and handler |
| `programs/farmer-core/src/escrow.rs` | `withdraw(token_program, escrow, mint, to, order, bump, amount)`: `transfer_checked` signed with the escrow seeds; called twice |
| `programs/farmer-core/src/lib.rs`, `instructions/mod.rs` | `#[program]` wrapper `complete_order(ctx)`; `pub mod complete_order; pub use complete_order::*;` |
| `programs/farmer-core/src/states.rs` | `ProgramConfig`, `Order`, `OrderStatus`, `Warehouse`, `SEED_CONFIG`, `SEED_ESCROW` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{WarehouseMismatch, MintMismatch, InvalidOrderStatus, UnauthorizedOperator, FarmerTokenAccountMismatch, LogisticsTokenAccountMismatch, MathOverflow}` |
| `programs/farmer-core/src/events.rs` | `OrderCompleted` |
| `tests/complete_order.ts` | Pickup payout with event, delivery fee added to logistics, zero-fee warehouse, not in transit, wrong signer, wrong farmer account, wrong logistics account, already fulfilled |
| `tests/helpers.ts` | `market`, `createOrder`, `readyOrder`, `markInTransit`, `ataOf`, `tokenBalance`, `escrowPDA`, `testMint`, `logisticsWallet`, `fails`, `events`, `SUBTOTAL`, `SERVICE_FEE`; for the zero-fee case `fund`, `createWarehouse(operator, id, feeBps)`, `approvedFarmer`, `publishOffer`, `confirmedCustomer` |
| `tests/flow_order.ts` | Last step of the end-to-end delivery flow (`FEE` 750_000), final balances asserted |
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

    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
```

Client resolution: `config` (const seeds) and `escrow` (seeds from `order`) resolve from the IDL; `order` (no seeds in the struct),
`warehouse`, `mint` (`testMint()`), `farmer_token_account` (`ataOf(m.farmer.publicKey)`), `logistics_token_account` (`ataOf(logisticsWallet)`),
`token_program` (`TOKEN_PROGRAM_ID`; SPL Token or Token-2022) and `operator` go through `.accountsPartial`, plus `.signers([operator])`.
IDL `relations`: `warehouse`, `mint` from `order`; `operator` from `warehouse`. `mint` has no constraint of its own: `order.has_one = mint` pins it.

## Arguments

None: `complete_order(ctx: Context<CompleteOrder>)`. Both amounts come from the order.

## Account layout

`Order` (`programs/farmer-core/src/states.rs`, 8 + INIT_SPACE = 227 bytes): read `farmer`, `warehouse`, `mint`, `subtotal_minor`,
`service_fee_minor` (fixed at creation: `subtotal * fee_bps / 10_000`), `delivery_fee_minor` (0 until quoted), `escrow_bump`; written
`status` only (`InTransit -> Fulfilled`, TS `{ fulfilled: {} }`). `ProgramConfig.logistics_wallet: Pubkey` is read. Seeds:
`SEED_ESCROW = b"escrow"` + order key, `SEED_CONFIG = b"config"`. No account layout changed in M5.

## Errors

| Error | Code | Raised when |
|---|---|---|
| `InvalidOrderStatus` | 6028 | `order.status != InTransit` (tests: "rejects an order that is not in transit" from `EscrowedReady`, "rejects an order already fulfilled") |
| `UnauthorizedOperator` | 6010 | `warehouse.operator != operator` (test: "rejects a signer that is not the warehouse operator") |
| `FarmerTokenAccountMismatch` | 6030 | `farmer_token_account.owner != order.farmer` (test: "rejects a farmer token account owned by someone else", the logistics ATA passed as farmer account) |
| `LogisticsTokenAccountMismatch` | 6031 | `logistics_token_account.owner != config.logistics_wallet` (test: "rejects a logistics token account owned by someone else", the farmer ATA passed as logistics account) |
| `WarehouseMismatch` / `MintMismatch` / `MathOverflow` | 6011 / 6025 / 6024 | `order.warehouse` or `order.mint` differs from the account passed / `subtotal_minor - service_fee_minor` underflows (impossible with `fee_bps <= 10_000`) or `service_fee_minor + delivery_fee_minor` overflows (needs an escrowed fee near `u64::MAX`); none exercised |
| `ConstraintTokenMint` / `ConstraintSeeds` / `AccountNotInitialized` (Anchor); "Signature verification failed" (web3.js) | 2014 / 2006 / 3012; n/a | payout account of another mint owned by the right wallet / `config` or `escrow` at the wrong address (the client derives both from the IDL) / a payout token account (or any data account) does not exist; `operator` in `accountsPartial` but missing from `.signers` (tx never sent); none exercised |

## Events

`OrderCompleted { order: Pubkey, subtotal_minor, service_fee_minor, delivery_fee_minor, farmer_payout, logistics_payout: u64 }` (`events.rs`,
README 9 shape), emitted after the status write. The pickup test reads it with `events(complete(order))` (`tests/helpers.ts`: rpc at commitment
`confirmed`, logs decoded by `anchor.EventParser`) and asserts the only event is `orderCompleted` (camelCase), `data.order` = the order PDA,
`BN` fields `subtotalMinor` 10_000_000, `serviceFeeMinor` 250_000, `deliveryFeeMinor` 0, `farmerPayout` 9_750_000, `logisticsPayout` 250_000.

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
`logisticsAta = await ataOf(logisticsWallet)`. `inTransitPickup()` = `createOrder(..., "pickup")` + `markInTransit(order, m)`; delivery: `readyOrder(m, 500_000)` + `markInTransit`. `tests/flow_order.ts` issues the same call with `FEE = 750_000`.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): the nine accounts deserialize in field order, then constraints run in field
  order: `config` (seeds), `order` (`has_one` warehouse, mint, then status), `warehouse` (`has_one = operator`), `farmer_token_account`
  (raw owner constraint, then `token::mint`: anchor-syn linearizes `token_account` after `raw`), `logistics_token_account` (same),
  `escrow` (seeds + bump). Both wrong-destination tests swap ATAs of the same mint, so they do not pin the raw-before-`token::mint` order.
- CPIs: `token_interface::transfer_checked` via `CpiContext::new_with_signer`, `from` and `authority` both the escrow, signer seeds
  `[SEED_ESCROW, order.key(), [order.escrow_bump]]`, `decimals = mint.decimals`. Zero amounts are sent unconditionally (the `fee_bps` 0
  pickup test moves 0 to the logistics account). An escrow surplus would stay, a shortfall would fail inside the token program; neither is reachable here.
- `config.paused` is loaded but not checked; `expires_at` is not read; `LotOffer` is not an account (no stock change on completion).
- Untested branches: `WarehouseMismatch`, `MintMismatch`, `MathOverflow`, `ConstraintTokenMint`, missing payout account, missing signer.
