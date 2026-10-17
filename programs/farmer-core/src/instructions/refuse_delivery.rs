use crate::errors::FarmerCoreError;
use crate::escrow;
use crate::events::OrderRefused;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Warehouse operator refuses a delivery order before transit: whole escrow refunded, stock restored.
#[derive(Accounts)]
pub struct RefuseDelivery<'info> {
    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.fulfillment_mode == FulfillmentMode::Delivery @ FarmerCoreError::NotDeliveryOrder,
        constraint = matches!(
            order.status,
            OrderStatus::PendingDeliveryQuote | OrderStatus::DeliveryQuoted | OrderStatus::EscrowedReady
        ) @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    #[account(mut)]
    pub offer: Account<'info, LotOffer>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Any token account of the order's customer for this mint; the operator picks it, the owner check keeps the money with the customer.
    #[account(
        mut,
        token::mint = mint,
        constraint = customer_token_account.owner == order.customer @ FarmerCoreError::UnauthorizedCustomer
    )]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn refuse_delivery(ctx: Context<RefuseDelivery>) -> Result<()> {
    let order_key = ctx.accounts.order.key();
    escrow::withdraw(
        &ctx.accounts.token_program,
        &ctx.accounts.escrow,
        &ctx.accounts.mint,
        &ctx.accounts.customer_token_account,
        &order_key,
        ctx.accounts.order.escrow_bump,
        ctx.accounts.escrow.amount,
    )?;

    let offer = &mut ctx.accounts.offer;
    offer.qty_remaining = offer
        .qty_remaining
        .checked_add(ctx.accounts.order.qty)
        .ok_or(FarmerCoreError::MathOverflow)?;
    ctx.accounts.order.status = OrderStatus::Refused;

    emit!(OrderRefused { order: order_key });
    Ok(())
}
