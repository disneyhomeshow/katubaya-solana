use crate::errors::FarmerCoreError;
use crate::states::*;
use anchor_lang::prelude::*;

/// Customer creates a `CustomerProfile`; warehouse eligibility is a separate confirmation (M2).
#[derive(Accounts)]
pub struct RegisterCustomer<'info> {
    #[account(
        init,
        payer = customer,
        space = 8 + CustomerProfile::INIT_SPACE,
        seeds = [SEED_CUSTOMER, customer.key().as_ref()],
        bump
    )]
    pub customer_profile: Account<'info, CustomerProfile>,

    #[account(mut)]
    pub customer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_customer(
    ctx: Context<RegisterCustomer>,
    public_profile_uri: Option<String>,
) -> Result<()> {
    if let Some(uri) = &public_profile_uri {
        require!(uri.len() <= MAX_URI_LEN, FarmerCoreError::UriTooLong);
    }

    let p = &mut ctx.accounts.customer_profile;
    p.authority = ctx.accounts.customer.key();
    p.public_profile_uri = public_profile_uri;
    Ok(())
}
