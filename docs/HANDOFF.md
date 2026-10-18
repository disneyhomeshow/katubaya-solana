# Handoff — Katubaya Solana Bridge (`farmer-core`)

Written 2026-10-17 at commit `86d8fb4`, branch `main`, clean tree.
**The user writes in Portuguese; answer in Portuguese.** This file is for the next agent.

## 1. State

The roadmap in `docs/DEVELOPMENT_PLAN.md` is **closed**: M0–M6 delivered, plus the M6.1 follow-up, and
M7 was specified and **deliberately deferred** (section 6 below).

| | |
|---|---|
| Instructions | 20 |
| Account types | 7 (`ProgramConfig`, `Warehouse`, `FarmerProfile`, `CustomerProfile`, `WarehouseCustomer`, `LotOffer`, `Order`) |
| Events | 13 |
| Error codes | 34, `6000`–`6033`, one `FarmerCoreError` enum |
| Tests | **136 passing** (`anchor test`, ~4 min), 24 files |
| Lint | `cargo fmt --check` clean, `cargo clippy -p farmer-core --all-targets` 0 warnings |

Milestone commits: `aafd4d2` M1, `3670ec8` M2, `a24a037` M3, `a95cf00` M4, `818b7ed` M5,
`aa503b8` M6, `86d8fb4` M6.1. `git log` bodies carry the per-milestone detail; read them before
re-deriving anything.

## 2. Read these first (do not re-derive)

| What | Where |
|---|---|
| Repo rules, layout, conventions, test helpers, common build errors | `AGENTS.md` |
| Product spec (accounts, lifecycle, fees, instruction set, events) | `README.md` sections 5–12, 16 |
| Roadmap, DoD, per-instruction checklist | `docs/DEVELOPMENT_PLAN.md` |
| Behaviour, technical reference and change log per instruction | `LLM/instructions/<name>/` (20 folders, three files each) |

## 3. Working agreement with the user (strict — learned over two sessions)

1. **Per milestone, in this order**: present a compact spec (accounts table with signer/constraints,
   handler, new errors, events, tests, and numbered "proposals you can veto") → wait for
   "Confirmado" → **tests first** → implementation → `anchor test` green → `cargo fmt` → docs →
   present results → **wait for an explicit go before `git commit`**. Never commit without it.
   Milestones go straight onto `main`, one commit each, message in the style of `git log`.
2. **Ponytail mode is on** (plugin `ponytail:ponytail`, level full): shortest working diff, no
   speculative abstractions, no scaffolding. Report tersely. `[lite]` means "build it and name the
   lazier alternative in one line".
3. The user vetoes and redirects freely and expects the trade-off stated, not hidden. When a decision
   is theirs, put it as a numbered proposal with a recommendation.

**Decisions already taken — do not relitigate:** explicit `u64` ids, no counters; gates as
`#[account]` constraints, `require!` only for arguments; `checked_*` with named errors; one error enum
with **new variants appended at the end only** (docs quote the codes); unused variants and unused
README events are kept on purpose; mint allowlist enforced once in `publish_offer`; escrow via
`anchor_spl::token_interface` + `transfer_checked`, a self-authority token account at
`["escrow", order]`, closed on every terminal path with the rent back to `order.customer`; three
expiry constants in `states.rs` (6 h / 6 h / 72 h); `deliver_zip_prefixes` stays on-chain; payout ATAs
must pre-exist; `register_farmer(warehouse)` = request and `set_farmer_warehouse` = approval; the
pause gate covers only `publish_offer` and `create_order`.

## 4. Environment gotchas (all in `AGENTS.md` "Common Errors"; repeated because they bite)

- `anchor build` compiles with platform-tools v1.48 (cargo/rustc 1.84.1). Edition-2024 crates break
  it. `Cargo.lock` pins `blake3 1.5.5` and `zeroize_derive 1.4.2`. **Never run a bare `cargo update`.**
- `Anchor.toml` sets `[test] startup_wait = 30000`; a "Test validator does not look started" right
  after a long build is transient — rerun.
- Test files are loaded as **ES modules**: `require(...)` throws. Read JSON with
  `readFileSync` + `JSON.parse`. `import { BN } from "@coral-xyz/anchor"` resolves to `undefined`
  under that loader — take `BN` from `bn.js` or from `tests/helpers.ts`.
- A hand-run `tsc` needs `--skipLibCheck` (litesvm drags in `@solana/kit` types that want DOM libs);
  `tsconfig.json` already sets it. `ts-mocha` is transpile-only, so `anchor test` never type-checks.
- Red step before implementing: `npx tsc --noEmit --esModuleInterop --skipLibCheck --target es6
  --module commonjs --lib es2020 --types mocha,chai tests/*.ts` must fail **only** with
  "Property 'x' does not exist on type 'MethodsNamespace'".
- **Clock-dependent tests run on litesvm**, not the validator, which cannot be warped:
  `tests/expire_order_clock.ts` is the model — raw IDL through `BorshCoder` (snake_case instruction
  names, PascalCase account names and enum variants, `await` on `accounts.encode`), fixtures written
  with `svm.setAccount`, and `svm.expireBlockhash()` between two otherwise identical sends.
- Anchor 0.32 `try_accounts` order decides which error a test sees: every non-init account
  deserializes first in struct order, then inits, then constraints in struct order; within one account
  seeds → mut → signer → has_one → raw constraint → token constraints.
- Anchor's TS client reports event names in camelCase (`orderExpired`); Rust and the IDL are
  PascalCase. The raw IDL uses snake_case for instructions and fields, PascalCase for accounts.
- **Compute-unit figures drift.** `create_order` measured 56600 and then 58154 CU across two runs with
  no code change, so the per-instruction docs carry rounded figures on purpose. Measure from
  `.anchor/program-logs/<program-id>.farmer_core.log`, attributing the `consumed` line to the last
  `Instruction:` log seen at invoke depth 1 (a CPI's own log will mislead you otherwise).
- Rent is not the number you remember: a 165-byte token account is **1_488_440** lamports here
  (`solana rent 165`, and litesvm agrees), not the classic 2_039_280. Measure, never recite.
- Mermaid diagrams in the docs were never rendered (no CLI locally); verified by inspection only.

## 5. What the last two milestones changed

- **M6 (`aa503b8`)**: `expire_order`, permissionless (no `Signer` in the struct at all), refunding
  `escrow.amount`, restoring stock, from the four pre-transit statuses. `escrow::close` on all four
  terminal paths, rent back to `order.customer`. `complete_order` pays logistics the escrow remainder
  instead of `service_fee + delivery_fee`, so the account always reaches zero. Error `OrderNotExpired`,
  event `OrderExpired`. First Token-2022 end-to-end run.
- **M6.1 (`86d8fb4`)**: `update_warehouse` (admin-signed; operator rotation is the only exit for an
  escrow stuck in `InTransit`). `publish_offer` takes the mint as an **account** and rejects
  `TransferFeeConfig`, `TransferHook`, `PermanentDelegate`, `ConfidentialTransferMint` and `Pausable`
  (`MintExtensionNotAllowed`). `expires_at` reads inclusively everywhere.

## 6. M7 is specified and deferred — read before "finishing" it

The spec exists (`PackPointer` per README 5.6, `publish_pack_pointer`, and `publish_offer` taking the
pack as an optional account so the link can be validated). The user chose **not to build it**, because
nothing on-chain or in a client reads `pack_ref`, the anchor covers a *ciphertext* whose keys are out
of MVP scope, and the ~0.0023 SOL rent per pack would fall on the farmer for data nobody consumes.
README section 16 carries the decision and the warning.

**`LotOffer.pack_ref` is written and never validated or read.** Do not add a check without building
the account it would check against, and do not let a client render it as provenance. Revisit when a
katubaya client will actually read packs — the chain-anchored timestamp is the only part that cannot be
retrofitted later.

## 7. Settled "no"s — do not "fix" these

- After a terminal path the escrow is gone, so a replayed terminal call fails with
  `AccountNotInitialized`, not `InvalidOrderStatus`. Intentional and tested; the status gate still
  answers while the escrow is alive.
- An order already `InTransit` has no customer-side exit. `expire_order` excludes it on purpose
  (README 6: `FULFILLED` only from `IN_TRANSIT`, warehouse owns the outcome). Operator rotation via
  `update_warehouse` is the recovery path; if the admin key is gone too, nothing recovers it, and the
  real answer is the dispute flow README 14 defers to Phase 2.
- Only one of the five denied mint extensions is exercised by a test: the others hit the same `any()`
  over the same list. `tests/token2022.ts` is the negative control (a plain Token-2022 mint publishes).
- Surplus tokens sent to an escrow PDA go to logistics on completion and to the customer on a refund.
- `MAX_ALLOWED_MINTS = 30` although one legacy transaction fits at most 29 pubkeys.

## 8. Genuinely open, never ruled on by the user

- `ZipPrefix.prefix` is not bounded against `len`: `{ prefix: 123456, len: 3 }` passes in both
  `create_warehouse` and `update_warehouse`.
- No `update_config`: `admin`, `logistics_wallet` and `allowed_mints` are frozen after `init_config`,
  so a compromised admin key cannot be rotated.
- No `cancel_order`, although README 6 says the customer may cancel before transit and the
  `OrderCanceled` event exists and is never emitted (`reject_delivery_fee` sets `Canceled` but emits
  `DeliveryFeeRejected`).
- No farmer revocation: `order.farmer` is the wallet stored at creation, so a farmer removed from a
  warehouse off-chain is still paid by `complete_order`.
- Codama client generation from the IDL (README 14, Phase 1) was never done.
- `OfferPublished` does not carry `pack_ref`; the indexer must fetch `LotOffer` for it.

## 9. Commands

```bash
anchor test                                   # build + validator + all tests, ~4 min
cargo fmt -p farmer-core --check
cargo clippy -p farmer-core --all-targets
npx ts-mocha -p ./tsconfig.json tests/expire_order_clock.ts   # litesvm only, no validator, ~1 s
python3 -c "import json;idl=json.load(open('target/idl/farmer_core.json'));print([(e['code'],e['name']) for e in idl['errors']])"
```

## 10. Multi-agent patterns that paid off here

The user opted into multi-agent work (ultracode was on). Three shapes earned their keep:

1. **Scout before writing**, when the unknown is an external API: one agent per unknown, forced to
   *run* something and report verified facts, blockers and a paste-ready snippet. This is what proved
   litesvm viable and found the `close_account` exit-serialization answer before a line was written.
2. **Docs as writer + adversarial verifier, one pair per instruction folder**, the verifier told to
   assume errors until it has checked each claim against the code and the IDL, and to fix them in
   place. It caught stale account tables, a wrong signer story and invented test claims every time.
3. **Review as dimensions → adversarial verify**, two refuters per finding (one on reachability, one
   on impact), each defaulting to "refuted". Of the M6 findings, zero survived — which is the point:
   the surviving low-severity notes were the real work (a missing discriminating test, a wrong README
   payout rule, a duplicated helper).

Workflow scripts live under the session directory and will not survive; re-author from the pattern.

## 11. Skills worth calling

`ponytail:ponytail` (keep the discipline), `ponytail:ponytail-review` (self-review a milestone diff),
`security-review` and `code-review`, `mattpocock-skills:tdd` (the user mandates tests first),
`workflow-authoring` (before writing a workflow script),
`mattpocock-skills:diagnosing-bugs` (validator timing, Anchor constraint order).
`mattpocock-skills:handoff` is **user-invocable only** — ask the user to run it rather than imitating it.
