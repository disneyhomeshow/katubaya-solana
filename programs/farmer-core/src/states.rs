use anchor_lang::prelude::*;

// ============================================================================
// CONSTANTS
// ============================================================================

pub const MAX_NAME_LEN: usize = 100;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_NOTES_LEN: usize = 500;
pub const MAX_ZIP_PREFIXES: usize = 100;
pub const MAX_ALLOWED_MINTS: usize = 30; // round cap; a single 1232 B tx already fits at most 29 pubkeys
pub const MAX_FEE_BPS: u16 = 10_000;

// Order timeouts (seconds), one per waiting state. EscrowedReady reuses the pickup window.
pub const EXPIRY_PENDING_QUOTE_SECS: i64 = 6 * 60 * 60;
pub const EXPIRY_QUOTED_SECS: i64 = 6 * 60 * 60;
pub const EXPIRY_PICKUP_SECS: i64 = 72 * 60 * 60;

// ============================================================================
// SEED PHRASES
// ============================================================================

pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_WAREHOUSE: &[u8] = b"warehouse";
pub const SEED_FARMER: &[u8] = b"farmer";
pub const SEED_CUSTOMER: &[u8] = b"customer";
pub const SEED_WCUSTOMER: &[u8] = b"wcustomer";
pub const SEED_PACK: &[u8] = b"pack";
pub const SEED_OFFER: &[u8] = b"offer";
pub const SEED_ORDER: &[u8] = b"order";
pub const SEED_ESCROW: &[u8] = b"escrow";

// ============================================================================
// STATE ACCOUNTS
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub logistics_wallet: Pubkey,
    pub paused: bool,
    #[max_len(MAX_ALLOWED_MINTS)]
    pub allowed_mints: Vec<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ZipPrefix {
    pub prefix: u32,
    pub len: u8, // 3, 4 or 5 digits
}

#[account]
#[derive(InitSpace)]
pub struct Warehouse {
    pub warehouse_id: u64,
    pub operator: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_NOTES_LEN)]
    pub pickup_notes: String,
    pub fee_bps: u16,
    #[max_len(MAX_URI_LEN)]
    pub delivery_fee_rules_uri: Option<String>,
    #[max_len(MAX_ZIP_PREFIXES)]
    pub deliver_zip_prefixes: Vec<ZipPrefix>,
}

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

#[account]
#[derive(InitSpace)]
pub struct CustomerProfile {
    pub authority: Pubkey,
    #[max_len(MAX_URI_LEN)]
    pub public_profile_uri: Option<String>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum WarehouseCustomerStatus {
    Pending,
    Confirmed,
    Revoked,
}

#[account]
#[derive(InitSpace)]
pub struct WarehouseCustomer {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
    pub status: WarehouseCustomerStatus,
    pub confirmed_at: Option<i64>,
    pub notes_hash: Option<[u8; 32]>, // hash of the off-chain record, never PII
}

#[account]
#[derive(InitSpace)]
pub struct LotOffer {
    pub farmer: Pubkey, // farmer authority (wallet), also an offer seed
    pub warehouse: Pubkey,
    pub offer_id: u64,
    pub pack_ref: Option<Pubkey>, // free-form hint, never validated and never read: see README 16
    #[max_len(MAX_NAME_LEN)]
    pub crop_name: String,
    #[max_len(MAX_NAME_LEN)]
    pub cultivar_name: Option<String>,
    pub unit_code: u16, // client-side mapping, README section 10
    pub expires_at: Option<i64>,
    #[max_len(MAX_NOTES_LEN)]
    pub notes_public: Option<String>,
    pub mint: Pubkey,
    pub price_minor: u64,
    pub qty_remaining: u64,
    pub active: bool,
    pub created_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum FulfillmentMode {
    Pickup,
    Delivery,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrderStatus {
    EscrowedPickup,
    PendingDeliveryQuote,
    DeliveryQuoted,
    EscrowedReady,
    InTransit,
    Fulfilled,
    Refused,
    Canceled,
    Expired,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub order_id: u64,
    pub offer: Pubkey,
    pub farmer: Pubkey,
    pub warehouse: Pubkey,
    pub customer: Pubkey,
    pub mint: Pubkey,
    pub qty: u64,
    pub subtotal_minor: u64,
    pub service_fee_minor: u64, // fixed at creation: subtotal * fee_bps / 10_000
    pub delivery_fee_minor: u64, // 0 until quoted
    pub fulfillment_mode: FulfillmentMode,
    pub status: OrderStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub escrow_bump: u8, // escrow token account PDA ["escrow", order], its own authority
}
