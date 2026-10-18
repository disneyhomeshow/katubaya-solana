use crate::errors::FarmerCoreError;
use crate::escrow;
use crate::events::OrderExpired;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Anyone may expire a pre-transit order past `expires_at`: whole escrow refunded, stock restored.
#[derive(Accounts)]
pub struct ExpireOrder<'info> {
    #[account(
        mut,
        has_one = offer @ FarmerCoreError::OfferMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        has_one = customer @ FarmerCoreError::UnauthorizedCustomer,
        constraint = matches!(
            order.status,
            OrderStatus::EscrowedPickup
                | OrderStatus::PendingDeliveryQuote
                | OrderStatus::DeliveryQuoted
                | OrderStatus::EscrowedReady
        ) @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub offer: Account<'info, LotOffer>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Any token account of the order's customer for this mint; the owner check keeps the refund with the customer.
    #[account(
        mut,
        token::mint = mint,
        constraint = customer_token_account.owner == order.customer @ FarmerCoreError::UnauthorizedCustomer
    )]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    /// Escrow rent goes back to the customer, who paid it at `create_order`.
    #[account(mut)]
    pub customer: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// No signer: the expiry is a fact of the clock, so whoever pays the transaction fee may trigger it.
pub fn expire_order(ctx: Context<ExpireOrder>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // `expires_at` is the instant of expiry, inclusive, matching `offer.expires_at` at `create_order`.
    require!(
        now >= ctx.accounts.order.expires_at,
        FarmerCoreError::OrderNotExpired
    );

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
    ctx.accounts.order.status = OrderStatus::Expired;

    emit!(OrderExpired { order: order_key });
    Ok(())
}
