use crate::errors::FarmerCoreError;
use crate::states::*;
use anchor_lang::prelude::*;

/// Farmer creates a `FarmerProfile` and requests `warehouse`; approval comes from `set_farmer_warehouse`.
#[derive(Accounts)]
pub struct RegisterFarmer<'info> {
    #[account(
        init,
        payer = farmer,
        space = 8 + FarmerProfile::INIT_SPACE,
        seeds = [SEED_FARMER, farmer.key().as_ref()],
        bump
    )]
    pub farmer_profile: Account<'info, FarmerProfile>,

    pub warehouse: Account<'info, Warehouse>,

    #[account(mut)]
    pub farmer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_farmer(
    ctx: Context<RegisterFarmer>,
    display_name: String,
    public_profile_uri: String,
) -> Result<()> {
    require!(
        display_name.len() <= MAX_NAME_LEN,
        FarmerCoreError::NameTooLong
    );
    require!(
        public_profile_uri.len() <= MAX_URI_LEN,
        FarmerCoreError::UriTooLong
    );

    let p = &mut ctx.accounts.farmer_profile;
    p.authority = ctx.accounts.farmer.key();
    p.warehouse = ctx.accounts.warehouse.key();
    p.warehouse_approved = false;
    p.display_name = display_name;
    p.public_profile_uri = public_profile_uri;
    Ok(())
}
