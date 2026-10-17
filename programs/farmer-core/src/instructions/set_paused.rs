use crate::errors::FarmerCoreError;
use crate::states::*;
use anchor_lang::prelude::*;

/// Admin flips `config.paused`; market instructions carry `constraint = !config.paused`.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump,
        has_one = admin @ FarmerCoreError::UnauthorizedAdmin
    )]
    pub config: Account<'info, ProgramConfig>,

    pub admin: Signer<'info>,
}

pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}
