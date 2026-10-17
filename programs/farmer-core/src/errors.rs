use anchor_lang::prelude::*;

// ============================================================================
// ERROR ENUMS
// ============================================================================
// Errors are organized by entity (Customer, Farmer, Warehouse, Config, etc.)

#[error_code(offset = 6100)]
pub enum CustomerError {
    #[msg("Customer not found")]
    CustomerNotFound,
}

#[error_code(offset = 6000)]
pub enum ConfigError {
    #[msg("Too many allowed mints provided")]
    TooManyAllowedMints,
    #[msg("Program is currently paused")]
    ProgramPaused,
    #[msg("Unauthorized: caller is not the admin")]
    UnauthorizedAdmin,
    #[msg("Mint not in allowed list")]
    MintNotAllowed,
}
