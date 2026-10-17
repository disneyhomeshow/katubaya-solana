use anchor_lang::prelude::*;

// ============================================================================
// CONSTANTS
// ============================================================================

pub const MAX_NAME_LEN: usize = 100;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_NOTES_LEN: usize = 500;
pub const MAX_ZIP_PREFIXES: usize = 100;
pub const MAX_ALLOWED_MINTS: usize = 30; // 30 * 32 B is the most that fits in one 1232 B tx

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
