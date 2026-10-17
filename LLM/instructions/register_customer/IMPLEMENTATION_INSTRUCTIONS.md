# register_customer: technical reference

## File map

| File | Role |
|---|---|
| `programs/farmer-core/src/instructions/register_customer.rs` | `RegisterCustomer` accounts struct and handler |
| `programs/farmer-core/src/instructions/mod.rs` | `pub mod register_customer; pub use register_customer::*;` |
| `programs/farmer-core/src/lib.rs` | `#[program]` wrapper `register_customer(ctx, public_profile_uri)` |
| `programs/farmer-core/src/states.rs` | `CustomerProfile`, `SEED_CUSTOMER`, `MAX_URI_LEN` |
| `programs/farmer-core/src/errors.rs` | `FarmerCoreError::UriTooLong` |
| `tests/register_customer.ts` | Behaviour tests |
| `tests/helpers.ts` | `program`, `customerPDA`, `fund`, `fails` |

## Accounts struct

```rust
/// Customer creates a `CustomerProfile`; warehouse eligibility is a separate confirmation (M2).
#[derive(Accounts)]
pub struct RegisterCustomer<'info> {
    #[account(
        init,
        payer = customer,
        space = 8 + CustomerProfile::INIT_SPACE,
        seeds = [SEED_CUSTOMER, customer.key().as_ref()],
        bump
    )]
    pub customer_profile: Account<'info, CustomerProfile>,

    #[account(mut)]
    pub customer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

| Account | Type | Constraints | Client resolution |
|---|---|---|---|
| `customer_profile` | `Account<CustomerProfile>` | `init`, `payer = customer`, `space = 8 + INIT_SPACE`, `seeds = [b"customer", customer]`, `bump` | auto from IDL (derived from `customer`) |
| `customer` | `Signer` | `mut` (pays rent) | must pass: `.accountsPartial({ customer })` + `.signers([customer])` |
| `system_program` | `Program<System>` | address check | auto from IDL |

## Arguments

| Arg | Rust type | TS client type | Validation | Error |
|---|---|---|---|---|
| `public_profile_uri` | `Option<String>` | `string \| null` | if `Some`, `uri.len() <= MAX_URI_LEN` (200 bytes) | `UriTooLong` (6006) |

## Account layout

```rust
#[account]
#[derive(InitSpace)]
pub struct CustomerProfile {
    pub authority: Pubkey,
    #[max_len(MAX_URI_LEN)]
    pub public_profile_uri: Option<String>,
}
```

Seeds: `[SEED_CUSTOMER, customer_pubkey]` where `SEED_CUSTOMER = b"customer"`.
Size: `8 + INIT_SPACE = 245` bytes (8 discriminator + 32 `authority` + 1 option tag + 4 length prefix + 200 bytes).

## Errors

| Error | Code | Raised when |
|---|---|---|
| `UriTooLong` | 6006 | `public_profile_uri` is `Some` and its byte length exceeds 200 |
| "already in use" (system program) | n/a (raw string) | `init` on a `CustomerProfile` PDA that already exists for this `customer` |
| "Signature verification failed" (runtime) | n/a (raw string) | `customer` was not included as a signer |

`tests/register_customer.ts` exercises `UriTooLong` and "already in use". `fails()` in `tests/helpers.ts` resolves to the Anchor error code when present, otherwise `String(e)`, which is why the duplicate case is asserted with `.to.include("already in use")`.

`CustomerNotFound` (6012) lives in the `// ---- Customer` section of `errors.rs` but is not raised by this instruction.

## Client call

From `tests/register_customer.ts`:

```ts
import { program, customerPDA, fails, fund } from "./helpers";

const register = async (uri: string | null) => {
  const customer = await fund();
  await program.methods
    .registerCustomer(uri)
    .accountsPartial({ customer: customer.publicKey })
    .signers([customer])
    .rpc();
  return customer;
};

const p = await program.account.customerProfile.fetch(customerPDA(customer.publicKey));
```

## Implementation notes

- Order of checks: runtime signature verification, then Anchor constraints (`customer` is a `Signer`, PDA derivation, `init` via the system program with `customer` as payer), then the handler's single `require!`, then the two field writes.
- `Option` handling: `if let Some(uri) = &public_profile_uri` guards the bound check; `None` skips it and is stored as `None` (the client passes `null`, reads back `null`).
- `uri.len()` is Rust byte length, not character count. Multi-byte UTF-8 reaches the 200 limit sooner than 200 characters.
- Idempotency: none. Re-calling for the same `customer` fails at `init` ("already in use"); there is no update path in M1.
