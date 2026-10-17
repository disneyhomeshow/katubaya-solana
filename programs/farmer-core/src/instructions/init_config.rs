use anchor_lang::prelude::*;
use crate::states::{ProgramConfig, SEED_CONFIG, MAX_ALLOWED_MINTS};

/// Creates the singleton `ProgramConfig` PDA; see `ProgramConfig` for the fields.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProgramConfig::INIT_SPACE,
        seeds = [SEED_CONFIG],
        bump
    )]
    pub config: Account<'info, ProgramConfig>,
    
    /// The admin authority that will control the program
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn init_config(
    ctx: Context<InitConfig>,
    logistics_wallet: Pubkey,
    paused: bool,
    allowed_mints: Vec<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    
    // Validate allowed_mints length
    require!(
        allowed_mints.len() <= MAX_ALLOWED_MINTS,
        crate::errors::ConfigError::TooManyAllowedMints
    );
    
    // Set config fields
    config.admin = ctx.accounts.admin.key();
    config.logistics_wallet = logistics_wallet;
    config.paused = paused;
    config.allowed_mints = allowed_mints;
    
    msg!("Program config initialized");
    msg!("Admin: {}", config.admin);
    msg!("Logistics wallet: {}", config.logistics_wallet);
    msg!("Paused: {}", config.paused);
    msg!("Allowed mints: {}", config.allowed_mints.len());
    
    Ok(())
}
