use crate::errors::FarmerCoreError;
use crate::states::*;
use anchor_lang::prelude::*;

/// Admin patches a `Warehouse`: every field is optional and only the `Some` ones are written.
#[derive(Accounts)]
#[instruction(warehouse_id: u64)]
pub struct UpdateWarehouse<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump,
        has_one = admin @ FarmerCoreError::UnauthorizedAdmin
    )]
    pub config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        seeds = [SEED_WAREHOUSE, warehouse_id.to_le_bytes().as_ref()],
        bump
    )]
    pub warehouse: Account<'info, Warehouse>,

    pub admin: Signer<'info>,
}

/// Signed by the admin, not the operator: a lost operator key cannot sign its own rotation, and
/// rotating it is the only exit for an order already `InTransit`, whose completion only the
/// warehouse operator can sign. A new `fee_bps` applies to future orders only, since
/// `order.service_fee_minor` is fixed at `create_order`.
pub fn update_warehouse(
    ctx: Context<UpdateWarehouse>,
    _warehouse_id: u64,
    operator: Option<Pubkey>,
    pickup_notes: Option<String>,
    fee_bps: Option<u16>,
    deliver_zip_prefixes: Option<Vec<ZipPrefix>>,
) -> Result<()> {
    if let Some(notes) = &pickup_notes {
        require!(notes.len() <= MAX_NOTES_LEN, FarmerCoreError::NotesTooLong);
    }
    if let Some(bps) = fee_bps {
        require!(bps <= MAX_FEE_BPS, FarmerCoreError::FeeBpsTooHigh);
    }
    if let Some(prefixes) = &deliver_zip_prefixes {
        require!(
            prefixes.len() <= MAX_ZIP_PREFIXES,
            FarmerCoreError::TooManyZipPrefixes
        );
        require!(
            prefixes.iter().all(|p| (3..=5).contains(&p.len)),
            FarmerCoreError::InvalidZipPrefixLen
        );
    }

    let w = &mut ctx.accounts.warehouse;
    if let Some(operator) = operator {
        w.operator = operator;
    }
    if let Some(notes) = pickup_notes {
        w.pickup_notes = notes;
    }
    if let Some(bps) = fee_bps {
        w.fee_bps = bps;
    }
    if let Some(prefixes) = deliver_zip_prefixes {
        w.deliver_zip_prefixes = prefixes;
    }
    Ok(())
}
