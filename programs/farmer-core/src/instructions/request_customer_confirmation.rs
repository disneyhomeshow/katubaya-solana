use crate::events::CustomerConfirmationRequested;
use crate::states::*;
use anchor_lang::prelude::*;

/// Registered customer asks `warehouse` to confirm them; creates the `WarehouseCustomer` PDA as `Pending`.
#[derive(Accounts)]
pub struct RequestCustomerConfirmation<'info> {
    #[account(
        init,
        payer = customer,
        space = 8 + WarehouseCustomer::INIT_SPACE,
        seeds = [SEED_WCUSTOMER, warehouse.key().as_ref(), customer.key().as_ref()],
        bump
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    pub warehouse: Account<'info, Warehouse>,

    #[account(seeds = [SEED_CUSTOMER, customer.key().as_ref()], bump)]
    pub customer_profile: Account<'info, CustomerProfile>,

    #[account(mut)]
    pub customer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn request_customer_confirmation(ctx: Context<RequestCustomerConfirmation>) -> Result<()> {
    let wc = &mut ctx.accounts.warehouse_customer;
    wc.warehouse = ctx.accounts.warehouse.key();
    wc.customer = ctx.accounts.customer.key();
    wc.status = WarehouseCustomerStatus::Pending;
    wc.confirmed_at = None;
    wc.notes_hash = None;

    emit!(CustomerConfirmationRequested {
        warehouse: wc.warehouse,
        customer: wc.customer,
    });
    Ok(())
}
