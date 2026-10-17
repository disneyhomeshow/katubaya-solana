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
