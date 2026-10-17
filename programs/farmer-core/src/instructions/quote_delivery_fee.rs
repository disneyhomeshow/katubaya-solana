use crate::errors::FarmerCoreError;
use crate::events::DeliveryFeeQuoted;
use crate::states::*;
use anchor_lang::prelude::*;

/// Warehouse operator quotes the delivery fee; the order waits for the customer with a fresh short expiry.
#[derive(Accounts)]
pub struct QuoteDeliveryFee<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = order.status == OrderStatus::PendingDeliveryQuote @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub operator: Signer<'info>,
}

pub fn quote_delivery_fee(ctx: Context<QuoteDeliveryFee>, delivery_fee_minor: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let order = &mut ctx.accounts.order;
    order.delivery_fee_minor = delivery_fee_minor;
    order.status = OrderStatus::DeliveryQuoted;
    order.expires_at = now
        .checked_add(EXPIRY_QUOTED_SECS)
        .ok_or(FarmerCoreError::MathOverflow)?;

    emit!(DeliveryFeeQuoted {
        order: order.key(),
        delivery_fee_minor,
    });
    Ok(())
}
