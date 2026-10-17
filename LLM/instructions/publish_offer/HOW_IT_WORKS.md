# publish_offer

## Purpose

An approved farmer signs to publish a transparent lot offer. The instruction creates the `LotOffer` PDA keyed by
the farmer's wallet and an explicit `offer_id`, copies the warehouse from the farmer's profile, stores the public
item, pricing and stock fields, sets `active = true`, stamps `created_at` from the cluster clock and emits
`OfferPublished`. It implements README.md section 8.4 (signer: farmer; requires `farmer.warehouse_approved`;
mint allowed if `config.allowed_mints` is non-empty, checked here once) on the account of section 5.7, under the
pause gate and the "mint allowlist enforced once at `publish_offer`" rule of section 12.

## Lifecycle

```mermaid
sequenceDiagram
    participant F as Farmer (client, signer, payer)
    participant Pg as farmer_core::publish_offer
    participant CF as ProgramConfig (PDA, read)
    participant FP as FarmerProfile (PDA, read)
    participant LO as LotOffer (PDA, init)

    F->>Pg: publishOffer(offer_id, crop_name, cultivar_name, unit_code, qty, price_minor, mint, expires_at, notes_public, pack_ref) with farmer
    Note over F,Pg: farmer not signed -> "Signature verification failed" (runtime, before the program runs)
    Pg->>CF: deserialize (seeds config)
    Pg->>FP: deserialize (seeds farmer + farmer key)
    Note over Pg,FP: missing -> AccountNotInitialized (3012)
    Pg->>LO: init (seeds offer + farmer key + offer_id LE), payer farmer, 895 bytes
    Note over Pg,LO: duplicate offer_id -> "already in use" (system program)
    Pg->>Pg: constraint not config.paused
    Note over Pg: fail -> ProgramPaused (6001)
    Pg->>Pg: constraint farmer_profile.warehouse_approved
    Note over Pg: fail -> FarmerNotApproved (6015)
    Pg->>Pg: require crop_name and cultivar_name within MAX_NAME_LEN
    Note over Pg: fail -> NameTooLong (6004)
    Pg->>Pg: require notes_public within MAX_NOTES_LEN
    Note over Pg: fail -> NotesTooLong (6005)
    Pg->>Pg: require qty and price_minor non-zero
    Note over Pg: fail -> InvalidQuantity (6017), InvalidPrice (6018)
    Pg->>Pg: require expires_at after Clock now, when Some
    Note over Pg: fail -> InvalidExpiry (6019)
    Pg->>Pg: require allowed_mints empty or contains mint
    Note over Pg: fail -> MintNotAllowed (6003)
    Pg->>LO: write all fields, warehouse = farmer_profile.warehouse, qty_remaining = qty, active = true, created_at = now
    Pg-->>F: emit OfferPublished(offer, farmer, warehouse, crop_name, cultivar_name, unit_code, qty, price_minor, mint, expires_at), Ok
```

Account gates (`init`, pause, approval) run before any `require!`; the `require!` chain validates the arguments in
the handler order shown, then the handler writes the fourteen `LotOffer` fields and emits.

## Components

| Instruction | Signer | Accounts (name, role, client resolution) | Args | Events |
|---|---|---|---|---|
| `publish_offer` | `farmer` (wallet; also pays rent) | `config` (read, pause gate + allowlist; auto from IDL, const seeds), `farmer_profile` (read, approval gate + source of `warehouse`; auto, seeds from `farmer`), `offer` (init, the listing; auto, seeds from `farmer` + `offer_id` arg), `farmer` (signer, mut payer; must pass via `.accountsPartial` + `.signers`), `system_program` (auto) | `offer_id: u64`, `crop_name: String`, `cultivar_name: Option<String>`, `unit_code: u16`, `qty: u64`, `price_minor: u64`, `mint: Pubkey`, `expires_at: Option<i64>`, `notes_public: Option<String>`, `pack_ref: Option<Pubkey>` | `OfferPublished { offer, farmer, warehouse, crop_name, cultivar_name, unit_code, qty, price_minor, mint, expires_at }` |

Handler: `programs/farmer-core/src/instructions/publish_offer.rs`; wrapper:
`farmer_core::publish_offer` in `programs/farmer-core/src/lib.rs`.

## Data model

Created: `LotOffer` (seeds `["offer", farmer_pubkey, offer_id u64 LE]`, 8 + INIT_SPACE = 895 bytes). All fourteen fields are
written here: `farmer` = the signer's wallet (not the `FarmerProfile` PDA), `warehouse` = `farmer_profile.warehouse`,
`qty_remaining` = `qty`, `active` = true, `created_at` = cluster clock; the other nine (`offer_id`, `pack_ref`, `crop_name`,
`cultivar_name`, `unit_code`, `expires_at`, `notes_public`, `mint`, `price_minor`) are the args as given. `deactivate_offer`
later flips `active`.

Read: `ProgramConfig` (seeds `["config"]`, 8 + INIT_SPACE = 1037 bytes) for `paused` and `allowed_mints`;
`FarmerProfile` (seeds `["farmer", farmer_pubkey]`, 8 + INIT_SPACE = 381 bytes) for `warehouse_approved` and
`warehouse`.

Not touched: `Warehouse` (its key comes from the profile), `CustomerProfile`, `WarehouseCustomer`.

## Design decisions

- **Explicit `offer_id`, no counter.** The client picks the id; it is an arg and a seed, so a duplicate fails at
  `init` with the system program's "already in use" (AGENTS.md "PDA Seeds"). Verified by "rejects a duplicate offer_id".
- **Seeds use the farmer's wallet, not the `FarmerProfile` PDA.** `LotOffer.farmer` is the authority, so
  `deactivate_offer` gates with `has_one = farmer` on the signer without loading the profile.
- **`farmer_profile` is re-derived from the signer** (`seeds = [SEED_FARMER, farmer.key()]`): a farmer cannot
  present someone else's approved profile. `FarmerNotApproved` is a constraint on it (AGENTS.md "Gates as constraints").
- **`warehouse` is copied from the profile, not an arg.** The offer belongs to the warehouse that approved the
  farmer; no `Warehouse` account is loaded.
- **Mint allowlist enforced once, here.** `allowed_mints.is_empty() || contains(&mint)`; `create_order` (M4) trusts
  `offer.mint` (README 8.4 and 12). The empty-list branch accepts any mint and is not covered by tests: the shared
  config is created with one mint and no instruction can change the list.
- **Pause gate on `config`.** `publish_offer` is a market instruction (AGENTS.md "Validation Rules"). `set_paused`
  was added in M3 because nothing else could change `paused` after `init_config`, so the gate could never be
  exercised or operated; the test pauses, asserts `ProgramPaused` and unpauses in `finally` because `ProgramConfig`
  is a singleton shared by every test file.
- **`require!` only on args, in handler order:** names, notes, `qty`, `price_minor`, `expires_at`, mint. Zero
  quantity or price would make an unsellable listing; `expires_at` is compared with the same `Clock` value stored
  in `created_at`, so an offer cannot be published already expired.
- **`pack_ref` and `unit_code` are stored unvalidated.** `PackPointer` lands in M7 (comment in `states.rs`);
  `unit_code` is a client-side mapping (README section 10).
- **Farmer pays rent** (`payer = farmer`, `mut`): the listing is the farmer's account; the provider wallet is not involved.
- **No `update_offer_price` / `increase_offer_qty`.** README 8.4 lists them as optional; they are not implemented
  and not on the roadmap.

## Source

- `programs/farmer-core/src/instructions/publish_offer.rs`
- `programs/farmer-core/src/states.rs`
- `programs/farmer-core/src/errors.rs`
- `programs/farmer-core/src/events.rs`
- `programs/farmer-core/src/lib.rs`
- `tests/publish_offer.ts`
- `tests/helpers.ts`
