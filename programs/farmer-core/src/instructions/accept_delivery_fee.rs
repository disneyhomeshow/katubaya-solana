use crate::errors::FarmerCoreError;
use crate::escrow;
use crate::events::DeliveryFeeAccepted;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Customer accepts the quoted delivery fee and escrows it; the order is ready for transport.
#[derive(Accounts)]
pub struct AcceptDeliveryFee<'info> {
    #[account(
        mut,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.status == OrderStatus::DeliveryQuoted @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = customer)]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    pub customer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn accept_delivery_fee(ctx: Context<AcceptDeliveryFee>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    escrow::deposit(
        &ctx.accounts.token_program,
        &ctx.accounts.customer_token_account,
        &ctx.accounts.mint,
        &ctx.accounts.escrow,
        &ctx.accounts.customer,
        ctx.accounts.order.delivery_fee_minor,
    )?;

    let order = &mut ctx.accounts.order;
    order.status = OrderStatus::EscrowedReady;
    order.expires_at = now
        .checked_add(EXPIRY_PICKUP_SECS)
        .ok_or(FarmerCoreError::MathOverflow)?;

    emit!(DeliveryFeeAccepted { order: order.key() });
    Ok(())
}
