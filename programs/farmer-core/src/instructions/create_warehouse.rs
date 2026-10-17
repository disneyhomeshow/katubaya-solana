use crate::errors::FarmerCoreError;
use crate::states::*;
use anchor_lang::prelude::*;

/// Admin creates a `Warehouse` PDA keyed by an explicit `warehouse_id`.
#[derive(Accounts)]
#[instruction(warehouse_id: u64)]
pub struct CreateWarehouse<'info> {
    #[account(seeds = [SEED_CONFIG], bump, has_one = admin @ FarmerCoreError::UnauthorizedAdmin)]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        init,
        payer = admin,
        space = 8 + Warehouse::INIT_SPACE,
        seeds = [SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()],
        bump
    )]
    pub warehouse: Account<'info, Warehouse>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_warehouse(
    ctx: Context<CreateWarehouse>,
    warehouse_id: u64,
    operator: Pubkey,
    name: String,
    pickup_notes: String,
    fee_bps: u16,
    deliver_zip_prefixes: Vec<ZipPrefix>,
    delivery_fee_rules_uri: Option<String>,
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, FarmerCoreError::NameTooLong);
    require!(
        pickup_notes.len() <= MAX_NOTES_LEN,
        FarmerCoreError::NotesTooLong
    );
    require!(fee_bps <= MAX_FEE_BPS, FarmerCoreError::FeeBpsTooHigh);
    require!(
        deliver_zip_prefixes.len() <= MAX_ZIP_PREFIXES,
        FarmerCoreError::TooManyZipPrefixes
    );
    require!(
        deliver_zip_prefixes
            .iter()
            .all(|p| (3..=5).contains(&p.len)),
        FarmerCoreError::InvalidZipPrefixLen
    );
    if let Some(uri) = &delivery_fee_rules_uri {
        require!(uri.len() <= MAX_URI_LEN, FarmerCoreError::UriTooLong);
    }

    let w = &mut ctx.accounts.warehouse;
    w.warehouse_id = warehouse_id;
    w.operator = operator;
    w.name = name;
    w.pickup_notes = pickup_notes;
    w.fee_bps = fee_bps;
    w.delivery_fee_rules_uri = delivery_fee_rules_uri;
    w.deliver_zip_prefixes = deliver_zip_prefixes;
    Ok(())
}
