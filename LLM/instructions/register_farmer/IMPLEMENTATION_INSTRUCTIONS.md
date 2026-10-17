# register_farmer: technical reference

## File map

| file | role |
|---|---|
| `programs/farmer-core/src/instructions/register_farmer.rs` | `RegisterFarmer` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod register_farmer;` + `pub use register_farmer::*;` |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `farmer_core::register_farmer` |
| `programs/farmer-core/src/states.rs` | `FarmerProfile`, `Warehouse`, `SEED_FARMER`, `MAX_NAME_LEN`, `MAX_URI_LEN` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::{NameTooLong, UriTooLong}` |
| `tests/register_farmer.ts` | behaviour tests |
| `tests/helpers.ts` | `program`, `fund`, `fails`, `farmerPDA`, `createWarehouse`, `registerFarmer` fixture |
| `target/idl/farmer_core.json`, `target/types/farmer_core.ts` | generated IDL and TS types (build output) |

## Accounts struct

```rust
#[derive(Accounts)]
pub struct RegisterFarmer<'info> {
    #[account(
        init,
        payer = farmer,
        space = 8 + FarmerProfile::INIT_SPACE,
        seeds = [SEED_FARMER, farmer.key().as_ref()],
        bump
    )]
    pub farmer_profile: Account<'info, FarmerProfile>,

    pub warehouse: Account<'info, Warehouse>,

    #[account(mut)]
    pub farmer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

| account | type | constraints | client resolution |
|---|---|---|---|
| `farmer_profile` | `Account<FarmerProfile>` | `init`, `payer = farmer`, `space = 8 + INIT_SPACE` (381), `seeds = ["farmer", farmer]`, `bump` | auto from IDL (PDA derived from `farmer`) |
| `warehouse` | `Account<Warehouse>` | type check only (owner + discriminator) | must pass (no seeds in IDL) |
| `farmer` | `Signer` | `mut` (pays rent) | defaults to the provider wallet; override with `accountsPartial` + `signers` |
| `system_program` | `Program<System>` | fixed address | auto from IDL |

## Arguments

| arg | Rust type | TS client type | validation | error |
|---|---|---|---|---|
| `display_name` | `String` | `string` | `len() <= MAX_NAME_LEN` (100 bytes) | `NameTooLong` (6004) |
| `public_profile_uri` | `String` | `string` | `len() <= MAX_URI_LEN` (200 bytes) | `UriTooLong` (6006) |

## Account layout

```rust
#[account]
#[derive(InitSpace)]
pub struct FarmerProfile {
    pub authority: Pubkey,
    pub warehouse: Pubkey,
    pub warehouse_approved: bool,
    #[max_len(MAX_NAME_LEN)]
    pub display_name: String,
    #[max_len(MAX_URI_LEN)]
    pub public_profile_uri: String,
}
```

Seeds: `[SEED_FARMER, farmer.key().as_ref()]`, `SEED_FARMER = b"farmer"`.
Size: 8 + INIT_SPACE = 381 bytes (8 + 32 + 32 + 1 + (4 + 100) + (4 + 200)).

Written by the handler: `authority = farmer`, `warehouse = warehouse.key()`, `warehouse_approved = false`, both strings as received.

## Errors

| error | code | raised when |
|---|---|---|
| `NameTooLong` | 6004 | `display_name.len() > 100` |
| `UriTooLong` | 6006 | `public_profile_uri.len() > 200` |
| `AccountNotInitialized` (Anchor) | 3012 | the `warehouse` pubkey holds no account |
| "already in use" (System Program, during `init`) | n/a | the farmer already has a `FarmerProfile` |
| "Signature verification failed" (runtime) | n/a | `farmer` did not sign; not exercised in `tests/register_farmer.ts` |

## Client call

From `tests/helpers.ts`:

```ts
export const registerFarmer = async (warehouse: anchor.web3.PublicKey) => {
  const farmer = await fund();
  await program.methods
    .registerFarmer("Ana", "https://example.com/ana")
    .accountsPartial({ farmer: farmer.publicKey, warehouse })
    .signers([farmer])
    .rpc();
  return { farmer, profile: farmerPDA(farmer.publicKey) };
};
```

`farmerPDA(pk)` = `findProgramAddressSync([Buffer.from("farmer"), pk.toBuffer()], program.programId)[0]`. Read back with `program.account.farmerProfile.fetch(profile)`; fields are camelCase (`warehouseApproved`, `displayName`, `publicProfileUri`).

## Implementation notes

- Order of checks: tx signature (runtime), then Anchor account validation, which deserializes the non-`init` accounts first (`warehouse`, `farmer`, `system_program`) and only then runs the `farmer_profile` `init` CPI (anchor-syn `try_accounts`, not struct order), then `require!` on `display_name`, then on `public_profile_uri`, then the field writes. An arg failure happens after the accounts were validated, but the tx reverts as a whole, so no profile is left behind.
- `String::len()` counts UTF-8 bytes, not characters; the bound matches the `#[max_len]` byte budget.
- No `Option` args; both strings are required. An empty string passes the bound.
- Not idempotent: `init` fails on an existing PDA. There is no update instruction in M1.
- `warehouse_approved` never comes from the caller; it is always written `false`.
- The profile stores the warehouse PDA address, not `warehouse_id`; `set_farmer_warehouse` compares against that address.
- 100 + 200 bytes of args fit in one transaction; no tx-size ceiling applies to these bounds.
