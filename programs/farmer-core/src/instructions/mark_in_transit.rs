use crate::errors::FarmerCoreError;
use crate::events::OrderInTransit;
use crate::states::*;
use anchor_lang::prelude::*;

/// Warehouse operator locks the order for transport. Pickup needs EscrowedPickup, delivery needs EscrowedReady.
#[derive(Accounts)]
pub struct MarkInTransit<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = matches!(
            (order.fulfillment_mode, order.status),
            (FulfillmentMode::Pickup, OrderStatus::EscrowedPickup)
                | (FulfillmentMode::Delivery, OrderStatus::EscrowedReady)
        ) @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}

pub fn mark_in_transit(ctx: Context<MarkInTransit>) -> Result<()> {
    let order = &mut ctx.accounts.order;
    order.status = OrderStatus::InTransit;

    emit!(OrderInTransit { order: order.key() });
    Ok(())
}
