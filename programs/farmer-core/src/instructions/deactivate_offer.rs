use crate::errors::FarmerCoreError;
use crate::events::OfferDeactivated;
use crate::states::*;
use anchor_lang::prelude::*;

/// Farmer stops purchases on an active offer. No pause gate: deactivating is a safety action.
#[derive(Accounts)]
pub struct DeactivateOffer<'info> {
    #[account(
        mut,
        has_one = farmer @ FarmerCoreError::UnauthorizedFarmer,
        constraint = offer.active @ FarmerCoreError::OfferInactive
    )]
    pub offer: Account<'info, LotOffer>,

    pub farmer: Signer<'info>,
}

pub fn deactivate_offer(ctx: Context<DeactivateOffer>) -> Result<()> {
    let offer = &mut ctx.accounts.offer;
    offer.active = false;

    emit!(OfferDeactivated { offer: offer.key() });
    Ok(())
}
