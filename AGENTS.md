# Farmer Core Solana - Repository Guidelines

This document provides guidelines for AI agents and software engineers working on the Farmer Core Solana Bridge program.

## Project Overview

Farmer Core Solana Bridge is a Solana program (Rust + Anchor) that enables transparent on-chain listings and purchases while preserving customer privacy and using escrow for guaranteed fulfillment. The program acts as a bridge between Farmer Core (offline-first system) and on-chain market rails.

## Related Documentation

- **`docs/DEVELOPMENT_PLAN.md`**: Comprehensive development workflow, roadmap, milestones, and collaboration model
- **`README.md`**: Product requirements, architecture, and business logic specifications

## Codebase Structure

### Directory Organization

```
programs/farmer-core/src/
├── lib.rs              # Main program entry point, declares all instructions
├── states.rs            # All account structs, constants, and seed phrases
├── errors.rs            # FarmerCoreError: one enum, sections per entity
└── instructions/       # Individual instruction files
    ├── mod.rs          # Module declarations
    └── *.rs           # One file per instruction
```

### File Responsibilities

#### `lib.rs`
- **Purpose**: Main program module that declares all instructions
- **Rules**:
  - Must declare all modules: `errors`, `instructions`, `states`
  - Each instruction function should be a thin wrapper that calls the implementation in `instructions/`
  - `use crate::instructions::*;` at the top so Context types stay short: `Context<InitConfig>`
- **Example**:
  ```rust
  use crate::instructions::*;

  pub mod errors;
  pub mod instructions;
  pub mod states;

  #[program]
  pub mod farmer_core {
      use super::*;

      pub fn init_config(ctx: Context<InitConfig>, ...) -> Result<()> {
          instructions::init_config::init_config(ctx, ...)
      }
  }
  ```

#### `states.rs`
- **Purpose**: Central location for all account structs, constants, and seed phrases
- **Rules**:
  - All constants must be defined here (e.g., `MAX_NAME_LEN`, `MAX_URI_LEN`)
  - All seed phrases must be defined as `pub const SEED_*: &[u8] = b"..."`
  - All account structs must use `#[account]` attribute
  - Account structs derive `InitSpace`; every `Vec`/`String` field carries `#[max_len(CONST)]`
  - Order timeouts are three constants here, in seconds, one per waiting state: pending quote, quoted, pickup (`EXPIRY_PENDING_QUOTE_SECS`, `EXPIRY_QUOTED_SECS`, `EXPIRY_PICKUP_SECS`)
  - Use clear section comments to organize: `// ============================================================================`
- **Structure**:
  ```rust
  // CONSTANTS
  pub const MAX_NAME_LEN: usize = 100;
  
  // SEED PHRASES
  pub const SEED_CONFIG: &[u8] = b"config";
  
  // STATE ACCOUNTS
  #[account]
  #[derive(InitSpace)]
  pub struct ProgramConfig {
      // fields; Vec/String bounded with #[max_len(CONST)]
  }
  ```

#### `errors.rs`
- **Purpose**: the single `#[error_code] pub enum FarmerCoreError`
- **Rules**:
  - One enum only. Anchor 0.32 writes just one `#[error_code]` enum into the IDL (`anchor-lang-idl` overwrites the errors section per enum) and ignores `offset`, so a second enum loses its names client-side
  - Group variants by entity with a section comment: `// ---- Config`, `// ---- Warehouse`, `// ---- Order`, ...
  - Every failure path returns a named variant: auth, state, bounds, arithmetic (`MathOverflow`), stock (`InsufficientStock`). Never an unchecked panic or a bare `?` on `Option`
  - Reuse generic variants across entities (`NameTooLong`, `UriTooLong`, `MathOverflow`) instead of one per struct
  - Use descriptive error messages with `#[msg("...")]`
- **Example**:
  ```rust
  #[error_code]
  pub enum FarmerCoreError {
      // ---- Config
      #[msg("Program is currently paused")]
      ProgramPaused,

      // ---- Warehouse
      #[msg("Signer is not the warehouse operator")]
      UnauthorizedOperator,
  }
  ```

#### `instructions/*.rs`
- **Purpose**: One file per instruction, containing both the accounts struct and implementation
- **Rules**:
  - Each instruction gets its own file: `init_config.rs`, `create_warehouse.rs`, etc.
  - File name should match instruction name (snake_case)
  - Each file must contain:
    1. `#[derive(Accounts)]` struct for the instruction
    2. Public function that implements the instruction logic
  - Use `crate::` imports for accessing states and errors
  - One-line doc comment on the Accounts struct; constraints and named errors are the documentation, do not restate the fields
- **Structure**:
  ```rust
  use anchor_lang::prelude::*;
  use crate::states::{...};
  
  /// Instruction documentation
  #[derive(Accounts)]
  pub struct InstructionName<'info> {
      // accounts
  }
  
  pub fn instruction_name(
      ctx: Context<InstructionName>,
      // parameters
  ) -> Result<()> {
      // implementation
  }
  ```

#### `instructions/mod.rs`
- **Purpose**: Module declarations for all instructions
- **Rules**:
  - Must declare all instruction modules: `pub mod instruction_name;`
  - Keep in alphabetical order for maintainability

## Development Guidelines

### Test-First Development (TDD)

**CRITICAL**: Tests must be written BEFORE implementing instructions.

1. **Write comprehensive tests first**: Create `tests/instruction_name.ts` with:
   - Success cases (happy paths)
   - Error cases (validation failures, unauthorized access, etc.)
   - Edge cases (boundary conditions, empty vectors, max values, etc.)
   - State verification (account data correctness after execution)
2. **Run tests** (they should fail initially)
3. **Implement instruction** to make tests pass
4. **Refactor** if needed while keeping tests green

> **See also**: `docs/DEVELOPMENT_PLAN.md` section 5 for detailed TDD workflow and section 9 for instruction-by-instruction checklist

### Adding New Instructions

1. **Write tests first**: Create `tests/instruction_name.ts` with all test cases
2. **Add state**: If needed, add account structs to `states.rs`
3. **Add errors**: If needed, add variants to `FarmerCoreError` under the entity section
4. **Create instruction file**: Add `instructions/new_instruction.rs`
5. **Declare module**: Add `pub mod new_instruction;` to `instructions/mod.rs`
6. **Add to lib.rs**: Add the instruction function to the `#[program]` module
7. **Run tests**: Ensure all tests pass
8. **Update docs**: `LLM/instructions/<name>/` (see Feature Documentation Convention) and `README.md` if behavior changed

> **See also**: `docs/DEVELOPMENT_PLAN.md` section 9 for detailed instruction-by-instruction checklist

### Account Sizing

- Derive `InitSpace` on every account struct; bound `Vec`/`String` with `#[max_len(CONST)]`
- Use `#[account(space = 8 + StructName::INIT_SPACE)]` in account constraints
- Sanity check when reviewing: `8 (discriminator) + sum of field sizes`, vectors `4 + item_size * max_items`

### PDA Seeds

- All seed phrases must be defined in `states.rs` as constants
- Use descriptive names: `SEED_CONFIG`, `SEED_WAREHOUSE`, etc.
- Reference seeds using the constants, never hardcode byte strings
- Example: `seeds = [SEED_CONFIG]` not `seeds = [b"config"]`
- Entity ids (`warehouse_id`, `offer_id`, `order_id`) are explicit `u64` instruction args, in seeds as `id.to_le_bytes().as_ref()`. No on-chain counters: the client picks the id, a duplicate fails at `init`

### Error Handling

- Gates live in `#[account(...)]` constraints, not in the handler: `has_one = operator @ FarmerCoreError::UnauthorizedOperator`, `constraint = !config.paused @ FarmerCoreError::ProgramPaused`
- `require!` only for checks on instruction args (bounds, ranges) that a constraint cannot express
- Amount and stock arithmetic always uses `checked_*` and maps `None` to a named error. No bare `+ - *` on `u64` amounts
- `use crate::errors::FarmerCoreError;` once per file, then `FarmerCoreError::Variant`
- Provide clear, actionable error messages

### Validation Rules

- Market instructions carry `constraint = !config.paused @ FarmerCoreError::ProgramPaused` on the `config` account
- Signers and relationships via `has_one` / `constraint`; status transitions via `constraint = order.status == OrderStatus::X @ FarmerCoreError::InvalidStatus`
- Mint allowlist is enforced once, in `publish_offer`: `config.allowed_mints.is_empty() || config.allowed_mints.contains(&mint)`. `create_order` trusts `offer.mint`
- Validate input bounds (string lengths, vector sizes, etc.) with `require!`

### Security Best Practices

- Never trust client-provided data without validation
- Always verify signers match expected authorities
- Use PDAs for program-controlled accounts
- Validate all account relationships (e.g., order.warehouse == warehouse.pubkey)
- Check stock availability before reserving
- Restore stock on cancellations/refusals/expirations

## Testing Guidelines

### Test Structure

- **One test file per instruction**: `tests/instruction_name.ts`, one `describe`, a `before` that builds the fixtures, one `it` per behavior
- **`ProgramConfig` is a singleton**: the root `before` in `tests/helpers.ts` creates it once; no test file calls `init_config` for setup
- **Shared helpers** in `tests/helpers.ts`: `program`, `provider`, PDA derivers (`configPDA`, `warehousePDA(id)`, `farmerPDA(pk)`, `customerPDA(pk)`), `fund()` (new keypair with airdropped SOL), `freshId()`, `fails(promise)` (resolves to the Anchor error code or the raw error string), and fixtures `createWarehouse(operator)` / `registerFarmer(warehouse)`
- **Fixtures use fresh keypairs and ids** per file so files never collide on PDAs
- **Account resolution**: let Anchor resolve PDAs, the provider wallet and programs from the IDL; pass only what it cannot derive (`.accountsPartial` to override a signer)
- **Flow test**: lands together with `create_order` (M4) as `tests/flow_order.ts`: confirm_customer → publish_offer → create_order → quote_delivery_fee → accept_delivery_fee; M5 extends it through mark_in_transit → complete_order

### Test Coverage Requirements

Each instruction test file covers, one `it` each:

1. Happy path, then assert every stored field
2. Each authorization failure (wrong signer, missing signer)
3. Each named error the handler can return, triggered once
4. Each illegal state transition, if the instruction checks a status
5. Event emission, if the instruction emits one

Skip: parameter permutations that hit the same branch, inputs that cannot reach the program (args larger than a transaction), and tests that only re-run the harness (re-deriving a PDA and comparing it with itself).

### Test Example Structure

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FarmerCore } from "../target/types/farmer_core";
import { expect } from "chai";

describe("init_config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.farmerCore as Program<FarmerCore>;
  const { PublicKey, Keypair } = anchor.web3;

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const logisticsWallet = Keypair.generate().publicKey;

  before(async () => {
    await program.methods.initConfig(logisticsWallet, false, []).rpc();
  });

  it("persists every field", async () => {
    const config = await program.account.programConfig.fetch(configPDA);
    expect(config.logisticsWallet.equals(logisticsWallet)).to.be.true;
  });

  it("rejects an admin that did not sign", async () => {
    const err = await program.methods
      .initConfig(logisticsWallet, false, [])
      .accountsPartial({ admin: Keypair.generate().publicKey })
      .rpc()
      .catch((e) => e);
    expect(String(err)).to.match(/signature/i);
  });
});
```

## Documentation Standards

- One-line doc comment per instruction; constraints and named errors carry the detail
- Document account constraints in `#[derive(Accounts)]` structs
- Explain business logic in instruction implementations
- Use `msg!` for important state changes in production code
- Keep documentation updated:
  - `README.md`: Product requirements and architecture changes
  - `docs/DEVELOPMENT_PLAN.md`: Roadmap and milestone updates
  - `LLM/instructions/<name>/`: behavior, technical reference and change log per instruction (convention below)

### Feature Documentation Convention

- Every instruction has docs under `LLM/instructions/<instruction_name>/`.
- Expected docs: `HOW_IT_WORKS.md`, `IMPLEMENTATION_INSTRUCTIONS.md`, and `IMPLEMENTATION_SUMMARY.md` or equivalent.
- When implementing or changing an instruction, update its docs so behavior and technical decisions stay in sync with code.

#### Required Documents per Instruction

| Document | Purpose | What It Contains |
|----------|---------|-----------------|
| `HOW_IT_WORKS.md` | **End-to-end behavior** — read this first to understand the feature | Purpose and user-facing behavior. Mermaid sequence diagrams showing the full request lifecycle. Component list with route table, service methods, and data flow. Data model overview and key relationships. Key design decisions explaining *why* things work the way they do. References to all related source files. |
| `IMPLEMENTATION_INSTRUCTIONS.md` | **Technical reference** — read this when implementing or debugging | File map (every file involved and its role). Full data model definitions with TypeScript snippets. Service class detail (constructor, every method signature, parameters, return types). API contracts for each endpoint (HTTP method, path, body schema, response shape). Implementation notes covering edge cases, casting, error handling, and non-obvious patterns. |
| `IMPLEMENTATION_SUMMARY.md` | **Change log & decisions** — read this to understand what was built and why | List of all files created or modified, grouped by layer (common types, shared services, API controllers, routes, docs). Key architectural decisions with rationale. Operational prerequisites (indexes, secrets, config, permissions). |

#### Mapping to this program

- endpoint = instruction (signers, accounts, args, errors, events); route table = instruction table
- service method = handler in `instructions/<name>.rs`; data model = account struct in `states.rs` plus the generated IDL type
- operational prerequisites = seeds, rent, mints, required signers, config flags
- one folder per instruction, named after it: `LLM/instructions/register_farmer/`

## Code Style

- Use `rustfmt` for consistent formatting
- Follow Rust naming conventions:
  - Structs: `PascalCase`
  - Functions: `snake_case`
  - Constants: `UPPER_SNAKE_CASE`
- Use meaningful variable names
- Keep functions focused and single-purpose
- Add comments for complex business logic

## Common Patterns

### Initializing PDAs (explicit ids, no counters)
```rust
#[derive(Accounts)]
#[instruction(warehouse_id: u64)]
pub struct CreateWarehouse<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Warehouse::INIT_SPACE,
        seeds = [SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()],
        bump
    )]
    pub warehouse: Account<'info, Warehouse>,
    // ...
}
```

### Gates as constraints
```rust
#[account(
    seeds = [SEED_CONFIG], bump,
    constraint = !config.paused @ FarmerCoreError::ProgramPaused,
)]
pub config: Account<'info, ProgramConfig>,

#[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
pub warehouse: Account<'info, Warehouse>,
pub operator: Signer<'info>,

#[account(constraint = order.status == OrderStatus::DeliveryQuoted @ FarmerCoreError::InvalidStatus)]
pub order: Account<'info, Order>,
```

### Checked arithmetic, named errors
```rust
let subtotal = qty
    .checked_mul(offer.price_minor)
    .ok_or(FarmerCoreError::MathOverflow)?;

// Reserve stock
offer.qty_remaining = offer
    .qty_remaining
    .checked_sub(qty)
    .ok_or(FarmerCoreError::InsufficientStock)?;

// Restore stock on cancel / reject / refuse / expire
offer.qty_remaining = offer
    .qty_remaining
    .checked_add(order.qty)
    .ok_or(FarmerCoreError::MathOverflow)?;
```

### Timeouts
```rust
order.expires_at = Clock::get()?.unix_timestamp + EXPIRY_PENDING_QUOTE_SECS;
```

## Entity Relationships

Understanding the core entities helps maintain consistency:

- **ProgramConfig**: Global program settings (admin, paused, allowed_mints)
- **Warehouse**: Fulfillment operator that confirms customers and manages orders
- **FarmerProfile**: Farmer identity linked to a warehouse
- **CustomerProfile**: Customer identity
- **WarehouseCustomer**: Confirmation relationship (privacy key - address stored off-chain)
- **LotOffer**: Transparent listing of available items
- **Order**: Escrowed purchase with mandatory lifecycle transitions

## Lifecycle Management

Orders follow strict state transitions:
- Pickup: `ESCROWED_PICKUP` → `IN_TRANSIT` → `FULFILLED`
- Delivery: `PENDING_DELIVERY_QUOTE` → `DELIVERY_QUOTED` → `ESCROWED_READY` → `IN_TRANSIT` → `FULFILLED`

Transitions are enforced with `constraint = order.status == OrderStatus::X @ FarmerCoreError::InvalidStatus` on the order account; `FULFILLED` only from `IN_TRANSIT`.

## Integration Points

- Events are emitted for Farmer Core synchronization
- Off-chain components handle customer address collection
- Indexers consume events for DApp frontends
- Token transfers use `anchor_spl::token_interface` (`InterfaceAccount<TokenAccount>`, `Interface<TokenInterface>`, `transfer_checked`) so SPL Token and Token-2022 both work; the escrow token account's authority is the PDA `[SEED_ESCROW, order]`

## Common Errors and Solutions

### Build Errors

#### Corrupted Solana Platform Tools Cache

**Error**: `error: not a directory: '/Users/.../.local/share/solana/install/releases/.../platform-tools-sdk/sbf/dependencies/platform-tools/rust/lib'`

**Solution**:
```bash
# Remove the corrupted cache
rm -rf ~/.cache/solana/v1.48

# Rebuild - this will trigger a fresh download
anchor build
```

If the issue persists:
```bash
# Reinstall Solana version
solana-install init 2.2.20

# Then rebuild
anchor build
```

#### Rust Analyzer: Unresolved Import `__client_accounts_instructions`

**Error**: `unresolved import 'crate'` / `could not find '__client_accounts_instructions' in the crate root`

**Solution**: This is a rust-analyzer limitation with Anchor's procedural macros. The code is correct, but rust-analyzer can't see generated code until the project is built.

1. Build the project: `anchor build`
2. Restart rust-analyzer (VS Code/Cursor: Command Palette → "rust-analyzer: Restart server")
3. The error should disappear after building

**Note**: This is a false positive - the code will compile correctly.

### Runtime Errors

#### PDA Derivation Failures

**Error**: `AnchorError caused by account: <account>. Error Code: ConstraintSeeds. Error Number: 2006`

**Solution**: Verify seed phrases match exactly between:
- `states.rs` seed constant definition
- Instruction account constraint `seeds = [...]`
- Test PDA derivation

#### Account Size Mismatch

**Error**: `AnchorError caused by account: <account>. Error Code: AccountDidNotSerialize. Error Number: 3004`

**Solution**: 
1. Verify every `Vec`/`String` field in `states.rs` has `#[max_len(...)]`
2. Ensure the constraint is `#[account(space = 8 + StructName::INIT_SPACE)]`
3. Check vector sizing: `4 (length) + (item_size * max_items)`

#### Missing Solana Keypair for Tests

**Error**: `Error: Unable to read keypair file (/Users/.../.config/solana/id.json)`

**Solution**: Create a Solana keypair for local testing.

```bash
# Create the Solana config directory if it doesn't exist
mkdir -p ~/.config/solana

# Generate a new keypair (without passphrase for local development)
solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase

# Verify the keypair was created
solana address -k ~/.config/solana/id.json

# For localnet testing, airdrop some SOL (if using local validator)
solana airdrop 2 $(solana address -k ~/.config/solana/id.json) --url localhost
```

**Note**: 
- The keypair path is configured in `Anchor.toml` under `[provider]` → `wallet`
- For production, use a secure keypair with a passphrase
- Never commit the keypair file to version control (it's in `.gitignore`)

## Setup and Development

### Initial Setup

1. **Install dependencies**:
   ```bash
   yarn install
   ```

2. **Create Solana keypair** (if missing):
   ```bash
   mkdir -p ~/.config/solana
   solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase
   ```

3. **Start local validator** (in a separate terminal):
   ```bash
   solana-test-validator
   ```

4. **Build the program**:
   ```bash
   anchor build
   ```

5. **Run tests**:
   ```bash
   anchor test
   ```

## Questions?

When in doubt:
1. Check `README.md` for product requirements and architecture
2. Check `docs/DEVELOPMENT_PLAN.md` for development workflow, roadmap, and milestones
3. Review existing instructions for patterns
4. Ensure consistency with established conventions
5. Validate against security requirements in README section 12
6. Check this document's "Common Errors and Solutions" section

## Documentation Hierarchy

For different needs, consult:

- **Product Requirements & Architecture**: `README.md`
- **Development Workflow & Roadmap**: `docs/DEVELOPMENT_PLAN.md`
- **Repository Guidelines & Patterns**: This document (`AGENTS.md`)