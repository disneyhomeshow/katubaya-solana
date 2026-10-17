use crate::errors::FarmerCoreError;
use crate::events::CustomerRevoked;
use crate::states::*;
use anchor_lang::prelude::*;

/// Warehouse operator revokes a `Pending` (denial) or `Confirmed` customer; `confirmed_at` and `notes_hash` stay as history.
#[derive(Accounts)]
pub struct RevokeCustomer<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = warehouse_customer.status != WarehouseCustomerStatus::Revoked @ FarmerCoreError::AlreadyRevoked
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}

pub fn revoke_customer(ctx: Context<RevokeCustomer>) -> Result<()> {
    let wc = &mut ctx.accounts.warehouse_customer;
    wc.status = WarehouseCustomerStatus::Revoked;

    emit!(CustomerRevoked {
        warehouse: wc.warehouse,
        customer: wc.customer,
    });
    Ok(())
}
