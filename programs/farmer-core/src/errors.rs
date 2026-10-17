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

    // ---- Input bounds (shared by every entity)
    #[msg("Name exceeds MAX_NAME_LEN")]
    NameTooLong,
    #[msg("Notes exceed MAX_NOTES_LEN")]
    NotesTooLong,
    #[msg("URI exceeds MAX_URI_LEN")]
    UriTooLong,

    // ---- Warehouse
    #[msg("Too many zip prefixes")]
    TooManyZipPrefixes,
    #[msg("Zip prefix len must be 3, 4 or 5")]
    InvalidZipPrefixLen,
    #[msg("fee_bps exceeds 10000")]
    FeeBpsTooHigh,
    #[msg("Signer is not the warehouse operator")]
    UnauthorizedOperator,

    // ---- Farmer
    #[msg("Farmer did not request this warehouse")]
    WarehouseMismatch,

    // ---- Customer
    #[msg("Customer not found")]
    CustomerNotFound,
    #[msg("Customer is already confirmed for this warehouse")]
    AlreadyConfirmed,
    #[msg("Customer is already revoked for this warehouse")]
    AlreadyRevoked,

    // ---- Offer (new sections go last: existing codes never shift)
    #[msg("Farmer is not approved by the warehouse")]
    FarmerNotApproved,
    #[msg("Signer is not the offer's farmer")]
    UnauthorizedFarmer,
    #[msg("Quantity must be greater than zero")]
    InvalidQuantity,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("expires_at must be in the future")]
    InvalidExpiry,
    #[msg("Offer is not active")]
    OfferInactive,
}
