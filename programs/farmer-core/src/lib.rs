#![allow(unexpected_cfgs)]

use crate::instructions::*;
use crate::states::ZipPrefix;
use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
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

    /// Customer asks a warehouse to confirm them (address exchanged off-chain)
    pub fn request_customer_confirmation(ctx: Context<RequestCustomerConfirmation>) -> Result<()> {
        instructions::request_customer_confirmation::request_customer_confirmation(ctx)
    }

    /// Warehouse operator confirms a customer; also re-admits a revoked one
    pub fn confirm_customer(
        ctx: Context<ConfirmCustomer>,
        notes_hash: Option<[u8; 32]>,
    ) -> Result<()> {
        instructions::confirm_customer::confirm_customer(ctx, notes_hash)
    }

    /// Warehouse operator revokes a pending or confirmed customer
    pub fn revoke_customer(ctx: Context<RevokeCustomer>) -> Result<()> {
        instructions::revoke_customer::revoke_customer(ctx)
    }

    /// Approved farmer publishes a transparent lot offer keyed by an explicit id
    pub fn publish_offer(
        ctx: Context<PublishOffer>,
        offer_id: u64,
        crop_name: String,
        cultivar_name: Option<String>,
        unit_code: u16,
        qty: u64,
        price_minor: u64,
        mint: Pubkey,
        expires_at: Option<i64>,
        notes_public: Option<String>,
        pack_ref: Option<Pubkey>,
    ) -> Result<()> {
        instructions::publish_offer::publish_offer(
            ctx,
            offer_id,
            crop_name,
            cultivar_name,
            unit_code,
            qty,
            price_minor,
            mint,
            expires_at,
            notes_public,
            pack_ref,
        )
    }

    /// Farmer stops purchases on an offer
    pub fn deactivate_offer(ctx: Context<DeactivateOffer>) -> Result<()> {
        instructions::deactivate_offer::deactivate_offer(ctx)
    }

    /// Admin pauses or resumes market actions
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::set_paused(ctx, paused)
    }
}
