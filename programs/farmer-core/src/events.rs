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
