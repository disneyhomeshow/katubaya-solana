use crate::errors::FarmerCoreError;
use crate::escrow;
use crate::events::OrderCreated;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Confirmed customer buys `qty` from an active offer: stock is reserved and the subtotal escrowed in one transaction.
#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CreateOrder<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump,
        constraint = !config.paused @ FarmerCoreError::ProgramPaused
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        has_one = warehouse @ FarmerCoreError::WarehouseMismatch,
        constraint = offer.active @ FarmerCoreError::OfferInactive
    )]
    pub offer: Account<'info, LotOffer>,

    pub warehouse: Account<'info, Warehouse>,

    #[account(
        seeds = [SEED_WCUSTOMER, offer.warehouse.as_ref(), customer.key().as_ref()],
        bump,
        constraint = warehouse_customer.status == WarehouseCustomerStatus::Confirmed @ FarmerCoreError::CustomerNotConfirmed
    )]
    pub warehouse_customer: Account<'info, WarehouseCustomer>,

    #[account(
        init,
        payer = customer,
        space = 8 + Order::INIT_SPACE,
        seeds = [SEED_ORDER, offer.key().as_ref(), customer.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,

    #[account(constraint = mint.key() == offer.mint @ FarmerCoreError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = customer)]
    pub customer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = customer,
        token::mint = mint,
        token::authority = escrow,
        token::token_program = token_program,
        seeds = [SEED_ESCROW, order.key().as_ref()],
        bump
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub customer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn create_order(
    ctx: Context<CreateOrder>,
    order_id: u64,
    qty: u64,
    mode: FulfillmentMode,
) -> Result<()> {
    require!(qty > 0, FarmerCoreError::InvalidQuantity);
    let now = Clock::get()?.unix_timestamp;

    let offer = &mut ctx.accounts.offer;
    if let Some(expires_at) = offer.expires_at {
        require!(expires_at > now, FarmerCoreError::OfferExpired);
    }
    let subtotal = qty
        .checked_mul(offer.price_minor)
        .ok_or(FarmerCoreError::MathOverflow)?;
    let service_fee = (subtotal as u128)
        .checked_mul(ctx.accounts.warehouse.fee_bps as u128)
        .and_then(|v| v.checked_div(MAX_FEE_BPS as u128))
        .ok_or(FarmerCoreError::MathOverflow)? as u64;
    offer.qty_remaining = offer
        .qty_remaining
        .checked_sub(qty)
        .ok_or(FarmerCoreError::InsufficientStock)?;

    let (status, window) = match mode {
        FulfillmentMode::Pickup => (OrderStatus::EscrowedPickup, EXPIRY_PICKUP_SECS),
        FulfillmentMode::Delivery => (OrderStatus::PendingDeliveryQuote, EXPIRY_PENDING_QUOTE_SECS),
    };
    let expires_at = now
        .checked_add(window)
        .ok_or(FarmerCoreError::MathOverflow)?;

    let order = &mut ctx.accounts.order;
    order.order_id = order_id;
    order.offer = offer.key();
    order.farmer = offer.farmer;
    order.warehouse = offer.warehouse;
    order.customer = ctx.accounts.customer.key();
    order.mint = ctx.accounts.mint.key();
    order.qty = qty;
    order.subtotal_minor = subtotal;
    order.service_fee_minor = service_fee;
    order.delivery_fee_minor = 0;
    order.fulfillment_mode = mode;
    order.status = status;
    order.created_at = now;
    order.expires_at = expires_at;
    order.escrow_bump = ctx.bumps.escrow;

    escrow::deposit(
        &ctx.accounts.token_program,
        &ctx.accounts.customer_token_account,
        &ctx.accounts.mint,
        &ctx.accounts.escrow,
        &ctx.accounts.customer,
        subtotal,
    )?;

    emit!(OrderCreated {
        order: order.key(),
        offer: order.offer,
        farmer: order.farmer,
        warehouse: order.warehouse,
        customer: order.customer,
        qty,
        subtotal_minor: subtotal,
        service_fee_minor: service_fee,
        mode,
    });
    Ok(())
}
