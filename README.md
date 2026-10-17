# Katūbayá Solana Bridge (Marketplace + Logistics Escrow)

A Solana program (Rust + Anchor) that acts as a **Bridge** for katubaya: enabling transparent on-chain listings and purchases, while preserving **customer privacy** and letting a **warehouse/logistics operator** guarantee fulfillment using **escrow**.

This program is intentionally modular:
- **Katūbaya** remains the farmer-owned, offline-first system of record.
- The **Bridge** provides market rails: listings, routing via warehouses, order lifecycle, escrow, and verifiable sales events.
- It should to be extinsible to any network, but starting with Solana.

---

## 1. Product Goals

### Primary
1. **Market transparency**
   - Customers can see what they’re buying (crop/cultivar/unit/qty/price/expiry/notes).
   - Customers can see who they’re buying from (farmer pubkey + public profile URI).
   - No rankings or reputation systems.

2. **Customer privacy**
   - Customer full address is collected **off-chain** by the warehouse (never on-chain).
   - On-chain only stores a warehouse-issued confirmation relationship for eligibility.

3. **Guaranteed fulfillment via escrow**
   - Funds are held in escrow until warehouse marks the order **IN_TRANSIT** and then **FULFILLED**.
   - Warehouse/logistics receives fees upon completion.

### Secondary
- Provide events that katubaya can ingest to update inventory (append-only).
- Support a future DApp where farmer pubkeys become public profiles and offers become a discoverable market.

---

## 2. Non-Goals (MVP)
- No on-chain storage of katubaya JSON exports (only pointers/hashes optionally).
- No on-chain private messaging or address exchange.
- No automated inventory mutation on-chain (inventory updates are derived off-chain from events).
- No rankings, social feeds, or reputation.

---

## 3. Off-chain Components (Required by Design)

### 3.1 Customer address exchange (off-chain)
Before a customer can buy:
- Customer and warehouse communicate off-chain (WhatsApp, phone, in-person, later: private chat).
- Warehouse collects:
  - full delivery address and delivery constraints
  - contact preferences
- Warehouse then confirms the customer **on-chain**.

### 3.2 Optional encrypted katubaya pack pointer
Farmers may publish a pointer to encrypted katubaya export data:
- Stored off-chain (Arweave/IPFS/HTTPS blob)
- On-chain stores: URI + ciphertext hash (integrity anchor)
- Decryption keys remain farmer-controlled (not part of MVP)

---

## 4. Core On-chain Model

### Entities
- **Warehouse**: fulfillment operator; confirms customers; quotes delivery fees; controls lifecycle and escrow release.
- **Farmer**: publishes offers (lots) tied to a warehouse; receives payout on fulfillment.
- **Customer**: places orders and approves delivery fee quotes.
- **Offer**: transparent listing of a lot/item available for sale.
- **Order**: escrowed purchase, with mandatory lifecycle transitions controlled by warehouse.

---

## 5. Program Accounts (Anchor)

> All variable-size fields MUST be bounded (max length), and vectors must have max size caps.

### 5.1 ProgramConfig (PDA)
**Seeds:** `["config"]`
- `admin: Pubkey`
- `logistics_wallet: Pubkey` (fee receiver; typically admin)
- `paused: bool`
- `allowed_mints: Vec<Pubkey>` (optional allowlist)

### 5.2 Warehouse (PDA)
**Seeds:** `["warehouse", warehouse_id_u64_le]`
- `warehouse_id: u64`
- `operator: Pubkey` (signer for confirmations + lifecycle changes)
- `name: String` (bounded)
- `pickup_notes: String` (bounded)
- `fee_bps: u16` (service fee on subtotal; bps = basis points)
- `delivery_fee_rules_uri: Option<String>` (bounded; transparency doc, optional)
- `deliver_zip_prefixes: Vec<ZipPrefix>` (bounded; discovery only)

**ZipPrefix (public discovery, not strict routing enforcement)**
- `prefix: u32` (e.g., 123)
- `len: u8` (3/4/5)

> Enforcement is primarily via customer confirmation, but zip coverage helps UI filtering.

### 5.3 FarmerProfile (PDA)
**Seeds:** `["farmer", farmer_pubkey]`
- `authority: Pubkey` (farmer signer)
- `warehouse: Pubkey` (Warehouse requested at registration)
- `warehouse_approved: bool` (set by the warehouse operator; required to publish offers)
- `display_name: String` (bounded)
- `public_profile_uri: String` (bounded)

### 5.4 CustomerProfile (PDA)
**Seeds:** `["customer", customer_pubkey]`
- `authority: Pubkey`
- `public_profile_uri: Option<String>` (bounded; optional)

### 5.5 WarehouseCustomer (PDA) **(Key to customer privacy + eligibility)**
**Seeds:** `["wcustomer", warehouse_pubkey, customer_pubkey]`
- `warehouse: Pubkey`
- `customer: Pubkey`
- `status: WarehouseCustomerStatus`:
  - `PENDING`
  - `CONFIRMED`
  - `REVOKED`
- `confirmed_at: Option<i64>`
- `notes_hash: Option<[u8;32]>` (optional hash of off-chain record; never PII)

### 5.6 PackPointer (PDA) **(Optional)**
**Seeds:** `["pack", farmer_pubkey, pack_id_u64_le]`
- `farmer: Pubkey`
- `warehouse: Pubkey` (optional for filtering)
- `schema_version: [u8;16]`
- `ciphertext_hash: [u8;32]`
- `uri: String` (bounded)
- `created_at: i64`

### 5.7 LotOffer (PDA) **(Transparent listing)**
**Seeds:** `["offer", farmer_pubkey, offer_id_u64_le]`
- `farmer: Pubkey`
- `warehouse: Pubkey`
- `offer_id: u64`
- `pack_ref: Option<Pubkey>` (PackPointer optional)
- Public item fields:
  - `crop_name: String` (bounded)
  - `cultivar_name: Option<String>` (bounded)
  - `unit_code: u16` (see Unit Encoding)
  - `expires_at: Option<i64>`
  - `notes_public: Option<String>` (bounded)
- Pricing:
  - `mint: Pubkey` (SPL token mint, e.g., USDC)
  - `price_minor: u64` (integer minor units)
- Stock:
  - `qty_remaining: u64` (integer base units)
  - `active: bool`
- `created_at: i64`

### 5.8 Order (PDA) + Escrow Token Account
**Seeds:** `["order", offer_pubkey, customer_pubkey, order_id_u64_le]`

Order fields:
- `order_id: u64`
- `offer: Pubkey`
- `farmer: Pubkey`
- `warehouse: Pubkey`
- `customer: Pubkey`
- `mint: Pubkey` (copied from the offer; `transfer_checked` needs it)
- `qty: u64`
- `subtotal_minor: u64`
- `service_fee_minor: u64` (stored at create for determinism)
- `delivery_fee_minor: u64` (0 until accepted)
- `fulfillment_mode: FulfillmentMode`:
  - `PICKUP`
  - `DELIVERY`
- `status: OrderStatus` (see lifecycle)
- `created_at: i64`
- `expires_at: i64` (timeouts)
- `escrow_bump: u8` (lets the program sign escrow withdrawals without re-deriving)

**Escrow Token Account**
- Token account at PDA `["escrow", order_pubkey]`, and its own authority: the program signs withdrawals with those seeds
- Holds:
  - Pickup: `subtotal_minor`
  - Delivery: `subtotal_minor` then later `+ delivery_fee_minor` after acceptance

---

## 6. Order Lifecycle (Mandatory IN_TRANSIT)

### Status enum
- `ESCROWED_PICKUP` (pickup order created, subtotal escrowed)
- `PENDING_DELIVERY_QUOTE` (delivery order created, subtotal escrowed, waiting quote)
- `DELIVERY_QUOTED` (warehouse quoted delivery fee, waiting customer response)
- `ESCROWED_READY` (delivery fee accepted and escrowed; order ready)
- `IN_TRANSIT` **(mandatory)**
- `FULFILLED`
- `REFUSED` (warehouse refused delivery order)
- `CANCELED` (customer rejected quote / canceled before transit)
- `EXPIRED`

### Mandatory transitions
- Pickup:
  - `ESCROWED_PICKUP` → `IN_TRANSIT` → `FULFILLED`
- Delivery:
  - `PENDING_DELIVERY_QUOTE` → `DELIVERY_QUOTED` → `ESCROWED_READY` → `IN_TRANSIT` → `FULFILLED`

### Rules
- `FULFILLED` can **only** be reached from `IN_TRANSIT`.
- Warehouse controls `IN_TRANSIT` and `FULFILLED`.
- Customer can cancel only in safe pre-transit stages:
  - reject quote (`DELIVERY_QUOTED`) OR cancel before warehouse locks transport.
- Warehouse can refuse delivery orders (pre-transit).

---

## 7. Fees & Payouts

### Service fee (warehouse/logistics)
- `service_fee_minor = subtotal_minor * fee_bps / 10_000`
- Paid to `logistics_wallet` on completion.

### Delivery fee (dynamic quote)
- Only for `DELIVERY` mode.
- Quoted by warehouse after order creation.
- Customer must approve (escrow additional fee) or reject (cancel/refund).
- On completion: delivery fee is paid to `logistics_wallet` (or a warehouse-specific receiver if added later).

### Farmer payout
- `farmer_payout = subtotal_minor - service_fee_minor`
- Paid on `FULFILLED`.

---

## 8. Instruction Set (MVP)

### 8.1 Admin / Warehouse
- `init_config(logistics_wallet, paused, allowed_mints?)`
- `set_paused(paused)` (admin; the only writer of `config.paused`, which gates market instructions)
- `create_warehouse(warehouse_id, operator, name, pickup_notes, fee_bps, deliver_zip_prefixes, delivery_fee_rules_uri?)`
- `update_warehouse(...)` (fees, notes, operator, prefixes)

### 8.2 Farmer onboarding
- `register_farmer(warehouse, display_name, public_profile_uri)`
  - signer: farmer
  - creates `FarmerProfile` with `warehouse` set and `warehouse_approved = false` (the request)
- `set_farmer_warehouse()`
  - signer: `warehouse.operator` of `farmer.warehouse`
  - sets `warehouse_approved = true` (the approval)

### 8.3 Customer onboarding + confirmation
- `register_customer(public_profile_uri?)`

**Confirmation flow**
1) `request_customer_confirmation(warehouse)`
   - signer: customer
   - creates/sets `WarehouseCustomer = PENDING`
2) `confirm_customer(warehouse, customer, notes_hash?)`
   - signer: warehouse.operator
   - requires off-chain address collection already done
   - sets `CONFIRMED`
3) `revoke_customer(warehouse, customer)`
   - signer: warehouse.operator
   - sets `REVOKED`

> Eligibility check for ordering requires `WarehouseCustomer.status == CONFIRMED`.

### 8.4 Publishing offers (transparent market)
- `publish_offer(offer_id, crop_name, cultivar_name?, unit_code, qty, price_minor, mint, expires_at?, notes_public?, pack_ref?)`
  - signer: farmer
  - requires `farmer.warehouse_approved`
  - mint allowed if `config.allowed_mints` is non-empty (checked here, once; orders trust `offer.mint`)
- `deactivate_offer(offer_id)` (stop purchases)
- optional:
  - `update_offer_price(offer_id, new_price_minor)`
  - `increase_offer_qty(offer_id, delta_qty)`

### 8.5 Creating orders (escrow)
**Create order**
- `create_order(order_id, offer, qty, mode)`
  - signer: customer
  - checks:
    - program not paused
    - offer active and qty available
    - **WarehouseCustomer confirmed** for (offer.warehouse, customer)
  - reserve stock immediately:
    - `offer.qty_remaining -= qty`
  - escrow subtotal:
    - transfer `subtotal = qty * price_minor` from customer ATA → escrow ATA
  - status:
    - pickup → `ESCROWED_PICKUP`
    - delivery → `PENDING_DELIVERY_QUOTE`

**Quote delivery fee (delivery only)**
- `quote_delivery_fee(order, delivery_fee_minor)`
  - signer: warehouse.operator
  - requires `status == PENDING_DELIVERY_QUOTE`
  - sets `delivery_fee_minor`, status → `DELIVERY_QUOTED`

**Customer accepts delivery fee (delivery only)**
- `accept_delivery_fee(order)`
  - signer: customer
  - requires `status == DELIVERY_QUOTED`
  - escrow delivery fee:
    - transfer `delivery_fee_minor` customer ATA → escrow ATA
  - status → `ESCROWED_READY`

**Customer rejects delivery fee**
- `reject_delivery_fee(order)`
  - signer: customer
  - requires `status == DELIVERY_QUOTED`
  - refund escrow subtotal to customer
  - restore stock: `offer.qty_remaining += qty`
  - status → `CANCELED`

**Warehouse refuses delivery**
- `refuse_delivery(order)`
  - signer: warehouse.operator
  - requires:
    - order.mode == DELIVERY
    - status in `{PENDING_DELIVERY_QUOTE, DELIVERY_QUOTED, ESCROWED_READY}`
  - refund escrow (subtotal + any accepted delivery fee)
  - restore stock
  - status → `REFUSED`

### 8.6 Mandatory transport & completion
**Warehouse marks IN_TRANSIT (mandatory)**
- `mark_in_transit(order)`
  - signer: warehouse.operator
  - requires:
    - pickup: `status == ESCROWED_PICKUP`
    - delivery: `status == ESCROWED_READY`
  - status → `IN_TRANSIT`

**Warehouse completes order (releases escrow)**
- `complete_order(order)`
  - signer: warehouse.operator
  - requires `status == IN_TRANSIT`
  - transfers:
    - farmer payout = `subtotal - service_fee` → farmer ATA
    - logistics payout = `service_fee + delivery_fee` → logistics_wallet ATA
  - status → `FULFILLED`

### 8.7 Timeouts / expirations
- `expire_order(order)`
  - callable by anyone after `expires_at`
  - refunds escrow
  - restores stock
  - status → `EXPIRED`

Recommended expiry defaults:
- Delivery quote pending: short (e.g., 1–6 hours)
- Quoted awaiting acceptance: short (e.g., 1–6 hours)
- Pickup escrowed: longer (e.g., 24–72 hours) depending on operations

Implemented as constants in `states.rs`: 6 h, 6 h and 72 h; `ESCROWED_READY` reuses the 72 h window.

---

## 9. Event Interface (Integration Backbone)

Emit events for indexing and katubaya synchronization:

- `CustomerConfirmationRequested { warehouse, customer }`
- `CustomerConfirmed { warehouse, customer }`
- `CustomerRevoked { warehouse, customer }`

- `OfferPublished { offer, farmer, warehouse, crop_name, cultivar_name, unit_code, qty, price_minor, mint, expires_at }`
- `OfferDeactivated { offer }`

- `OrderCreated { order, offer, farmer, warehouse, customer, qty, subtotal_minor, service_fee_minor, mode }`
- `DeliveryFeeQuoted { order, delivery_fee_minor }`
- `DeliveryFeeAccepted { order }`
- `DeliveryFeeRejected { order }`
- `OrderRefused { order }`

- `OrderInTransit { order }`
- `OrderCompleted { order, subtotal_minor, service_fee_minor, delivery_fee_minor, farmer_payout, logistics_payout }`

- `OrderCanceled { order }`
- `OrderExpired { order }`

### katubaya inventory reconciliation
katubaya (or a Bridge indexer) ingests `OrderCompleted` and records an internal:
- `InventoryAdjustment(reason="sale", deltaQuantity = -qty, ...)`

Then katubaya generates updated Availability Packs and publishes new offers if needed.

---

## 10. Unit Encoding (On-chain integer quantities)
katubaya uses `DecimalString`. On-chain uses integers for safety.

Recommended encoding:
- `kg` → store grams (g)
- `liter` → store milliliters (ml)
- `g` and `ml` are already base units
- `unit/bunch/bag/tray/box` → store counts

Define a stable mapping:
- `unit_code` is a `u16` that maps to a known enum in clients (Codama + frontend).
- Example mapping:
  - 1 = g
  - 2 = kg (encoded as grams)
  - 3 = ml
  - 4 = liter (encoded as ml)
  - 10 = unit
  - 11 = bunch
  - 12 = bag
  - 13 = tray
  - 14 = box

Clients must convert UI quantities ↔ on-chain integers deterministically.

---

## 11. Token Handling (SPL)
- Use SPL token transfers for payment (e.g., USDC).
- Prefer `anchor_spl::token_interface` to support both Token Program and Token-2022.
- Escrow ATA should be a program-derived authority account.

---

## 12. Security & Validation Notes

### Must-have checks
- Program pause gate (`config.paused`)
- Mint allowlist enforced once at `publish_offer`
- Offer active and sufficient quantity
- WarehouseCustomer CONFIRMED before order creation
- Delivery quote/acceptance states enforced exactly
- Warehouse operator must match order.warehouse.operator for:
  - confirmation
  - quoting
  - in-transit
  - completion
  - refusal

### Stock reservation correctness
On `create_order`, decrement offer stock immediately.
On any cancellation/refusal/expiry before completion, restore stock.

### Re-entrancy / double spend protection
- Status transitions are single-path.
- Escrow release only from `IN_TRANSIT`.

---

## 13. Client / DApp UX Flows (High-level)

### Warehouse operator
1) Sees confirmation requests
2) Collects address off-chain
3) Confirms customer on-chain
4) For delivery orders: quotes fee, then later marks IN_TRANSIT and completes

### Farmer
1) Registers profile and joins warehouse
2) Publishes offers (transparent items)
3) Watches sales events (or uses indexer) for inventory reconciliation

### Customer
1) Registers profile
2) Requests warehouse confirmation (off-chain address exchange)
3) Buys:
   - pickup: immediate escrow → wait warehouse transit/completion
   - delivery: escrow subtotal → wait quote → accept/reject → wait transit/completion

---

## 14. Roadmap (Suggested)

### Phase 1 (MVP)
- All accounts/instructions above
- Events + basic indexer compatibility
- Codama client generation from IDL

### Phase 2
- Warehouse-specific payout wallet (separate from global logistics wallet)
- Dispute flow (optional): warehouse arbitration window; partial refunds
- Offer bundling (cart across multiple offers same warehouse)

### Phase 3
- Private off-chain chat integration
- Attestations: warehouse signs delivery receipt; optional proof attachments (off-chain)

---

## 15. Implementation Notes (Anchor)

### Account sizing
- Define constants:
  - `MAX_NAME_LEN`
  - `MAX_URI_LEN`
  - `MAX_NOTES_LEN`
  - `MAX_ZIP_PREFIXES`
  - `MAX_ALLOWED_MINTS`
- Derive `InitSpace`, bound with `#[max_len(CONST)]`, `space = 8 + Struct::INIT_SPACE`.

### PDA seeds
Keep them stable:
- config: `["config"]`
- warehouse: `["warehouse", warehouse_id]`
- farmer: `["farmer", farmer_pubkey]`
- customer: `["customer", customer_pubkey]`
- warehouse-customer: `["wcustomer", warehouse, customer]`
- offer: `["offer", farmer, offer_id]`
- order: `["order", offer, customer, order_id]`
- escrow authority: `["escrow", order]`

---

## 16. Optional: PackPointer Integration
This program does not depend on katubaya packs, but may optionally allow:
- `publish_pack_pointer(...)`
- linking offers to packs for provenance

This keeps katubaya data farmer-owned and portable, while enabling third-party Bridges.

---

## License / Philosophy
This Bridge is inspired by agroforest cooperation: enable direct relationships, reduce domination, and keep data ownership aligned with human dignity.
