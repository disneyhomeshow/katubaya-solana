use crate::errors::FarmerCoreError;
use crate::states::*;
use anchor_lang::prelude::*;

/// Warehouse operator approves the warehouse the farmer requested in `register_farmer`. Idempotent.
#[derive(Accounts)]
pub struct SetFarmerWarehouse<'info> {
    #[account(
        mut,
        constraint = farmer_profile.warehouse == warehouse.key() @ FarmerCoreError::WarehouseMismatch
    )]
    pub farmer_profile: Account<'info, FarmerProfile>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}

pub fn set_farmer_warehouse(ctx: Context<SetFarmerWarehouse>) -> Result<()> {
    ctx.accounts.farmer_profile.warehouse_approved = true;
    Ok(())
}
