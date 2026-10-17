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
├── errors.rs            # All error enums organized by entity
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
  - Use full module paths for Context types: `Context<instructions::module_name::StructName>`
- **Example**:
  ```rust
  pub mod errors;
  pub mod instructions;
  pub mod states;

  #[program]
  pub mod farmer_core {
      pub fn init_config(
          ctx: Context<instructions::init_config::InitConfig>,
          ...
      ) -> Result<()> {
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
- **Purpose**: All error enums organized by entity
- **Rules**:
  - Errors are grouped by entity: `ConfigError`, `CustomerError`, `FarmerError`, `WarehouseError`, etc.
  - Each enum must use `#[error_code]` attribute
  - Use descriptive error messages with `#[msg("...")]`
  - Keep related errors together
- **Example**:
  ```rust
  #[error_code]
  pub enum ConfigError {
      #[msg("Program is currently paused")]
      ProgramPaused,
  }
  
  #[error_code]
  pub enum CustomerError {
      #[msg("Customer not found")]
      CustomerNotFound,
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
  - Include comprehensive doc comments explaining the instruction
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
3. **Add errors**: If needed, add error variants to appropriate enum in `errors.rs`
4. **Create instruction file**: Add `instructions/new_instruction.rs`
5. **Declare module**: Add `pub mod new_instruction;` to `instructions/mod.rs`
6. **Add to lib.rs**: Add the instruction function to the `#[program]` module
7. **Run tests**: Ensure all tests pass
8. **Update docs**: Update `README.md` if behavior changed

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

### Error Handling

- Use `require!` macro for validation checks
- Reference errors using full path: `crate::errors::ErrorEnum::Variant`
- Provide clear, actionable error messages
- Group related errors in the same enum

### Validation Rules

- Always check program pause state: `require!(!config.paused, ConfigError::ProgramPaused)`
- Validate account ownership and signers
- Check account states before state transitions
- Validate input bounds (string lengths, vector sizes, etc.)

### Security Best Practices

- Never trust client-provided data without validation
- Always verify signers match expected authorities
- Use PDAs for program-controlled accounts
- Validate all account relationships (e.g., order.warehouse == warehouse.pubkey)
- Check stock availability before reserving
- Restore stock on cancellations/refusals/expirations

## Testing Guidelines

### Test Structure

- **One test file per instruction**: `tests/instruction_name.ts`
- **Test file naming**: Match instruction name (snake_case)
- **Test organization**: Group related tests using `describe()` blocks
- **Test naming**: Use descriptive names: `it("should initialize config with valid parameters")`

### Test Coverage Requirements

Each instruction test file must cover:

1. **Success Cases**:
   - Happy path with valid parameters
   - Different valid parameter combinations
   - Edge cases within valid ranges (empty vectors, max values, etc.)

2. **Error Cases**:
   - Validation failures (invalid inputs, out of bounds)
   - Authorization failures (wrong signer, unauthorized access)
   - State errors (already initialized, invalid state transitions)
   - Business logic errors (insufficient funds, invalid relationships)

3. **State Verification**:
   - Verify account data after successful execution
   - Verify account state changes
   - Verify PDA derivation correctness
   - Verify event emission (if applicable)

4. **Edge Cases**:
   - Boundary conditions (min/max values)
   - Empty vectors/strings
   - Zero values where applicable
   - Maximum allowed values

### Test Example Structure

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FarmerCore } from "../target/types/farmer_core";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

describe("init_config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.farmerCore as Program<FarmerCore>;

  describe("success cases", () => {
    it("should initialize config with valid parameters", async () => {
      // Test implementation
    });
  });

  describe("error cases", () => {
    it("should fail with too many allowed mints", async () => {
      // Test implementation
    });
  });

  describe("edge cases", () => {
    it("should handle empty allowed_mints vector", async () => {
      // Test implementation
    });
  });
});
```

## Documentation Standards

- All public functions must have doc comments
- Document account constraints in `#[derive(Accounts)]` structs
- Explain business logic in instruction implementations
- Use `msg!` for important state changes in production code
- Keep documentation updated:
  - `README.md`: Product requirements and architecture changes
  - `docs/DEVELOPMENT_PLAN.md`: Roadmap and milestone updates

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

### Initializing PDAs
```rust
#[account(
    init,
    payer = payer,
    space = 8 + AccountStruct::INIT_SPACE,
    seeds = [SEED_ACCOUNT, ...],
    bump
)]
pub account: Account<'info, AccountStruct>,
```

### Validating Signers
```rust
require!(
    ctx.accounts.signer.key() == expected_authority,
    ErrorType::Unauthorized
);
```

### Checking Program State
```rust
require!(!ctx.accounts.config.paused, ConfigError::ProgramPaused);
```

### Stock Management
```rust
// Reserve stock
require!(
    offer.qty_remaining >= qty,
    OfferError::InsufficientStock
);
offer.qty_remaining -= qty;

// Restore stock on cancellation
offer.qty_remaining += order.qty;
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

Always validate current state before allowing transitions.

## Integration Points

- Events are emitted for Farmer Core synchronization
- Off-chain components handle customer address collection
- Indexers consume events for DApp frontends
- Token transfers use SPL Token Program (support Token-2022 via `anchor_spl::token_interface`)

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

**Error**: `AnchorError caused by account: <account>. Error Code: AccountNotEnoughKeys. Error Number: 3001`

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