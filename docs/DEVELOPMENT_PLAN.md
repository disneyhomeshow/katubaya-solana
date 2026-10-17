# DEVELOPMENT_PLAN.md
Farmer Core Solana Bridge — Engineer + AI Cooperative Development Plan

**Purpose**  
This document guides our day-to-day development workflow and long-term roadmap as a cooperation between a human engineer and an AI collaborator. It keeps us aligned on product requirements, repo conventions, security posture, and “test-first” execution.

**Scope**  
This plan applies to the Solana program (Rust + Anchor), its TypeScript tests, and the supporting docs. Farmer Core (offline-first app) is a separate codebase; this program is the “Bridge” for transparent market rails + logistics escrow.

---

## 1) North Star: What We’re Building

A Solana program that enables:

- **Market transparency**: customers can see exactly what they’re buying and from whom (farmer pubkey + public profile URI).
- **Customer privacy**: customer full address stays **off-chain**; on-chain only stores warehouse-issued confirmation.
- **Guaranteed fulfillment via escrow**: warehouse/logistics operator controls order lifecycle and escrow release.
- **Cooperation, not domination**: no rankings, no reputation games; clear incentives, explicit contracts, portable data.

---

## 2) Product Requirements (Canonical Summary)

### Actors
- **Admin / Logistics**: controls global config; receives service + delivery fees; operates warehouses.
- **Warehouse Operator**: confirms customers, quotes delivery fees, marks IN_TRANSIT, completes orders.
- **Farmer**: belongs to a warehouse (MVP), publishes offers, receives payout upon completion.
- **Customer**: requests confirmation, buys offers, approves delivery fee quotes.

### Core rules (MVP)
- Customer must be **confirmed by warehouse** before ordering (address exchanged off-chain).
- Offers are **transparent**: crop/cultivar/unit/qty/price/expiry/notes are on-chain.
- Escrow is mandatory:
  - Warehouse must set **IN_TRANSIT** before it can **COMPLETE**.
- Delivery fee is **dynamic**:
  - Customer escrows **subtotal** first.
  - Warehouse quotes delivery fee.
  - Customer accepts (escrows fee) or rejects (refund + stock restore).
- Warehouse can **refuse Delivery** orders pre-transit (refund + stock restore).

---

## 3) Current Implementation State

The code is the source of truth: `programs/farmer-core/src/` for what exists, `git log` for what changed, section 8 for what comes next.

---

## 4) Collaboration Model: Engineer ↔ AI

### Responsibilities
**Engineer (human)**
- Owns product decisions and final merges.
- Runs tests locally, resolves environment issues.
- Reviews security-sensitive logic (token transfers, PDA derivations, state transitions).
- Decides when to refactor and when to ship.

**AI collaborator**
- Produces:
  - instruction-by-instruction test files (first) aligned with spec
  - Anchor instruction implementations that satisfy tests
  - precise account sizing calculations and bounded constants
  - security checks and edge case coverage
  - doc updates (README, changelog notes)
- Maintains consistency with repo guidelines.

### Communication protocol
- Engineer provides:
  - target instruction name
  - any updated business rule or constants/limits
  - relevant file snippets if needed
- AI returns:
  - test file first (`tests/<instruction>.ts`)
  - then code changes (`states.rs`, `errors.rs`, `instructions/<instruction>.rs`, `instructions/mod.rs`, `lib.rs`)
  - explanation of validations and edge cases covered (short, explicit)

---

## 5) Engineering Workflow (Strict TDD)

**Rule: Tests must be written before implementing an instruction.**

For each instruction:

1. **Spec the instruction**
   - accounts
   - parameters
   - validations
   - state transitions
   - events expected
2. **Write tests first**
   - success cases
   - error cases
   - edge/boundary cases
   - state verification
   - PDA derivation checks
3. **Run tests (expect failure)**
4. **Implement instruction**
   - add/update state structs in `states.rs` (derive `InitSpace`)
   - add/update errors in `errors.rs`
   - implement instruction in `instructions/<name>.rs`
   - export wrapper in `lib.rs`
5. **Run tests (must pass)**
6. **Refactor**
   - keep tests green
   - ensure code remains consistent with repo conventions
7. **Update docs**
   - update README if behavior changed

---

## 6) Repo Conventions (Non-negotiable)

### Structure
```text
programs/farmer-core/src/
├── lib.rs
├── states.rs
├── errors.rs
└── instructions/
├── mod.rs
└── *.rs
```


### Key rules
- `lib.rs` is thin wrappers calling `instructions::*`
- All constants + seeds in `states.rs`
- All accounts in `states.rs` derive `InitSpace`
- Errors grouped by entity in `errors.rs`
- One instruction per file in `instructions/`
- `instructions/mod.rs` lists modules in alphabetical order

### Account sizing
- Derive `InitSpace`; bound `Vec`/`String` with `#[max_len(CONST)]`
- Use `#[account(space = 8 + StructName::INIT_SPACE)]`
- What it computes (for review): discriminator `8`, Pubkey=32, u64/i64=8, bool=1, u16=2, u8=1, String `4 + MAX_LEN`, Vec<T> `4 + T_SIZE * MAX_ITEMS`, Option<T> `1 + T_SIZE`

### Seeds
- No hardcoded `b"..."` in constraints; only constants:
  - `SEED_CONFIG`, `SEED_WAREHOUSE`, `SEED_FARMER`, etc.

---

## 7) Quality Gates (Definition of Done)

A feature/instruction is “done” when:

- ✅ Tests exist and cover:
  - happy path
  - auth failures
  - validation failures
  - boundary conditions
  - PDA derivation
  - state changes
- ✅ All state structs:
  - are in `states.rs`
  - derive `InitSpace` with every variable-size field bounded
  - use bounded strings/vectors
- ✅ Errors:
  - added to correct enum
  - have clear messages
- ✅ Security checks present:
  - authority checks
  - paused checks where required
  - correct state transition checks
  - stock reserve/restore correctness
  - token transfer correctness
- ✅ Docs updated: README if behavior changed

---

## 8) Roadmap (Milestones and Deliverables)

### M0 — Foundation (Done)
- ProgramConfig + init_config + tests

### M1 — Warehouse + Profiles (Foundational Market Graph)
Deliver:
- Accounts: `Warehouse`, `FarmerProfile`, `CustomerProfile`
- Instructions:
  - `create_warehouse`
  - `register_farmer`
  - `set_farmer_warehouse` (or request/approve)
  - `register_customer`
- Errors: `WarehouseError`, `FarmerError`

### M2 — Customer Confirmation Flow (Privacy Gate)
Deliver:
- Account: `WarehouseCustomer`
- Instructions:
  - `request_customer_confirmation`
  - `confirm_customer`
  - `revoke_customer`
- Events: request/confirm/revoke

### M3 — Offers (Transparent Listings)
Deliver:
- Account: `LotOffer`
- Instructions:
  - `publish_offer`
  - `deactivate_offer`
- Errors: `OfferError`
- Events: offer published/deactivated

### M4 — Orders (Escrow + Quote/Approve)
Deliver:
- Account: `Order`
- Escrow token mechanics (SPL + Token-2022 via token_interface)
- Instructions:
  - `create_order` (reserve stock + escrow subtotal)
  - `quote_delivery_fee`
  - `accept_delivery_fee`
  - `reject_delivery_fee`
  - `refuse_delivery`
- Errors: `OrderError`
- Events: order created, fee quoted/accepted/rejected, refused
- Flow test `tests/flow_order.ts` through `accept_delivery_fee`

### M5 — Mandatory Transport + Completion (Guarantee)
Deliver:
- Instructions:
  - `mark_in_transit`
  - `complete_order` (release escrow: farmer payout + logistics payout)
- Events: in transit, completed
- Extend `tests/flow_order.ts` through `complete_order`

### M6 — Timeouts & Hardening
Deliver:
- `expire_order`
- More invariants tests:
  - stock restoration always correct
  - no completion without IN_TRANSIT
  - no cancel after IN_TRANSIT
- Compute budget review + constraints tightening

### M7 — Optional Pack Pointer (Integrity Anchor)
Deliver:
- `PackPointer` account + publish instruction (optional)
- Offer linking to pack pointers

---

## 9) Instruction-by-Instruction Development Checklist

For each new instruction `X`:

### A) Before coding
- [ ] Clarify who must sign (farmer/customer/warehouse operator/admin)
- [ ] Define state transitions
- [ ] Define errors and when they trigger
- [ ] Define event shape (if applicable)
- [ ] Confirm which constants/limits are used (max string lengths, max vec lengths)

### B) Tests first (`tests/x.ts`)
Minimum coverage:
- [ ] success: valid input
- [ ] success: edge within bounds
- [ ] error: unauthorized signer
- [ ] error: invalid state transition
- [ ] error: input out of bounds
- [ ] state verification: fields updated correctly
- [ ] PDA derivation correctness
- [ ] event emission checks (if instruction emits events)

### C) Implementation
- [ ] Add/update account struct(s) in `states.rs` + `InitSpace`
- [ ] Add/update error enums in `errors.rs`
- [ ] Create `instructions/x.rs` with `#[derive(Accounts)]` + impl fn
- [ ] Export in `instructions/mod.rs` (alphabetical)
- [ ] Thin wrapper in `lib.rs`

### D) Final checks
- [ ] `anchor test` passes
- [ ] `rustfmt` clean
- [ ] Any behavior changes reflected in README

---

## 10) Security Checklist (Always Review)

- **Authority checks**
  - Warehouse actions require warehouse.operator signer
  - Farmer actions require farmer authority signer
  - Customer actions require customer authority signer
- **Paused gating**
  - Buying/market actions blocked when `config.paused == true`
- **State transitions**
  - Enforce exact allowed transitions
  - `FULFILLED` only from `IN_TRANSIT`
- **Escrow integrity**
  - Escrow ATA owned by PDA derived from order
  - Release only under correct status and signer
- **Stock accounting**
  - Decrement stock on order creation (reservation)
  - Restore stock on cancel/reject/refuse/expire
  - Never allow qty_remaining underflow
- **Mint allowlist**
  - If `allowed_mints` non-empty, mint must be included
- **No PII on-chain**
  - Customer address never stored
  - notes_hash allowed but must be hash-only
- **Input bounds**
  - Strings length <= constants
  - Vec sizes <= constants

---

## 11) Testing Strategy

### Unit-style instruction tests (primary)
- One TS file per instruction (repo rule).
- Verify:
  - account fields after execution
  - failures produce expected Anchor error codes
  - PDAs derive as expected

### Flow test (M4)
Lands together with `create_order` as `tests/flow_order.ts`, orchestrating:
- Confirm customer → publish offer → create order → quote fee → accept

M5 extends the same file through `mark_in_transit` → `complete_order`.

---

## 12) Documentation Discipline

Always keep these updated:
- `README.md`: product requirements and architecture
- `AGENTS.md`: repo rules and dev playbook

Optional (recommended): create `docs/adr/` for Architecture Decision Records:
- ADR-001: escrow vs instant payout
- ADR-002: warehouse confirmation approach
- ADR-003: dynamic delivery fee quote flow

---

## 13) Local Dev Quickstart (Engineer)

1. Install deps
```bash
yarn install
```

2. Ensure keypair exists
```bash
mkdir -p ~/.config/solana
solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase
```

3. Start local validator
```bash
solana-test-validator
```

4. Build + test
```bash
anchor build
anchor test
```

If Solana platform-tools cache is corrupted, see AGENTS.md “Common Errors and Solutions”.

## 14) Templates

### 14.1 Instruction Spec Template
Copy into an issue/PR description:

- **Instruction name**:
- **Signer(s)**:
- **Accounts**:
- **Parameters**:
- **Validations**:
- **State changes**:
- **Events**:
- **Errors**:
- **Edge cases**:

### 14.2 PR Checklist
- [ ] Tests added first and are comprehensive
- [ ] New accounts derive `InitSpace` with every variable-size field bounded
- [ ] Seeds use constants from `states.rs`
- [ ] Errors grouped correctly
- [ ] Instruction file is standalone and documented
- [ ] `instructions/mod.rs` updated alphabetically
- [ ] `lib.rs` wrapper added
- [ ] Docs updated (README, if behavior changed)

### 14.3 “AI Request” Prompt Template (for engineers)
When asking AI for work, include:
- Instruction name
- Any new constraints or updated business rules
- Expected events (if any)
- Limits (string/vector max) if changed
- Any existing code snippets that affect the instruction


## 15) How We Use AI Safely and Effectively

AI must:
- follow repo guidelines (TDD, file structure, seeds/constants)
- avoid inventing new requirements
- surface any ambiguity as assumptions in the output (briefly)
- keep logic deterministic and test-backed

Engineer must:
- run tests locally
- sanity-check all token transfer logic and authority constraints
- review account sizing carefully (Anchor requires exact sizing)


## Appendix A: Planned Instruction Order (Recommended)

1. `create_warehouse`
2. `register_farmer`
3. `set_farmer_warehouse`
4. `register_customer`
5. `request_customer_confirmation`
6. `confirm_customer`
7. `revoke_customer`
8. `publish_offer`
9. `deactivate_offer`
10. `create_order`
11. `quote_delivery_fee`
12. `accept_delivery_fee`
13. `reject_delivery_fee`
14. `refuse_delivery`
15. `mark_in_transit`
16. `complete_order`
17. `expire_order`


## Appendix B: Philosophy Note

This system is not a “platform capture” design. It’s a cooperation-aligned rail:
- Farmers remain sovereign over their farm history.
- Customers gain transparency without surveillance.
- Warehouses provide real-world logistics, compensated explicitly and fairly.
