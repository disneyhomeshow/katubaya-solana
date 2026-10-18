use crate::errors::FarmerCoreError;
use crate::escrow;
use crate::events::DeliveryFeeRejected;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Customer rejects the quote: the escrowed subtotal is refunded, stock restored, order canceled.
#[derive(Accounts)]
pub struct RejectDeliveryFee<'info> {
    #[account(
        mut,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.status == OrderStatus::DeliveryQuoted @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub offer: Account<'info, LotOffer>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = customer)]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    /// Also the escrow rent destination, so it must be writable.
    #[account(mut)]
    pub customer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn reject_delivery_fee(ctx: Context<RejectDeliveryFee>) -> Result<()> {
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
    escrow::close(
        &ctx.accounts.token_program,
        &ctx.accounts.escrow,
        &ctx.accounts.customer.to_account_info(),
        &order_key,
        ctx.accounts.order.escrow_bump,
    )?;

    let offer = &mut ctx.accounts.offer;
    offer.qty_remaining = offer
        .qty_remaining
        .checked_add(ctx.accounts.order.qty)
        .ok_or(FarmerCoreError::MathOverflow)?;
    ctx.accounts.order.status = OrderStatus::Canceled;

    emit!(DeliveryFeeRejected { order: order_key });
    Ok(())
}
