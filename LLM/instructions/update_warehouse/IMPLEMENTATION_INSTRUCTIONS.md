# update_warehouse: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/update_warehouse.rs` | `UpdateWarehouse` accounts struct and handler |
| `programs/farmer-core/src/instructions/create_warehouse.rs` | the bounds this instruction re-runs, and the only writer of `name`, `delivery_fee_rules_uri` and `warehouse_id` |
| `programs/farmer-core/src/states.rs` | `Warehouse`, `ZipPrefix`, `ProgramConfig`, `SEED_CONFIG`, `SEED_WAREHOUSE`, `MAX_NOTES_LEN`, `MAX_FEE_BPS`, `MAX_ZIP_PREFIXES` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{UnauthorizedAdmin, NotesTooLong, FeeBpsTooHigh, TooManyZipPrefixes, InvalidZipPrefixLen}` — all pre-existing, no variant was added |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod update_warehouse; pub use update_warehouse::*;`, alphabetically last |
| `programs/farmer-core/src/lib.rs` | the `update_warehouse(ctx, ...)` wrapper, right after `create_warehouse` |
| `tests/update_warehouse.ts` | 11 cases: partial patch, all-`None` no-op, the operator rotation that rescues an `InTransit` order, the untouched service fee, non-admin signer, missing warehouse, the four bounds, the seed derivation |
| `tests/helpers.ts` | `program`, `BN`, `market` (now also returning `warehouseId`), `createOrder`, `markInTransit`, `warehousePDA`, `SERVICE_FEE`, `ataOf`, `logisticsWallet`, `testMint`, `fund`, `fails`, `events` |
| `target/idl/farmer_core.json` | Generated IDL (the two PDAs, the `admin` relation, the five args — `warehouse_id` plus four `option`s — and the error codes) |

## Accounts struct

```rust
#[derive(Accounts)]
#[instruction(warehouse_id: u64)]
pub struct UpdateWarehouse<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump,
        has_one = admin @ FarmerCoreError::UnauthorizedAdmin
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        seeds = [SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()],
        bump
    )]
    pub warehouse: Account<'info, Warehouse>,

    pub admin: Signer<'info>,
}
```

Three accounts, no `system_program`: nothing is initialized. `config` is not `mut` (only read for the
`has_one`) and neither is `admin` — unlike `create_warehouse`, where `admin` is `mut` because it pays
the warehouse's rent. `bump` without `= ...` recomputes the canonical bump both times; no bump is
stored on `Warehouse`.

Client resolution, from the IDL: `config` is a `pda` with the constant seed `b"config"`; `warehouse` is
a `pda` whose second seed is `{"kind": "arg", "path": "warehouse_id"}`, so the client derives it from
the argument it is already sending; `admin` carries `relations: ["config"]`. Nothing has to be passed,
and in the tests the resolved `config.admin` is the provider wallet, which signs on its own:
`tests/update_warehouse.ts` passes `admin` through `.accountsPartial` only in the non-admin case, where
`.signers([kp])` is needed because the override is not the provider wallet.

## Arguments

```rust
pub fn update_warehouse(
    ctx: Context<UpdateWarehouse>,
    _warehouse_id: u64,
    operator: Option<Pubkey>,
    pickup_notes: Option<String>,
    fee_bps: Option<u16>,
    deliver_zip_prefixes: Option<Vec<ZipPrefix>>,
) -> Result<()>
```

`warehouse_id` is seed-only, hence `_warehouse_id` in the handler: the `#[instruction(...)]` attribute
is what feeds it to the `seeds` expression, and the field it would write is immutable anyway. The
remaining four mirror `create_warehouse`'s argument order with `name` and `delivery_fee_rules_uri`
removed and each survivor wrapped in `Option` (IDL: `{"option": "pubkey"}`, `{"option": "string"}`,
`{"option": "u16"}`, `{"option": {"vec": {"defined": {"name": "ZipPrefix"}}}}`). In TypeScript the
absent ones are `null`.

## Account layout

Written fields only (`programs/farmer-core/src/states.rs`, `Warehouse` = 8 + INIT_SPACE = 1367 bytes):
`operator: Pubkey`, `pickup_notes: String` (`#[max_len(MAX_NOTES_LEN)]`), `fee_bps: u16`,
`deliver_zip_prefixes: Vec<ZipPrefix>` (`#[max_len(MAX_ZIP_PREFIXES)]`, `ZipPrefix { prefix: u32, len:
u8 }`). Read-only here and writable nowhere else after creation: `warehouse_id: u64` (the seed),
`name: String`, `delivery_fee_rules_uri: Option<String>`. The space for the maxima was allocated at
`create_warehouse`, so no `realloc` is involved and the account's size and rent never change. In TS the
fields come back as `operator` (`PublicKey`), `pickupNotes` (`string`), `feeBps` (`number`, a `u16`, not
a `BN`), `deliverZipPrefixes` (`{ prefix: number; len: number }[]`).

## Errors

| Error | Code | Raised when |
|---|---|---|
| `UnauthorizedAdmin` | 6002 | `config.admin != admin` (test: "rejects a signer that is not config.admin", a `fund()` keypair) |
| `NotesTooLong` | 6005 | `pickup_notes` is `Some` and longer than `MAX_NOTES_LEN` = 500 (test: "rejects pickup_notes above MAX_NOTES_LEN", 501 chars) |
| `FeeBpsTooHigh` | 6009 | `fee_bps` is `Some` and above `MAX_FEE_BPS` = 10_000 (test: "rejects fee_bps above MAX_FEE_BPS", 10_001; 10_000 itself is accepted by the service-fee test) |
| `TooManyZipPrefixes` | 6007 | `deliver_zip_prefixes` is `Some` with more than `MAX_ZIP_PREFIXES` = 100 items (test: "rejects more than MAX_ZIP_PREFIXES prefixes", 101) |
| `InvalidZipPrefixLen` | 6008 | any `ZipPrefix.len` outside `3..=5` in a `Some` vector (test: "rejects a zip prefix length outside 3..5", `len: 2`) |
| `AccountNotInitialized` (Anchor) | 3012 | no account at `["warehouse", warehouse_id]`, or no `ProgramConfig`; raised at deserialization, before every constraint (test: "rejects a warehouse that does not exist", id 999_999_999) |
| `ConstraintSeeds` (Anchor) | 2006 | `config` or `warehouse` passed at another address than the derived PDA; the client derives both from the IDL, not exercised |
| "Signature verification failed" (web3.js) | n/a | `admin` in `accountsPartial` but missing from `.signers`; the tx is never sent, not exercised |

No new variant was added for this instruction and `FarmerCoreError` still ends at
`MintExtensionNotAllowed` (6033), 34 variants over 6000-6033.

## Events

None. `create_warehouse` emits none either, and README section 9 lists no warehouse event at all —
indexers read the `Warehouse` account. "rotates the operator so a stuck in-transit order can still be
completed" asserts this with `expect(await events(update(...))).to.deep.equal([])`.

## Client call

```typescript
const update = (id: number, p: Patch = {}, admin?: anchor.Keypair) => {
  const b = program.methods.updateWarehouse(
    new BN(id),
    p.operator ?? null,
    p.pickupNotes ?? null,
    p.feeBps ?? null,
    p.prefixes ?? null
  );
  return admin ? b.accountsPartial({ admin: admin.publicKey }).signers([admin]) : b;
};
```

From `tests/update_warehouse.ts`; no `.accounts*` call in the default path at all. `m = await market()`
now also returns `warehouseId`, which this instruction needs as the seed argument — the PDA alone is
not enough. The fixture warehouse comes from `createWarehouse(operator.publicKey, warehouseId)`, whose
`feeBps` parameter defaults to 250: operator a funded keypair, `name` "Central", `pickup_notes`
"Gate B", `fee_bps` 250, one prefix `{ prefix: 123, len: 3 }`, `delivery_fee_rules_uri` `null`.

## Implementation notes

- Order of checks (Anchor 0.32 `try_accounts`, no `init`): `config`, `warehouse` and `admin`
  deserialize in field order, then constraints run in field order (`config` seeds + `has_one = admin`, then
  `warehouse` seeds), then the handler's four `require!`s. A missing warehouse therefore wins over a
  bad signer, since deserialization precedes every constraint — which is why the two tests use
  disjoint inputs: the missing-warehouse case signs with the real admin and the non-admin case patches
  an existing warehouse.
- Handler shape: all four `require!`s first, every one wrapped in `if let Some(..)`, then the four
  writes, also `if let Some(..)`. Validation is fully separated from mutation, so a patch carrying one
  out-of-bounds field writes none of its valid fields. `pickup_notes` and `deliver_zip_prefixes` are
  borrowed (`&`) for validation and moved for the write, which is why the two `if let`s are not merged.
- `notes.len()` is a byte length, matching `MAX_NOTES_LEN` and `create_warehouse`; a multi-byte string
  is bounded in bytes, not characters.
- The all-`None` call is a real transaction: the `warehouse` account is still declared `mut` and
  rewritten with identical bytes, the fee is still paid, and the test asserts the fetched account is
  deep-equal to the one fetched before.
- `fee_bps` has no effect on an existing `Order`: `create_order` stores
  `service_fee_minor = subtotal_minor * fee_bps / 10_000` (computed in `u128`, then narrowed) and
  `complete_order` pays `subtotal_minor - service_fee_minor` to the farmer and
  `escrow.amount - farmer_payout` to logistics, never re-reading `warehouse.fee_bps`. The test sets
  `fee_bps` to 10_000 after an order exists and asserts `order.serviceFeeMinor` is still `SERVICE_FEE`.
- The rotation test is the one that proves the instruction's reason to exist: `createOrder(..., "pickup")`
  then `markInTransit(order, m)` puts the order in `InTransit`, where `expire_order` refuses it and
  `complete_order` requires `warehouse.operator`. After the rotation the old operator's `complete_order`
  returns `UnauthorizedOperator` (6010) and the new operator's drives the order to `Fulfilled`.
  `markInTransit`'s parameter type is `{ warehouse, operator }`, narrowed so a caller does not need a
  whole `market()` object.
- "derives the warehouse from the id argument" patches `fee_bps` without naming any account and then
  reads back `warehousePDA(m.warehouseId)`: it pins that the IDL's `arg`-kind seed resolves to the same
  PDA the test helper derives.
- Compute: ~13k CU out of the 200k default (measured as the suite maximum and rounded: the figure drifts by a few thousand between runs); no compute-budget instruction needed.
