use crate::errors::FarmerCoreError;
use crate::events::CustomerConfirmed;
use crate::states::*;
use anchor_lang::prelude::*;

/// Warehouse operator confirms a `Pending` or `Revoked` customer; stamps `confirmed_at` and the optional `notes_hash`.
#[derive(Accounts)]
pub struct ConfirmCustomer<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = warehouse_customer.status != WarehouseCustomerStatus::Confirmed @ FarmerCoreError::AlreadyConfirmed
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}

pub fn confirm_customer(ctx: Context<ConfirmCustomer>, notes_hash: Option<[u8; 32]>) -> Result<()> {
    let wc = &mut ctx.accounts.warehouse_customer;
    wc.status = WarehouseCustomerStatus::Confirmed;
    wc.confirmed_at = Some(Clock::get()?.unix_timestamp);
    wc.notes_hash = notes_hash;

    emit!(CustomerConfirmed {
        warehouse: wc.warehouse,
        customer: wc.customer,
    });
    Ok(())
}
