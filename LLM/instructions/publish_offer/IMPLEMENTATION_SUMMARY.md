# publish_offer: change log

## Files

Program
- `programs/farmer-core/src/instructions/publish_offer.rs` (created): `PublishOffer` + handler; later gained the `mint` account, `DENIED_MINT_EXTENSIONS` and the private `deny_mint_extensions`
- `programs/farmer-core/src/instructions/mod.rs` (modified): `pub mod publish_offer; pub use publish_offer::*;`
- `programs/farmer-core/src/lib.rs` (modified): `publish_offer(ctx, offer_id, crop_name, cultivar_name, unit_code, qty, price_minor, expires_at, notes_public, pack_ref)` wrapper — nine args, the `mint: Pubkey` arg removed
- `programs/farmer-core/src/states.rs` (modified, M3): `LotOffer` added; `SEED_OFFER`, `MAX_NAME_LEN`, `MAX_NOTES_LEN` pre-existing
- `programs/farmer-core/src/errors.rs` (modified, M3 and after): Offer section appended at the end, `FarmerNotApproved` 6015 through `OfferInactive` 6020; `MintExtensionNotAllowed` 6033 appended last, in a new "Mint extensions" section. This instruction raises `FarmerNotApproved`, `InvalidQuantity`, `InvalidPrice`, `InvalidExpiry`, `MintExtensionNotAllowed` plus the pre-existing `ProgramPaused`, `MintNotAllowed`, `NameTooLong`, `NotesTooLong`
- `programs/farmer-core/src/events.rs` (modified, M3): `OfferPublished` (emitted here) and `OfferDeactivated` (sibling `deactivate_offer`) appended

Tests
- `tests/publish_offer.ts` (created, later extended): happy path + event + every stored field, optional args as `null`, `pack_ref` stored, not approved, a real mint outside the allowlist, a pubkey that is not a mint, an allowlisted transfer-fee mint, paused (unpause in `finally`), three length errors, zero qty, zero price, past expiry, duplicate id — 15 cases
- `tests/helpers.ts` (modified, M3 and after): `offerPDA`, `approvedFarmer`, `offerArgs`, `publishOfferTx`, `publishOffer`, `setPaused`; `publishOfferTx` now passes `{ farmer, mint }` as accounts instead of the mint argument, and `feeMint()` plus the private `createFeeMint()` fixture were added (a Token-2022 mint with a `TransferFeeConfig` extension, built from `SystemProgram.createAccount` + `createInitializeTransferFeeConfigInstruction` + `createInitializeMint2Instruction` because `createMint` cannot add extensions) and pushed into `config.allowed_mints` on purpose

Docs
- `LLM/instructions/publish_offer/HOW_IT_WORKS.md`
- `LLM/instructions/publish_offer/IMPLEMENTATION_INSTRUCTIONS.md`
- `LLM/instructions/publish_offer/IMPLEMENTATION_SUMMARY.md`
- `README.md` section 8.1 (modified, M3): `set_paused` line added, the toggle this instruction's pause gate depends on; section 8.4 (modified): the mint is an account, the extension rejection listed; section 11 (modified): the five denied extensions and why; section 12 (modified): the allowlist line now also covers non-mint pubkeys and denied extensions
- `docs/DEVELOPMENT_PLAN.md` M3 (modified): `set_paused` added to the milestone for the same reason

## Decisions

- Nine args mirror README 8.4; `offer_id` is an explicit `u64` arg and seed, no on-chain counter, a duplicate fails at `init` ("already in use").
- **The mint is an account, not an argument (ABI change).** `pub mint: InterfaceAccount<'info, Mint>` (`anchor_spl::token_interface`) sits between `offer` and `farmer`; the handler reads `ctx.accounts.mint.key()`. The IDL entry carries no `pda`, `address` or `relations`, so the client must pass it. Two gaps close for free: a pubkey that is not a real mint fails at deserialization (`AccountNotInitialized` 3012 when nothing is allocated there, `AccountOwnedByWrongProgram` 3007 when another program owns it) instead of being stored and only proven real at the first `transfer_checked`, and the empty-allowlist branch no longer accepts arbitrary pubkeys. The program needs the mint's data, not just its key, for the extension check below.
- Five token extensions denied by `deny_mint_extensions` right after the allowlist: `TransferFeeConfig`, `TransferHook`, `PermanentDelegate`, `ConfidentialTransferMint`, `Pausable` (README 11). Each would strand or endanger escrowed money: a withheld transfer fee makes the escrow hold less than the subtotal (breaking `complete_order`'s `escrow.amount - farmer_payout`) and `close_account` fails with `AccountHasWithheldTransferFees`; a hook can block or re-route a transfer, and `transfer_checked` is issued without the hook's extra account metas; a permanent delegate can move tokens out of any account, the escrow included; non-zero confidential balances stop `close_account`; a pausable mint lets its authority freeze transfers while the escrow is funded.
- The denylist is **defence in depth behind `config.allowed_mints`**, which is admin-curated and immutable after `init_config`: it catches an allowlisted mint that should not have been listed. Publish time is sufficient — a mint's extensions are fixed when the mint is initialized — so nothing is re-checked in `create_order` or `complete_order`.
- `deny_mint_extensions` unpacks the mint with `StateWithExtensions::<MintState>::unpack` (`spl_token_2022` via `anchor_spl::token_2022::spl_token_2022`); a legacy SPL Token mint unpacks with an empty extension list, so one path serves both token programs. It is a handler `require!`, not an `#[account]` constraint (like the allowlist), because it borrows and parses account data; both fallible calls map to `MintExtensionNotAllowed`.
- `MintExtensionNotAllowed` appended last (6033, "Mint carries a token extension this program cannot escrow safely"), keeping every existing code stable; the enum is now 34 variants, 6000-6033.
- Seeds `["offer", farmer_wallet, offer_id LE]`; `LotOffer.farmer` is the wallet (authority), not the `FarmerProfile` PDA, so `deactivate_offer` gates with `has_one = farmer` on the signer.
- `farmer_profile` derived from the signer's key and gated by `constraint = warehouse_approved @ FarmerNotApproved`; a farmer cannot pass another's approved profile.
- `warehouse` copied from `farmer_profile.warehouse`; no `Warehouse` account loaded, no warehouse arg.
- Mint allowlist enforced once, here (`is_empty() || contains`); `create_order` (M4) trusts `offer.mint`. Empty-list branch untested: the shared config has three mints and no instruction edits the list.
- `constraint = !config.paused` on `config` (market instruction). `set_paused` added in M3 so the gate can be exercised and operated; the test restores `paused = false` in `finally` because `ProgramConfig` is a singleton shared by every test file.
- Gates are `#[account]` constraints; `require!` only validates args and the mint, in handler order: names, notes, `qty`, `price_minor`, `expires_at`, allowlist, extensions.
- `created_at` from `Clock::get()`, the same `now` used for the `InvalidExpiry` check; never from the client.
- `qty` stored as `qty_remaining`, `active = true` at publish; `pack_ref` (an unvalidated hint; M7 deferred, README 16) and `unit_code` (client mapping, README 10) stored unvalidated.
- Farmer pays rent (`payer = farmer`, 895 bytes); the provider wallet is not involved.
- `update_offer_price` / `increase_offer_qty` (README 8.4 optional) not implemented and not on the roadmap.
- Only one denied extension is exercised (`feeMint()`, a transfer-fee mint): the other four hit the same branch of the same loop. The test file covers every named error (`NameTooLong` twice, from `crop_name` and from `cultivar_name`) and skips missing-profile and missing-signer cases (framework-level).
- Compute ~31k CU, up from ~26k before the mint became an account (measured as the suite maximum and rounded: the figure drifts by a few thousand between runs); no compute-budget instruction needed.

## Prerequisites

- `ProgramConfig` created via `init_config`, with `paused = false` (or reset through `set_paused`) and the mint in `allowed_mints` (or an empty list)
- A real mint account, on either token program, carrying none of the five denied extensions; the client must pass it explicitly
- A `Warehouse` created by the admin via `create_warehouse`
- A `FarmerProfile` for the signer created via `register_farmer` (requesting that warehouse) and approved by the warehouse operator via `set_farmer_warehouse` (`warehouse_approved = true`)
- The farmer keypair funded: it signs and pays rent for the 895-byte `LotOffer` (tests: `fund()` airdrops 2 SOL)
- An `offer_id` not yet used by this farmer (`freshId()` in tests)

## History

- 2026-10-17 M3: created
- 2026-10-17 M6 follow-up: the mint became an account instead of an argument (nine args now), `deny_mint_extensions` added behind the allowlist with the new `MintExtensionNotAllowed` (6033)
