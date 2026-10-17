use crate::errors::FarmerCoreError;
use crate::escrow;
use crate::events::OrderCompleted;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Warehouse operator completes an in-transit order: farmer gets subtotal minus service fee, logistics gets service plus delivery fee.
#[derive(Accounts)]
pub struct CompleteOrder<'info> {
    #[account(seeds = [SEED_CONFIG], bump)]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        has_one = mint @ FarmerCoreError::MintMismatch,
        constraint = order.status == OrderStatus::InTransit @ FarmerCoreError::InvalidOrderStatus
    )]
    pub order: Account<'info, Order>,

    #[account(has_one = operator @ FarmerCoreError::UnauthorizedOperator)]
    pub warehouse: Account<'info, Warehouse>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Must already exist; the program does not create payout accounts.
    #[account(
        mut,
        token::mint = mint,
        constraint = farmer_token_account.owner == order.farmer @ FarmerCoreError::FarmerTokenAccountMismatch
    )]
    pub farmer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        constraint = logistics_token_account.owner == config.logistics_wallet @ FarmerCoreError::LogisticsTokenAccountMismatch
    )]
    pub logistics_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_ESCROW, order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn complete_order(ctx: Context<CompleteOrder>) -> Result<()> {
    let order = &ctx.accounts.order;
    let order_key = order.key();
    let farmer_payout = order
        .subtotal_minor
        .checked_sub(order.service_fee_minor)
        .ok_or(FarmerCoreError::MathOverflow)?;
    let logistics_payout = order
        .service_fee_minor
        .checked_add(order.delivery_fee_minor)
        .ok_or(FarmerCoreError::MathOverflow)?;

    escrow::withdraw(
        &ctx.accounts.token_program,
        &ctx.accounts.escrow,
        &ctx.accounts.mint,
        &ctx.accounts.farmer_token_account,
        &order_key,
        order.escrow_bump,
        farmer_payout,
    )?;
    escrow::withdraw(
        &ctx.accounts.token_program,
        &ctx.accounts.escrow,
        &ctx.accounts.mint,
        &ctx.accounts.logistics_token_account,
        &order_key,
        order.escrow_bump,
        logistics_payout,
    )?;

    let order = &mut ctx.accounts.order;
    order.status = OrderStatus::Fulfilled;

    emit!(OrderCompleted {
        order: order_key,
        subtotal_minor: order.subtotal_minor,
        service_fee_minor: order.service_fee_minor,
        delivery_fee_minor: order.delivery_fee_minor,
        farmer_payout,
        logistics_payout,
    });
    Ok(())
}
