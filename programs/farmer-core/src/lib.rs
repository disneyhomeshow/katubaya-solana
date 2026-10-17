#![allow(unexpected_cfgs)]

use crate::instructions::*;
use crate::states::ZipPrefix;
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod states;

declare_id!("5NzjPYN5PUGNVkTRfh8naDqD7K3hTQbYyZb5YhtCArxV");

#[program]
pub mod farmer_core {
    use super::*;

    /// Initializes the program configuration account
    pub fn init_config(
        ctx: Context<InitConfig>,
        logistics_wallet: Pubkey,
        paused: bool,
        allowed_mints: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::init_config::init_config(ctx, logistics_wallet, paused, allowed_mints)
    }

    /// Admin creates a warehouse keyed by an explicit id
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
        instructions::create_warehouse::create_warehouse(
            ctx,
            warehouse_id,
            operator,
            name,
            pickup_notes,
            fee_bps,
            deliver_zip_prefixes,
            delivery_fee_rules_uri,
        )
    }

    /// Farmer registers and requests a warehouse
    pub fn register_farmer(
        ctx: Context<RegisterFarmer>,
        display_name: String,
        public_profile_uri: String,
    ) -> Result<()> {
        instructions::register_farmer::register_farmer(ctx, display_name, public_profile_uri)
    }

    /// Warehouse operator approves the farmer's requested warehouse
    pub fn set_farmer_warehouse(ctx: Context<SetFarmerWarehouse>) -> Result<()> {
        instructions::set_farmer_warehouse::set_farmer_warehouse(ctx)
    }

    /// Customer registers a profile
    pub fn register_customer(
        ctx: Context<RegisterCustomer>,
        public_profile_uri: Option<String>,
    ) -> Result<()> {
        instructions::register_customer::register_customer(ctx, public_profile_uri)
    }
}
