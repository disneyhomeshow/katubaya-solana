use crate::states::SEED_ESCROW;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// The escrow is a token account at PDA ["escrow", order] that is its own authority:
// deposits are signed by the customer, withdrawals and the close by the program with the PDA seeds.

pub fn deposit<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    escrow: &InterfaceAccount<'info, TokenAccount>,
    customer: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: escrow.to_account_info(),
                authority: customer.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

pub fn withdraw<'info>(
    token_program: &Interface<'info, TokenInterface>,
    escrow: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    order: &Pubkey,
    bump: u8,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[SEED_ESCROW, order.as_ref(), &[bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: escrow.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: escrow.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

/// Terminal paths close the emptied escrow and return its rent to `destination` (the customer).
pub fn close<'info>(
    token_program: &Interface<'info, TokenInterface>,
    escrow: &InterfaceAccount<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    order: &Pubkey,
    bump: u8,
) -> Result<()> {
    let seeds: &[&[u8]] = &[SEED_ESCROW, order.as_ref(), &[bump]];
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: escrow.to_account_info(),
            destination: destination.clone(),
            authority: escrow.to_account_info(),
        },
        &[seeds],
    ))
}
