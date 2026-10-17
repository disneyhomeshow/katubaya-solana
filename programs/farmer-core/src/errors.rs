use anchor_lang::prelude::*;

// ============================================================================
// ERRORS
// ============================================================================
// Single enum on purpose: Anchor 0.32 writes only one `#[error_code]` enum into
// the IDL and ignores custom offsets, so a second enum loses its names
// client-side. Group variants by entity with a section comment.

#[error_code]
pub enum FarmerCoreError {
    // ---- Config
    #[msg("Too many allowed mints provided")]
    TooManyAllowedMints,
    #[msg("Program is currently paused")]
    ProgramPaused,
    #[msg("Unauthorized: caller is not the admin")]
    UnauthorizedAdmin,
    #[msg("Mint not in allowed list")]
    MintNotAllowed,

    // ---- Customer
    #[msg("Customer not found")]
    CustomerNotFound,
}
