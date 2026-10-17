use crate::states::FulfillmentMode;
use anchor_lang::prelude::*;

// One struct per event in README section 9. Emitted by the handler after the state writes.

#[event]
pub struct CustomerConfirmationRequested {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
}

#[event]
pub struct CustomerConfirmed {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
}

#[event]
pub struct CustomerRevoked {
    pub warehouse: Pubkey,
    pub customer: Pubkey,
}

#[event]
pub struct OfferPublished {
    pub offer: Pubkey,
    pub farmer: Pubkey,
    pub warehouse: Pubkey,
    pub crop_name: String,
    pub cultivar_name: Option<String>,
    pub unit_code: u16,
    pub qty: u64,
    pub price_minor: u64,
    pub mint: Pubkey,
    pub expires_at: Option<i64>,
}

#[event]
pub struct OfferDeactivated {
    pub offer: Pubkey,
}

#[event]
pub struct OrderCreated {
    pub order: Pubkey,
    pub offer: Pubkey,
    pub farmer: Pubkey,
    pub warehouse: Pubkey,
    pub customer: Pubkey,
    pub qty: u64,
    pub subtotal_minor: u64,
    pub service_fee_minor: u64,
    pub mode: FulfillmentMode,
}

#[event]
pub struct DeliveryFeeQuoted {
    pub order: Pubkey,
    pub delivery_fee_minor: u64,
}

#[event]
pub struct DeliveryFeeAccepted {
    pub order: Pubkey,
}

#[event]
pub struct DeliveryFeeRejected {
    pub order: Pubkey,
}

#[event]
pub struct OrderRefused {
    pub order: Pubkey,
}

#[event]
pub struct OrderInTransit {
    pub order: Pubkey,
}

#[event]
pub struct OrderCompleted {
    pub order: Pubkey,
    pub subtotal_minor: u64,
    pub service_fee_minor: u64,
    pub delivery_fee_minor: u64,
    pub farmer_payout: u64,
    pub logistics_payout: u64,
}
