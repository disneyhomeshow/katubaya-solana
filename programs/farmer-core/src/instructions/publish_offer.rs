use crate::errors::FarmerCoreError;
use crate::events::OfferPublished;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, ExtensionType, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as MintState;
use anchor_spl::token_interface::Mint;

/// Extensions that would break the escrow: a fee withheld on the receiving account, a hook that can
/// block or re-route a transfer, a delegate that can drain any account, confidential balances that
/// stop `close_account`, or a mint-wide pause. Checked once, here, like the allowlist.
const DENIED_MINT_EXTENSIONS: [ExtensionType; 5] = [
    ExtensionType::TransferFeeConfig,
    ExtensionType::TransferHook,
    ExtensionType::PermanentDelegate,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::Pausable,
];

/// Approved farmer creates an active `LotOffer` PDA keyed by an explicit `offer_id`; the mint allowlist
/// and the extension denylist are both enforced here, once.
#[derive(Accounts)]
#[instruction(offer_id: u64)]
pub struct PublishOffer<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump,
        constraint = !config.paused @ FarmerCoreError::ProgramPaused
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        seeds = [SEED_FARMER, farmer.key().as_ref()],
        bump,
        constraint = farmer_profile.warehouse_approved @ FarmerCoreError::FarmerNotApproved
    )]
    pub farmer_profile: Account<'info, FarmerProfile>,

    #[account(
        init,
        payer = farmer,
        space = 8 + LotOffer::INIT_SPACE,
        seeds = [SEED_OFFER, farmer.key().as_ref(), offer_id.to_le_bytes().as_ref()],
        bump
    )]
    pub offer: Account<'info, LotOffer>,

    /// The payment mint, an account and not an argument so its token extensions can be read here.
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub farmer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn publish_offer(
    ctx: Context<PublishOffer>,
    offer_id: u64,
    crop_name: String,
    cultivar_name: Option<String>,
    unit_code: u16,
    qty: u64,
    price_minor: u64,
    expires_at: Option<i64>,
    notes_public: Option<String>,
    pack_ref: Option<Pubkey>,
) -> Result<()> {
    require!(
        crop_name.len() <= MAX_NAME_LEN,
        FarmerCoreError::NameTooLong
    );
    if let Some(c) = &cultivar_name {
        require!(c.len() <= MAX_NAME_LEN, FarmerCoreError::NameTooLong);
    }
    if let Some(n) = &notes_public {
        require!(n.len() <= MAX_NOTES_LEN, FarmerCoreError::NotesTooLong);
    }
    require!(qty > 0, FarmerCoreError::InvalidQuantity);
    require!(price_minor > 0, FarmerCoreError::InvalidPrice);
    let now = Clock::get()?.unix_timestamp;
    if let Some(e) = expires_at {
        require!(e > now, FarmerCoreError::InvalidExpiry);
    }
    let mint = ctx.accounts.mint.key();
    let allowed = &ctx.accounts.config.allowed_mints;
    require!(
        allowed.is_empty() || allowed.contains(&mint),
        FarmerCoreError::MintNotAllowed
    );
    deny_mint_extensions(&ctx.accounts.mint.to_account_info())?;

    let offer = &mut ctx.accounts.offer;
    offer.farmer = ctx.accounts.farmer.key();
    offer.warehouse = ctx.accounts.farmer_profile.warehouse;
    offer.offer_id = offer_id;
    offer.pack_ref = pack_ref;
    offer.crop_name = crop_name;
    offer.cultivar_name = cultivar_name;
    offer.unit_code = unit_code;
    offer.expires_at = expires_at;
    offer.notes_public = notes_public;
    offer.mint = mint;
    offer.price_minor = price_minor;
    offer.qty_remaining = qty;
    offer.active = true;
    offer.created_at = now;

    emit!(OfferPublished {
        offer: offer.key(),
        farmer: offer.farmer,
        warehouse: offer.warehouse,
        crop_name: offer.crop_name.clone(),
        cultivar_name: offer.cultivar_name.clone(),
        unit_code,
        qty,
        price_minor,
        mint,
        expires_at,
    });
    Ok(())
}

/// A legacy SPL Token mint unpacks with an empty extension list, so one path serves both programs.
fn deny_mint_extensions(mint: &AccountInfo) -> Result<()> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)
        .map_err(|_| error!(FarmerCoreError::MintExtensionNotAllowed))?;
    let extensions = state
        .get_extension_types()
        .map_err(|_| error!(FarmerCoreError::MintExtensionNotAllowed))?;
    require!(
        !extensions
            .iter()
            .any(|e| DENIED_MINT_EXTENSIONS.contains(e)),
        FarmerCoreError::MintExtensionNotAllowed
    );
    Ok(())
}
