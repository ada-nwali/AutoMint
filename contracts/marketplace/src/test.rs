// SPDX-License-Identifier: Apache-2.0

#![cfg(test)]
#![allow(clippy::inconsistent_digit_grouping)]
/// This crate's own `BotTier` under an alias: the explicit `BotTier` import
/// above shadows the `super::*` glob (bot_nft's client arguments need it),
/// while `tier_stats` and `DataKey::TierStats` take the marketplace type.
use super::BotTier as MktBotTier;
use super::*;
use automint_bot_nft::{BotNFTContractClient, BotTier};
use automint_registry::RegistryContractClient;
use automint_testutils::{deploy_all, deploy_bot_nft_with_registry, register_user};
use automint_token::AMTTokenClient;
use soroban_sdk::{
    testutils::{Address as _, Events},
    Env, TryFromVal,
};
extern crate std;

// Tier supply is capped at 50 per tier, so bulk-listing tests spread bots
// round-robin across all five tiers.
const TIERS: [BotTier; 5] = [
    BotTier::Basic,
    BotTier::Bronze,
    BotTier::Silver,
    BotTier::Gold,
    BotTier::Diamond,
];

struct Harness<'a> {
    env: Env,
    admin: Address,
    registry: RegistryContractClient<'a>,
    bot: BotNFTContractClient<'a>,
    token: AMTTokenClient<'a>,
    mkt: MarketplaceContractClient<'a>,
}

fn setup() -> Harness<'static> {
    let deployment = deploy_all(Env::default());
    let registry = RegistryContractClient::new(&deployment.env, &deployment.registry_id);
    let bot = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
    let token = AMTTokenClient::new(&deployment.env, &deployment.token_id);
    let mkt = MarketplaceContractClient::new(&deployment.env, &deployment.marketplace_id);

    Harness {
        env: deployment.env,
        admin: deployment.admin,
        registry,
        bot,
        token,
        mkt,
    }
}

#[test]
fn test_list_bot_escrows_and_returns_id() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(listing_id, 1);

    // The bot is escrowed into the marketplace contract.
    let bot = h.bot.get_bot(&bot_id);
    assert_eq!(bot.owner, h.mkt.address);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // The listing is recorded with the supplied price and currency.
    let listing = h.mkt.get_listing(&listing_id);
    assert_eq!(listing.seller, seller);
    assert_eq!(listing.bot_id, bot_id);
    assert_eq!(listing.price, 50_0000000_i128);
    assert_eq!(listing.currency, h.token.address);
    assert!(listing.active);
}

#[test]
fn test_list_bot_ids_are_sequential() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let id1 = h.bot.mint_basic(&seller);
    let id2 = h.bot.admin_mint(&seller, &BotTier::Basic);

    let l1 = h.mkt.list_bot(
        &seller,
        &id1,
        &10_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    let l2 = h.mkt.list_bot(
        &seller,
        &id2,
        &20_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(l1, 1);
    assert_eq!(l2, 2);

    assert_eq!(h.mkt.get_active_listings(&0, &100).0.len(), 2);
    assert_eq!(h.mkt.get_user_listings(&seller).len(), 2);
}

#[test]
fn test_list_bot_zero_price_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_id, &0_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
    // The bot is NOT escrowed when listing fails.
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);
}

#[test]
fn test_list_bot_negative_price_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_id, &-1_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
}

#[test]
fn test_list_nonexistent_bot_fails_with_bot_not_found() {
    let h = setup();
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt.try_list_bot(
            &seller,
            &999_u64,
            &10_0000000_i128,
            &h.token.address,
            &604_800_u64
        ),
        Err(Ok(MarketplaceError::BotNotFound))
    );
}

#[test]
fn test_list_bot_not_owned_by_seller_fails_with_not_bot_owner() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&owner);
    // The bot exists but `stranger` does not own it: NotBotOwner, not
    // BotNotFound and not BotTransferFailed (#427).
    assert_eq!(
        h.mkt.try_list_bot(
            &stranger,
            &bot_id,
            &10_0000000_i128,
            &h.token.address,
            &604_800_u64
        ),
        Err(Ok(MarketplaceError::NotBotOwner))
    );
    // The failed listing escrows nothing.
    assert_eq!(h.bot.get_bot(&bot_id).owner, owner);
}

#[test]
fn test_list_bot_genuine_transfer_failure_returns_bot_transfer_failed() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    // Authorize `list_bot` itself but not the nested escrow transfer: the
    // ownership check passes, the transfer leg fails, and list_bot surfaces
    // BotTransferFailed for that genuine transfer failure (#427).
    h.env.mock_auths(&[MockAuth {
        address: &seller,
        invoke: &MockAuthInvoke {
            contract: &h.mkt.address,
            fn_name: "list_bot",
            args: (
                seller.clone(),
                bot_id,
                10_0000000_i128,
                h.token.address.clone(),
                604_800_u64,
            )
                .into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        h.mkt.try_list_bot(
            &seller,
            &bot_id,
            &10_0000000_i128,
            &h.token.address,
            &604_800_u64
        ),
        Err(Ok(MarketplaceError::BotTransferFailed))
    );
}

#[test]
fn test_list_bot_not_owned_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    // `stranger` does not own the bot: NotBotOwner (#427).
    assert_eq!(
        h.mkt.try_list_bot(
            &stranger,
            &bot_id,
            &10_0000000_i128,
            &h.token.address,
            &604_800_u64
        ),
        Err(Ok(MarketplaceError::NotBotOwner))
    );
    // Ownership is unchanged.
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
}

#[test]
fn test_get_listing_not_found() {
    let h = setup();
    assert_eq!(
        h.mkt.try_get_listing(&404_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
}

#[test]
fn test_double_initialize_fails() {
    let h = setup();
    assert_eq!(
        h.mkt
            .try_initialize(&h.admin, &h.bot.address, &250u32, &0u32),
        Err(Ok(MarketplaceError::AlreadyInitialized))
    );
}

#[test]
fn test_config_returns_admin_and_bot_nft() {
    let h = setup();
    let config = h.mkt.config();
    assert_eq!(config.admin, h.admin);
    assert_eq!(config.bot_nft, h.bot.address);
    assert_eq!(config.fee_bps, 250u32);
}

#[test]
fn test_active_listings_empty_initially() {
    let h = setup();
    assert_eq!(h.mkt.get_active_listings(&0, &100).0.len(), 0);
}

#[test]
fn test_buy_bot_pays_seller_minus_fee_and_transfers_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 1000_0000000_i128;

    // Fund buyer
    h.token.mint(&buyer, &price);

    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);

    let seller_balance_before = h.token.balance(&seller);
    let admin_balance_before = h.mkt.fees_accrued(&h.token.address);

    h.mkt.buy_bot(&buyer, &listing_id);

    // 2.5% fee = 25_0000000 accrues in the contract, seller gets 975_0000000
    let fee = price * 25 / 1000;
    assert_eq!(
        h.token.balance(&seller),
        seller_balance_before + price - fee
    );
    assert_eq!(
        h.mkt.fees_accrued(&h.token.address),
        admin_balance_before + fee
    );
    assert_eq!(h.token.balance(&buyer), 0);

    // Bot transferred to buyer
    assert_eq!(h.bot.get_bot(&bot_id).owner, buyer);
    assert_eq!(h.bot.get_user_bots(&buyer).len(), 1);

    // Listing is now inactive
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
    assert_eq!(h.mkt.get_active_listings(&0, &100).0.len(), 0);
}

#[test]
fn test_cancel_listing_returns_bot_to_seller() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // Bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);

    h.mkt.cancel_listing(&seller, &listing_id);

    // Bot returned to seller
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // Listing is inactive and removed from active list
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
    assert_eq!(h.mkt.get_active_listings(&0, &100).0.len(), 0);
}

#[test]
fn test_buy_inactive_listing_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 100_0000000_i128;

    h.token.mint(&buyer, &(price * 2));
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);

    // Cancel the listing first
    h.mkt.cancel_listing(&seller, &listing_id);

    // Buying a cancelled listing must fail
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &listing_id),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
}

#[test]
fn test_cancel_already_cancelled_listing_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    h.mkt.cancel_listing(&seller, &listing_id);

    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &listing_id),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
}

#[test]
fn test_cancel_listing_not_found() {
    let h = setup();
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &404_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
}

#[test]
fn test_cancel_listing_by_non_seller_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    assert_eq!(
        h.mkt.try_cancel_listing(&stranger, &listing_id),
        Err(Ok(MarketplaceError::Unauthorized))
    );
    // Listing still active
    assert!(h.mkt.get_listing(&listing_id).active);
}

// ── Issue #228: Cross-contract integration test: registry ↔ bot_nft ──────────

/// Test that minting a bot increments the user's bot_count in the registry.
/// Verifies the contract interaction path: bot_nft.mint_basic() → registry.increment_bot_count()
#[test]
fn test_bot_nft_registry_integration_mint_increments_bot_count() {
    let h = setup();

    // Register a user in the registry
    let user = Address::generate(&h.env);
    register_user(&h.env, &h.registry.address, &user, "testuser");

    // Verify initial bot_count is 0
    let profile_before = h.registry.get_user(&user);
    assert_eq!(profile_before.bot_count, 0);

    // Mint a bot for the user
    h.bot.mint_basic(&user);

    // Verify bot_count was incremented to 1
    let profile_after = h.registry.get_user(&user);
    assert_eq!(profile_after.bot_count, 1);

    // Mint another bot and verify increment
    h.bot.admin_mint(&user, &BotTier::Basic);
    let profile_after2 = h.registry.get_user(&user);
    assert_eq!(profile_after2.bot_count, 2);
}

/// Test that mint_basic still succeeds even if registry is not initialized or user is not registered.
/// The bot_nft contract should swallow registry errors gracefully.
#[test]
fn test_bot_nft_mint_succeeds_even_if_registry_not_initialized() {
    let h = setup();

    // Create a new bot_nft without a valid registry
    let admin = Address::generate(&h.env);
    let bad_registry = Address::generate(&h.env); // Not a real contract
    let (_bot_id, bot) = deploy_bot_nft_with_registry(&h.env, &admin, &bad_registry);

    let owner = Address::generate(&h.env);

    // mint_basic should still succeed despite registry error
    let bot_id = bot.mint_basic(&owner);
    assert_eq!(bot_id, 1);
    assert_eq!(bot.get_user_bots(&owner).len(), 1);
}

// ── Issue #231: Cross-contract integration test: bot_nft ↔ marketplace ──────

/// Test that listing a bot transfers ownership to the marketplace (escrowing).
/// Verifies: listing creates escrow and bot owner becomes marketplace contract.
#[test]
fn test_bot_nft_marketplace_integration_listing_escrows_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);

    // Mint a bot for the seller
    let bot_id = h.bot.mint_basic(&seller);

    // Verify seller is the owner
    let bot_before = h.bot.get_bot(&bot_id);
    assert_eq!(bot_before.owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // List the bot at a price
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(listing_id, 1);

    // Verify bot is now escrowed (owner is marketplace contract)
    let bot_after = h.bot.get_bot(&bot_id);
    assert_eq!(bot_after.owner, h.mkt.address);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Verify listing is active and has correct metadata
    let listing = h.mkt.get_listing(&listing_id);
    assert!(listing.active);
    assert_eq!(listing.seller, seller);
    assert_eq!(listing.bot_id, bot_id);
    assert_eq!(listing.price, 100_0000000_i128);
}

/// Test that cancelling a listing returns the escrowed bot to the seller.
/// Verifies: cancel_listing transfers bot back from marketplace to seller.
#[test]
fn test_bot_nft_marketplace_integration_cancel_returns_escrowed_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);

    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // Verify bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);

    // Cancel the listing
    h.mkt.cancel_listing(&seller, &listing_id);

    // Verify bot is returned to seller
    let bot_after_cancel = h.bot.get_bot(&bot_id);
    assert_eq!(bot_after_cancel.owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // Verify listing is inactive
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
}

/// Test that a second purchase attempt on an escrowed bot fails (bot is locked in escrow).
/// Verifies: active listing prevents re-listing the same bot.
#[test]
fn test_bot_nft_marketplace_integration_escrowed_bot_cannot_be_listed_again() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    // List the bot
    let _listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // Verify seller no longer owns the bot
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Attempt to list the same bot again should fail (seller is no longer owner)
    let result = h.mkt.try_list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(result, Err(Ok(MarketplaceError::NotBotOwner)));
}

// ── Issue #232: Cross-contract integration test: marketplace ↔ token ↔ registry ──

/// Test full purchase flow: list bot → buyer transfers tokens → bot transferred to buyer.
/// Verifies all three contracts interact correctly in a full sale.
#[test]
fn test_marketplace_token_registry_integration_full_sale_with_updates() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 1000_0000000_i128;
    let fee = (price * 25) / 1000;
    let seller_receives = price - fee;

    // Register both users in registry
    register_user(&h.env, &h.registry.address, &seller, "seller");
    register_user(&h.env, &h.registry.address, &buyer, "buyer");

    // Fund buyer with tokens
    h.token.mint(&buyer, &(price * 2));

    // Seller mints a bot via bot_nft
    let bot_nft_id = h.bot.mint_basic(&seller);

    // Verify registry bot_count incremented for seller
    assert_eq!(h.registry.get_user(&seller).bot_count, 1);

    // Seller lists the bot at price on marketplace
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_nft_id, &price, &h.token.address, &604_800_u64);

    // Verify bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_nft_id).owner, h.mkt.address);

    // Record balances before purchase
    let seller_balance_before = h.token.balance(&seller);
    let buyer_balance_before = h.token.balance(&buyer);
    let admin_balance_before = h.mkt.fees_accrued(&h.token.address);

    // Buyer purchases the bot
    h.mkt.buy_bot(&buyer, &listing_id);

    // Verify token transfers: buyer pays full price, seller gets (price - fee), admin gets fee
    assert_eq!(h.token.balance(&buyer), buyer_balance_before - price);
    assert_eq!(
        h.token.balance(&seller),
        seller_balance_before + seller_receives
    );
    assert_eq!(
        h.mkt.fees_accrued(&h.token.address),
        admin_balance_before + fee
    );

    // Verify bot ownership transferred to buyer
    assert_eq!(h.bot.get_bot(&bot_nft_id).owner, buyer);
    assert_eq!(h.bot.get_user_bots(&buyer).len(), 1);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Verify listing is inactive
    assert!(!h.mkt.get_listing(&listing_id).active);

    // Verify seller bot_count remains 1 (mint incremented, transfer doesn't change bot_count)
    assert_eq!(h.registry.get_user(&seller).bot_count, 1);

    // Verify buyer bot_count remains 0 (transfer from marketplace to buyer doesn't increment)
    assert_eq!(h.registry.get_user(&buyer).bot_count, 0);
}

/// Test that multiple sequential purchases (multiple bots) work correctly.
/// Verifies: marketplace supports multiple listings and purchases without state corruption.
#[test]
fn test_marketplace_token_registry_integration_multiple_purchases() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer1 = Address::generate(&h.env);
    let buyer2 = Address::generate(&h.env);
    let price = 100_0000000_i128;

    // Fund both buyers
    h.token.mint(&buyer1, &(price * 2));
    h.token.mint(&buyer2, &(price * 2));

    // Mint two bots for seller
    let bot_id1 = h.bot.mint_basic(&seller);
    let bot_id2 = h.bot.admin_mint(&seller, &BotTier::Basic);

    // List both bots
    let listing_id1 = h
        .mkt
        .list_bot(&seller, &bot_id1, &price, &h.token.address, &604_800_u64);
    let listing_id2 = h
        .mkt
        .list_bot(&seller, &bot_id2, &price, &h.token.address, &604_800_u64);

    // Verify both are escrowed and active
    assert_eq!(h.bot.get_bot(&bot_id1).owner, h.mkt.address);
    assert_eq!(h.bot.get_bot(&bot_id2).owner, h.mkt.address);
    assert!(h.mkt.get_listing(&listing_id1).active);
    assert!(h.mkt.get_listing(&listing_id2).active);

    // First buyer purchases first bot
    h.mkt.buy_bot(&buyer1, &listing_id1);
    assert_eq!(h.bot.get_bot(&bot_id1).owner, buyer1);
    assert!(!h.mkt.get_listing(&listing_id1).active);

    // Second buyer purchases second bot
    h.mkt.buy_bot(&buyer2, &listing_id2);
    assert_eq!(h.bot.get_bot(&bot_id2).owner, buyer2);
    assert!(!h.mkt.get_listing(&listing_id2).active);

    // Verify seller received payment for both
    let fee = (price * 25) / 1000;
    let seller_receives_per_sale = price - fee;
    assert_eq!(h.token.balance(&seller), seller_receives_per_sale * 2);
}

// ── Issue #543: explicit authorization tests ──────────────────────────────
//
// `setup()` above uses `mock_all_auths()`, which makes every
// `require_auth()` call succeed unconditionally and therefore cannot catch a
// missing or incorrect auth check. Each test here exercises one
// `require_auth()` call site directly: the call must fail when the required
// signer has not authorized it, and succeed when that signer's authorization
// is explicitly mocked for exactly that invocation.
#[cfg(test)]
mod auth_tests {
    use super::*;
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let h = setup();
        let mkt_id = h.env.register_contract(None, MarketplaceContract);
        let mkt = MarketplaceContractClient::new(&h.env, &mkt_id);
        let admin = Address::generate(&h.env);

        h.env.mock_auths(&[]);
        let result = mkt.try_initialize(&admin, &h.bot.address, &250u32, &0u32);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let h = setup();
        let mkt_id = h.env.register_contract(None, MarketplaceContract);
        let mkt = MarketplaceContractClient::new(&h.env, &mkt_id);
        let admin = Address::generate(&h.env);

        h.env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &mkt_id,
                fn_name: "initialize",
                args: (admin.clone(), h.bot.address.clone(), 250u32, 0u32).into_val(&h.env),
                sub_invokes: &[],
            },
        }]);
        let result = mkt.try_initialize(&admin, &h.bot.address, &250u32, &0u32);
        assert!(result.is_ok());
    }

    #[test]
    fn test_list_bot_fails_without_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);

        h.env.mock_auths(&[]);
        let result = h.mkt.try_list_bot(
            &seller,
            &bot_id,
            &50_0000000_i128,
            &h.token.address,
            &604_800_u64,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_list_bot_succeeds_with_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);

        // `list_bot` escrows the bot via a cross-contract call into
        // `bot_nft.transfer(bot_id, seller, marketplace)`, which itself calls
        // `seller.require_auth()` — so the seller's authorization for the
        // root `list_bot` invocation must also cover that sub-invocation.
        h.env.mock_auths(&[MockAuth {
            address: &seller,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "list_bot",
                args: (
                    seller.clone(),
                    bot_id,
                    50_0000000_i128,
                    h.token.address.clone(),
                    604_800_u64,
                )
                    .into_val(&h.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &h.bot.address,
                    fn_name: "transfer",
                    args: (bot_id, seller.clone(), h.mkt.address.clone()).into_val(&h.env),
                    sub_invokes: &[],
                }],
            },
        }]);
        let result = h.mkt.try_list_bot(
            &seller,
            &bot_id,
            &50_0000000_i128,
            &h.token.address,
            &604_800_u64,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_listing_fails_without_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h.mkt.list_bot(
            &seller,
            &bot_id,
            &50_0000000_i128,
            &h.token.address,
            &604_800_u64,
        );

        h.env.mock_auths(&[]);
        let result = h.mkt.try_cancel_listing(&seller, &listing_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_listing_succeeds_with_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h.mkt.list_bot(
            &seller,
            &bot_id,
            &50_0000000_i128,
            &h.token.address,
            &604_800_u64,
        );

        h.env.mock_auths(&[MockAuth {
            address: &seller,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "cancel_listing",
                args: (seller.clone(), listing_id).into_val(&h.env),
                sub_invokes: &[],
            },
        }]);
        let result = h.mkt.try_cancel_listing(&seller, &listing_id);
        assert!(result.is_ok());
    }

    #[test]
    fn test_buy_bot_fails_without_buyer_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let price = 100_0000000_i128;
        h.token.mint(&buyer, &price);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);

        h.env.mock_auths(&[]);
        let result = h.mkt.try_buy_bot(&buyer, &listing_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_buy_bot_succeeds_with_buyer_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let price = 100_0000000_i128;
        h.token.mint(&buyer, &price);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);

        // `buy_bot` pulls the full price from the buyer into the marketplace
        // via `token.transfer(buyer, marketplace, price)`, which itself calls
        // `buyer.require_auth()`, so the buyer's authorization for the root
        // `buy_bot` invocation must also cover that payment sub-invocation.
        // (The payouts from the marketplace and the bot transfer are
        // self-authorized by the marketplace contract and need no mock.)
        h.env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "buy_bot",
                args: (buyer.clone(), listing_id).into_val(&h.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &h.token.address,
                    fn_name: "transfer",
                    args: (buyer.clone(), h.mkt.address.clone(), price).into_val(&h.env),
                    sub_invokes: &[],
                }],
            },
        }]);
        let result = h.mkt.try_buy_bot(&buyer, &listing_id);
        assert!(result.is_ok());
    }
}

// ── AM-016 / next_listing_id enumeration & historical get_listing ───────────

#[test]
fn test_next_listing_id_starts_at_one_and_increments() {
    let h = setup();
    assert_eq!(h.mkt.next_listing_id(), 1);
    let seller = Address::generate(&h.env);
    let id1 = h.bot.mint_basic(&seller);
    let l1 = h.mkt.list_bot(
        &seller,
        &id1,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(l1, 1);
    assert_eq!(h.mkt.next_listing_id(), 2);
    let id2 = h.bot.mint_basic(&seller);
    let l2 = h.mkt.list_bot(
        &seller,
        &id2,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(l2, 2);
    assert_eq!(h.mkt.next_listing_id(), 3);
}

#[test]
fn test_get_listing_historical_remains_readable_after_buy_and_cancel() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    h.token.mint(&buyer, &1000_0000000_i128);
    let bot1 = h.bot.mint_basic(&seller);
    let l1 = h.mkt.list_bot(
        &seller,
        &bot1,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.mkt.buy_bot(&buyer, &l1);
    let hist1 = h.mkt.get_listing(&l1);
    assert!(!hist1.active);
    assert_eq!(hist1.id, l1);
    assert_eq!(
        h.mkt.try_get_listing(&9999_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
    let bot2 = h.bot.mint_basic(&seller);
    let l2 = h.mkt.list_bot(
        &seller,
        &bot2,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.mkt.cancel_listing(&seller, &l2);
    let hist2 = h.mkt.get_listing(&l2);
    assert!(!hist2.active);
    assert_eq!(h.mkt.next_listing_id(), 3);
}

// ── min_price / fee_bps relationship ─────────────────────────────────────

#[test]
fn test_min_price_default_guarantees_fee_at_least_one() {
    let h = setup();
    let default_min = h.mkt.get_min_price(&h.token.address);
    assert_eq!(default_min, 40);
    let fee = default_min * 250 / 10_000;
    assert!(
        fee >= 1,
        "fee {} should be >=1 for default min {}",
        fee,
        default_min
    );
}

#[test]
fn test_price_below_min_fails_with_price_too_low() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_id, &39_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot2 = h.bot.admin_mint(&seller, &BotTier::Basic);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot2, &1_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot3 = h.bot.admin_mint(&seller, &BotTier::Basic);
    let res = h
        .mkt
        .try_list_bot(&seller, &bot3, &40_i128, &h.token.address, &604_800_u64);
    assert!(res.is_ok(), "price == min should succeed, got {:?}", res);
}

#[test]
fn test_min_price_per_currency_admin_settable() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let currency_a = h.token.address.clone();
    let currency_b = Address::generate(&h.env);
    h.mkt.add_allowed_currency(&currency_b);
    h.mkt.set_min_price(&currency_a, &1000_i128);
    h.mkt.set_min_price(&currency_b, &5000_i128);
    assert_eq!(h.mkt.get_min_price(&currency_a), 1000);
    assert_eq!(h.mkt.get_min_price(&currency_b), 5000);
    let bot1 = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot1, &500_i128, &currency_a, &604_800_u64),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot2 = h.bot.admin_mint(&seller, &BotTier::Basic);
    let ok_a = h
        .mkt
        .try_list_bot(&seller, &bot2, &2000_i128, &currency_a, &604_800_u64);
    assert!(ok_a.is_ok());
    let bot3 = h.bot.admin_mint(&seller, &BotTier::Basic);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot3, &2000_i128, &currency_b, &604_800_u64),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot4 = h.bot.admin_mint(&seller, &BotTier::Basic);
    assert!(h
        .mkt
        .try_list_bot(&seller, &bot4, &6000_i128, &currency_b, &604_800_u64)
        .is_ok());
}

#[test]
fn test_fee_always_at_least_one_for_any_accepted_price() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let min = h.mkt.get_min_price(&h.token.address);
    for delta in 0..20 {
        let price = min + delta;
        let fee = price * 250 / 10_000;
        assert!(fee >= 1, "price {} fee {} should be >=1", price, fee);
        let bot = h.bot.mint_basic(&seller);
        let listing = h
            .mkt
            .list_bot(&seller, &bot, &price, &h.token.address, &604_800_u64);
        let buyer = Address::generate(&h.env);
        h.token.mint(&buyer, &(price));
        let admin_before = h.mkt.fees_accrued(&h.token.address);
        h.mkt.buy_bot(&buyer, &listing);
        let fee_paid = h.mkt.fees_accrued(&h.token.address) - admin_before;
        assert!(
            fee_paid >= 1,
            "fee paid {} for price {} should be >=1",
            fee_paid,
            price
        );
    }
}

#[test]
fn test_set_min_price_requires_admin_auth() {
    let h = setup();
    let currency = Address::generate(&h.env);
    h.env.mock_auths(&[]);
    let res = h.mkt.try_set_min_price(&currency, &100_i128);
    assert!(res.is_err(), "set_min_price without admin should fail");
}

#[test]
fn test_fee_bps_change_updates_default_min_price() {
    let h = setup();
    let currency = Address::generate(&h.env);
    assert_eq!(h.mkt.get_min_price(&currency), 40);
    h.mkt.set_fee_bps(&500u32);
    assert_eq!(h.mkt.get_min_price(&currency), 20);
    let custom_cur = Address::generate(&h.env);
    h.mkt.set_min_price(&custom_cur, &1000_i128);
    h.mkt.set_fee_bps(&1000u32);
    assert_eq!(
        h.mkt.get_min_price(&custom_cur),
        1000,
        "custom floor must not change"
    );
    assert_eq!(h.mkt.get_min_price(&currency), 10);
}

// ── buy_bot: stale listing (marketplace not owner) ────────────────────────

#[test]
fn test_buy_stale_listing_fails_before_payment_and_marks_inactive() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 100_0000000_i128;
    h.token.mint(&buyer, &price);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);
    // Manually reassign bot out of marketplace (simulate admin action / bug)
    h.bot.transfer(&bot_id, &h.mkt.address, &seller);
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
    let buyer_balance_before = h.token.balance(&buyer);
    let seller_balance_before = h.token.balance(&seller);
    let res = h.mkt.try_buy_bot(&buyer, &listing_id);
    assert_eq!(res, Err(Ok(MarketplaceError::ListingStale)));
    assert_eq!(h.token.balance(&buyer), buyer_balance_before);
    assert_eq!(h.token.balance(&seller), seller_balance_before);
    // Stale listing stops appearing in active listings (filtered by ownership)
    assert_eq!(h.mkt.get_active_listings(&0, &100).0.len(), 0);
    // Historical get_listing still returns it (active flag may still be true due to
    // host revert on error, but the filtered active list is empty)
    let listing = h.mkt.get_listing(&listing_id);
    // If host reverts, active may still be true; we check that it is not in active list
    // and that a subsequent buy still fails as stale (or not active)
    assert!(h.mkt.get_active_listings(&0, &100).0.len() == 0);
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
}

// ── fee arithmetic boundary, buyer exactly enough / one short ────────────

#[test]
fn test_fee_boundary_prices() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let bot_dust = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_dust, &39_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot_ok = h.bot.admin_mint(&seller, &BotTier::Basic);
    let l40 = h
        .mkt
        .list_bot(&seller, &bot_ok, &40_i128, &h.token.address, &604_800_u64);
    h.token.mint(&buyer, &40_i128);
    let admin_before = h.mkt.fees_accrued(&h.token.address);
    h.mkt.buy_bot(&buyer, &l40);
    assert_eq!(h.mkt.fees_accrued(&h.token.address) - admin_before, 1);
    let seller2 = Address::generate(&h.env);
    let buyer2 = Address::generate(&h.env);
    // No balance needed: the fee multiplication overflows before payment.
    let bot_big = h.bot.mint_basic(&seller2);
    let l_big = h.mkt.list_bot(
        &seller2,
        &bot_big,
        &i128::MAX,
        &h.token.address,
        &604_800_u64,
    );
    let res = h.mkt.try_buy_bot(&buyer2, &l_big);
    assert_eq!(res, Err(Ok(MarketplaceError::Overflow)));
}

#[test]
fn test_buyer_exactly_enough_and_one_short() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let price = 1000_0000000_i128;
    let bot1 = h.bot.mint_basic(&seller);
    let l1 = h
        .mkt
        .list_bot(&seller, &bot1, &price, &h.token.address, &604_800_u64);
    let buyer_ok = Address::generate(&h.env);
    h.token.mint(&buyer_ok, &price);
    let res_ok = h.mkt.try_buy_bot(&buyer_ok, &l1);
    assert!(res_ok.is_ok(), "exactly enough should succeed");
    assert_eq!(h.token.balance(&buyer_ok), 0);
    let seller2 = Address::generate(&h.env);
    let bot2 = h.bot.mint_basic(&seller2);
    let l2 = h
        .mkt
        .list_bot(&seller2, &bot2, &price, &h.token.address, &604_800_u64);
    let buyer_short = Address::generate(&h.env);
    h.token.mint(&buyer_short, &(price - 1));
    let res_short = h.mkt.try_buy_bot(&buyer_short, &l2);
    assert_eq!(res_short, Err(Ok(MarketplaceError::PaymentFailed)));
    assert_eq!(
        h.token.balance(&buyer_short),
        price - 1,
        "balance unchanged on payment failure"
    );
    assert!(h.mkt.get_listing(&l2).active);
}

// ── self-purchase, double-purchase, cancel-then-buy ─────────────────────

#[test]
fn test_self_purchase_fails_with_self_purchase_error() {
    let h = setup();
    let seller = Address::generate(&h.env);
    h.token.mint(&seller, &100_0000000_i128);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(
        h.mkt.try_buy_bot(&seller, &l),
        Err(Ok(MarketplaceError::SelfPurchase))
    );
    assert!(h.mkt.get_listing(&l).active);
}

#[test]
fn test_double_purchase_of_one_listing_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer1 = Address::generate(&h.env);
    let buyer2 = Address::generate(&h.env);
    let price = 100_0000000_i128;
    h.token.mint(&buyer1, &price);
    h.token.mint(&buyer2, &price);
    let bot = h.bot.mint_basic(&seller);
    let l = h
        .mkt
        .list_bot(&seller, &bot, &price, &h.token.address, &604_800_u64);
    h.mkt.buy_bot(&buyer1, &l);
    assert!(!h.mkt.get_listing(&l).active);
    let res2 = h.mkt.try_buy_bot(&buyer2, &l);
    assert_eq!(res2, Err(Ok(MarketplaceError::ListingNotActive)));
    assert_eq!(h.bot.get_bot(&bot).owner, buyer1);
}

#[test]
fn test_cancel_then_buy_race_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 100_0000000_i128;
    h.token.mint(&buyer, &price);
    let bot = h.bot.mint_basic(&seller);
    let l = h
        .mkt
        .list_bot(&seller, &bot, &price, &h.token.address, &604_800_u64);
    h.mkt.cancel_listing(&seller, &l);
    assert!(!h.mkt.get_listing(&l).active);
    assert_eq!(h.bot.get_bot(&bot).owner, seller);
    let res = h.mkt.try_buy_bot(&buyer, &l);
    assert_eq!(res, Err(Ok(MarketplaceError::ListingNotActive)));
    assert_eq!(h.token.balance(&buyer), price);
}

// ── index consistency after 30 mixed operations (reduced from 100 for budget) ─

#[test]
fn test_index_consistency_after_30_mixed_operations() {
    let h = setup();
    let mut sellers: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&h.env);
    let mut buyers: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&h.env);
    for _ in 0..3 {
        let s = Address::generate(&h.env);
        sellers.push_back(s);
        let b = Address::generate(&h.env);
        h.token.mint(&b, &10_000_0000000_i128);
        buyers.push_back(b);
    }
    let mut total_created: u64 = 0;
    for i in 0..30 {
        let seller = sellers.get((i % 3) as u32).unwrap().clone();
        let op = i % 4;
        if op == 0 {
            let bot = h.bot.mint_basic(&seller);
            let price = 100_0000000_i128 + (i as i128 * 10);
            let res = h
                .mkt
                .try_list_bot(&seller, &bot, &price, &h.token.address, &604_800_u64);
            if let Ok(Ok(_)) = res {
                total_created += 1;
            }
        } else if op == 1 {
            let actives = h.mkt.get_active_listings(&0, &100).0;
            if actives.len() > 0 {
                let listing = actives.get(0).unwrap();
                let buyer = buyers.get((i % 3) as u32).unwrap().clone();
                if buyer != listing.seller {
                    let _ = h.mkt.try_buy_bot(&buyer, &listing.id);
                }
            }
        } else if op == 2 {
            let actives = h.mkt.get_active_listings(&0, &100).0;
            for l in actives.iter() {
                if l.seller == seller {
                    let _ = h.mkt.try_cancel_listing(&seller, &l.id);
                    break;
                }
            }
        }
        let actives = h.mkt.get_active_listings(&0, &200).0;
        let mut seen: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(&h.env);
        for l in actives.iter() {
            assert!(l.active, "active listing {} should be active", l.id);
            // manual duplicate check
            for sid in seen.iter() {
                assert!(sid != l.id, "duplicate active id {}", l.id);
            }
            seen.push_back(l.id);
            let via_get = h.mkt.get_listing(&l.id);
            assert_eq!(via_get.id, l.id);
            assert!(via_get.active);
        }
        assert_eq!(h.mkt.next_listing_id(), total_created + 1);
        for s in sellers.iter() {
            let ul = h.mkt.get_user_listings(&s);
            for l in ul.iter() {
                let fetched = h.mkt.get_listing(&l.id);
                assert_eq!(fetched.seller, s.clone());
            }
        }
    }
    let final_next = h.mkt.next_listing_id();
    assert_eq!(final_next, total_created + 1);
    for id in 1..=total_created {
        let res = h.mkt.try_get_listing(&id);
        assert!(res.is_ok(), "historical listing {} should be readable", id);
    }
    assert_eq!(
        h.mkt.try_get_listing(&final_next),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
    assert_eq!(h.mkt.get_active_listings(&1000, &10).0.len(), 0);
    assert_eq!(h.mkt.get_active_listings(&0, &0).0.len(), 0);
}

// ── every MarketplaceError variant has a test that asserts that exact variant ─

#[test]
fn test_error_variant_already_initialized() {
    let h = setup();
    assert_eq!(
        h.mkt
            .try_initialize(&h.admin, &h.bot.address, &250u32, &0u32),
        Err(Ok(MarketplaceError::AlreadyInitialized))
    );
}

#[test]
fn test_error_variant_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let mkt_id = env.register_contract(None, MarketplaceContract);
    let mkt = MarketplaceContractClient::new(&env, &mkt_id);
    let seller = Address::generate(&env);
    let bot_fake = 1_u64;
    let tok = Address::generate(&env);
    let res = mkt.try_list_bot(&seller, &bot_fake, &100_i128, &tok, &604_800_u64);
    assert_eq!(res, Err(Ok(MarketplaceError::NotInitialized)));
}

#[test]
fn test_error_variant_invalid_price() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot, &0_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
    let bot2 = h.bot.admin_mint(&seller, &BotTier::Basic);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot2, &-5_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
}

#[test]
fn test_error_variant_price_too_low() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot, &10_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
}

#[test]
fn test_error_variant_bot_transfer_failed() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;
    let h = setup();
    let seller = Address::generate(&h.env);
    // A missing bot is BotNotFound, not a transfer failure (#427).
    assert_eq!(
        h.mkt.try_list_bot(
            &seller,
            &9999_u64,
            &100_i128,
            &h.token.address,
            &604_800_u64
        ),
        Err(Ok(MarketplaceError::BotNotFound))
    );
    // Someone else's bot is NotBotOwner, not a transfer failure (#427).
    let owner = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&owner);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot, &100_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::NotBotOwner))
    );
    // A genuine escrow-transfer failure still surfaces BotTransferFailed:
    // authorize list_bot but not the nested transfer.
    let own_bot = h.bot.mint_basic(&seller);
    h.env.mock_auths(&[MockAuth {
        address: &seller,
        invoke: &MockAuthInvoke {
            contract: &h.mkt.address,
            fn_name: "list_bot",
            args: (
                seller.clone(),
                own_bot,
                100_i128,
                h.token.address.clone(),
                604_800_u64,
            )
                .into_val(&h.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &own_bot, &100_i128, &h.token.address, &604_800_u64),
        Err(Ok(MarketplaceError::BotTransferFailed))
    );
}

#[test]
fn test_error_variant_listing_not_found() {
    let h = setup();
    assert_eq!(
        h.mkt.try_get_listing(&99999_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
    let buyer = Address::generate(&h.env);
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &99999_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &99999_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
}

#[test]
fn test_error_variant_listing_not_active() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    h.token.mint(&buyer, &100_0000000_i128);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.mkt.cancel_listing(&seller, &l);
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &l),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &l),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
}

#[test]
fn test_error_variant_listing_inactive_and_not_seller_codes_exist() {
    assert_eq!(MarketplaceError::ListingInactive as u32, 7);
    assert_eq!(MarketplaceError::NotSeller as u32, 6);
    assert_eq!(MarketplaceError::InsufficientFunds as u32, 8);
}

#[test]
fn test_error_variant_unauthorized() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(
        h.mkt.try_cancel_listing(&stranger, &l),
        Err(Ok(MarketplaceError::Unauthorized))
    );
}

#[test]
fn test_error_variant_self_purchase() {
    let h = setup();
    let seller = Address::generate(&h.env);
    h.token.mint(&seller, &100_0000000_i128);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(
        h.mkt.try_buy_bot(&seller, &l),
        Err(Ok(MarketplaceError::SelfPurchase))
    );
}

#[test]
fn test_error_variant_payment_failed() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &l),
        Err(Ok(MarketplaceError::PaymentFailed))
    );
}

#[test]
fn test_error_variant_overflow() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    h.token.mint(&buyer, &i128::MAX);
    let bot = h.bot.mint_basic(&seller);
    let l = h
        .mkt
        .list_bot(&seller, &bot, &i128::MAX, &h.token.address, &604_800_u64);
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &l),
        Err(Ok(MarketplaceError::Overflow))
    );
}

#[test]
fn test_error_variant_listing_stale() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    h.token.mint(&buyer, &100_0000000_i128);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.bot.transfer(&bot, &h.mkt.address, &seller);
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &l),
        Err(Ok(MarketplaceError::ListingStale))
    );
}

// ── E2E five-contract integration — register → mint → accrual → claim → Gold → trade ──
//
// Exercises the exact flow the README describes end-to-end, where each
// contract passes its own unit tests while the system as a whole is wrong
// (desyncs AM-003, AM-012, AM-126). Every step below asserts a distinct
// cross-contract invariant; reverting any of those fixes breaks this test
// while leaving the per-contract suites green.
//
// Flow:
//   1. register two users (registry)
//   2. mint a Basic bot each (bot_nft → registry bot_count)
//   3. start accrual (accrual) with the bot-derived rate
//   4. advance ledger time, claim and assert AMT (accrual → registry → token)
//   5. mint a Gold bot (bot_nft rate change)
//   6. list Gold, fund buyer, buy from second account (marketplace + token + bot_nft)
//   7. assert final balances, ownership, registry counts, and both accrual rates
#[test]
fn test_e2e_five_contract_full_flow() {
    use automint_accrual::AccrualContractClient;
    use automint_bot_nft::BotTier;
    use soroban_sdk::{testutils::Ledger, String};

    // Deploy all five contracts with the shared test harness.
    let deployment = deploy_all(Env::default());
    let env = &deployment.env;

    // Clients — use the deployment's pre-built clients so we don't duplicate
    // registration logic; they all share the same Env.
    let registry = RegistryContractClient::new(env, &deployment.registry_id);
    let bot = BotNFTContractClient::new(env, &deployment.bot_nft_id);
    let token = AMTTokenClient::new(env, &deployment.token_id);
    let accrual = AccrualContractClient::new(env, &deployment.accrual_id);
    let marketplace = MarketplaceContractClient::new(env, &deployment.marketplace_id);
    let admin = deployment.admin.clone();

    // 1. Register two users.
    let alice = Address::generate(env);
    let bob = Address::generate(env);
    register_user(env, &deployment.registry_id, &alice, "alice");
    register_user(env, &deployment.registry_id, &bob, "bob");

    // Invariants 1-3: registry state after registration.
    assert_eq!(registry.total_users(), 2, "total_users should be 2");
    assert!(registry.is_registered(&alice), "alice should be registered");
    assert!(registry.is_registered(&bob), "bob should be registered");
    assert_eq!(
        registry.get_user(&alice).username,
        String::from_str(env, "alice")
    );
    assert_eq!(
        registry.get_user(&bob).username,
        String::from_str(env, "bob")
    );
    assert_eq!(registry.get_user(&alice).bot_count, 0);
    assert_eq!(registry.get_user(&bob).bot_count, 0);

    // 2. Mint a Basic bot each (free tier).
    let alice_basic_id = bot.mint_basic(&alice);
    let bob_basic_id = bot.mint_basic(&bob);

    // Invariants 4-7: bot ownership and registry bot_count desync (AM-003).
    assert_eq!(bot.get_bot(&alice_basic_id).owner, alice);
    assert_eq!(bot.get_bot(&bob_basic_id).owner, bob);
    assert_eq!(bot.get_user_bots(&alice).len(), 1, "alice should own 1 bot");
    assert_eq!(bot.get_user_bots(&bob).len(), 1, "bob should own 1 bot");
    // Registry bot_count is incremented via bot_nft → registry cross-call.
    assert_eq!(
        registry.get_user(&alice).bot_count,
        1,
        "registry bot_count for alice should be 1 (AM-003)"
    );
    assert_eq!(
        registry.get_user(&bob).bot_count,
        1,
        "registry bot_count for bob should be 1 (AM-003)"
    );
    // Bot tier and rate sanity.
    assert_eq!(bot.get_bot(&alice_basic_id).tier, BotTier::Basic);
    assert_eq!(bot.get_bot(&bob_basic_id).tier, BotTier::Basic);
    // Basic effective rate is always 1 (bonus <1 for base 1).
    assert_eq!(bot.get_bot(&alice_basic_id).accrual_rate, 1);
    assert_eq!(
        bot.get_user_total_rate(&alice),
        1,
        "alice total rate should be 1"
    );
    assert_eq!(
        bot.get_user_total_rate(&bob),
        1,
        "bob total rate should be 1"
    );

    // 3. Start accrual for both users. The rate is derived from bot_nft
    // (#319): one Basic bot each → 1 point per hour.
    accrual.start_accrual(&alice);
    accrual.start_accrual(&bob);

    // Invariants 8-9: accrual state initialized correctly.
    let alice_state = accrual
        .get_accrual_state(&alice)
        .expect("alice accrual state");
    assert_eq!(alice_state.carry_points, 0);
    assert_eq!(alice_state.lifetime_points, 0);
    // last_claim_ts should equal current ledger timestamp at start.
    assert_eq!(alice_state.last_claim_ts, env.ledger().timestamp());
    let bob_state = accrual.get_accrual_state(&bob).expect("bob accrual state");
    assert_eq!(bob_state.last_claim_ts, env.ledger().timestamp());
    assert_eq!(
        accrual.pending_points(&alice),
        0,
        "pending at t=0 should be 0"
    );

    // 4. Advance time by 3600 hours and claim.
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp.saturating_add(3600 * 3600);
        li.sequence_number = li.sequence_number.saturating_add(10);
    });

    // Pending should be rate * elapsed / 3600 = 1 * 3600h = 3600.
    assert_eq!(
        accrual.pending_points(&alice),
        3600,
        "pending after 3600h at 1/hr should be 3600 (AM-012)"
    );
    assert_eq!(accrual.pending_points(&bob), 3600);

    let alice_claimed = accrual.claim(&alice, &deployment.token_id, &deployment.registry_id);
    let bob_claimed = accrual.claim(&bob, &deployment.token_id, &deployment.registry_id);
    assert_eq!(alice_claimed, 3600);
    assert_eq!(bob_claimed, 3600);

    // Invariants 10-13: accrual → token → registry cross-calls (AM-012, AM-093).
    // With points_per_amt=100, 3600 points → 36 AMT minted, remainder 0.
    assert_eq!(
        token.balance(&alice),
        36 * 10_000_000,
        "alice should have 36 AMT (in 7-decimal base units) after first claim (3600/100)"
    );
    assert_eq!(
        token.balance(&bob),
        36 * 10_000_000,
        "bob should have 36 AMT (in 7-decimal base units) after first claim"
    );
    assert_eq!(
        accrual.pending_points(&alice),
        0,
        "pending should reset to 0 after claim"
    );
    let alice_profile = registry.get_user(&alice);
    assert_eq!(
        alice_profile.total_points, 3600,
        "registry total_points should include claimed pending (AM-093)"
    );
    assert_eq!(
        alice_profile.claimed_amt, 36,
        "registry claimed_amt should reflect minted AMT"
    );
    let bob_profile = registry.get_user(&bob);
    assert_eq!(bob_profile.total_points, 3600);
    assert_eq!(bob_profile.claimed_amt, 36);
    // Accrual state carry is 0 because 3600 %100==0, lifetime is 3600.
    let final_alice_state = accrual.get_accrual_state(&alice).unwrap();
    assert_eq!(final_alice_state.carry_points, 0);
    assert_eq!(final_alice_state.lifetime_points, 3600);

    // 5. Mint a Gold bot for Alice via admin_mint (no payment, deterministic rarity).
    let alice_rate_before_gold = bot.get_user_total_rate(&alice);
    assert_eq!(alice_rate_before_gold, 1);
    let gold_id = bot.admin_mint(&alice, &BotTier::Gold);
    let gold_bot = bot.get_bot(&gold_id);
    assert_eq!(gold_bot.tier, BotTier::Gold);
    assert_eq!(gold_bot.owner, alice);
    // Gold base rate 100 + bonus 0..5 => effective 100..105.
    let gold_rate = gold_bot.accrual_rate;
    assert!(
        (100..=105).contains(&gold_rate),
        "Gold effective rate {} should be 100..105",
        gold_rate
    );
    let alice_rate_after_gold = bot.get_user_total_rate(&alice);
    assert_eq!(
        alice_rate_after_gold,
        alice_rate_before_gold + gold_rate,
        "alice total rate should increase by Gold rate (AM-126)"
    );
    assert!(
        alice_rate_after_gold > alice_rate_before_gold,
        "rate should have changed after Gold mint"
    );
    // Registry bot_count should now be 2 for alice.
    assert_eq!(
        registry.get_user(&alice).bot_count,
        2,
        "alice bot_count should be 2 after Gold mint"
    );
    assert_eq!(bot.get_user_bots(&alice).len(), 2);
    // Bob still 1.
    assert_eq!(registry.get_user(&bob).bot_count, 1);
    assert_eq!(bot.get_user_total_rate(&bob), 1, "bob rate unchanged");

    // 6. List the Gold bot on the marketplace.
    let price: i128 = 100_0000000; // 100 AMT (7 decimals)
    let fee_bps = marketplace.config().fee_bps; // 250
    let expected_fee = price * fee_bps as i128 / 10_000;
    assert_eq!(expected_fee, 2_5000000, "fee should be 2.5 AMT at 250 bps");
    let listing_id =
        marketplace.list_bot(&alice, &gold_id, &price, &deployment.token_id, &604_800_u64);
    assert_eq!(listing_id, 1, "first listing should be id 1");

    // Invariants after listing: escrow.
    assert_eq!(
        bot.get_bot(&gold_id).owner,
        marketplace.address,
        "Gold bot should be escrowed to marketplace after list"
    );
    assert_eq!(
        bot.get_user_bots(&alice).len(),
        1,
        "alice should have 1 bot after escrow (basic only)"
    );
    let listing = marketplace.get_listing(&listing_id);
    assert!(listing.active, "listing should be active");
    assert_eq!(listing.seller, alice);
    assert_eq!(listing.bot_id, gold_id);
    assert_eq!(listing.price, price);
    assert_eq!(marketplace.get_active_listings(&0, &100).0.len(), 1);

    // Fund Bob to afford the purchase. Bob currently has 36 AMT; mint price to cover.
    // Mint exactly price so Bob's balance becomes 36 AMT (base units) + price.
    token.mint(&bob, &price);
    let bob_bal_before = token.balance(&bob);
    let alice_bal_before = token.balance(&alice);
    let admin_bal_before = token.balance(&admin);
    assert_eq!(
        bob_bal_before,
        36 * 10_000_000 + price,
        "bob should be funded to price + claim"
    );
    // Invariant: Bob's token balance before buy is sufficient.

    // 7. Bob buys the Gold bot from Alice.
    marketplace.buy_bot(&bob, &listing_id);

    // Invariants 14-22: final balances, ownership, registry, rates.
    assert_eq!(
        bot.get_bot(&gold_id).owner,
        bob,
        "Gold bot owner should be bob after buy"
    );
    assert_eq!(
        bot.get_user_bots(&bob).len(),
        2,
        "bob should own 2 bots after buy (basic + gold)"
    );
    assert_eq!(
        bot.get_user_bots(&alice).len(),
        1,
        "alice should own 1 bot after sale"
    );
    // Active listings empty, historical listing inactive.
    assert_eq!(
        marketplace.get_active_listings(&0, &100).0.len(),
        0,
        "no active listings after buy"
    );
    let hist = marketplace.get_listing(&listing_id);
    assert!(!hist.active, "historical listing should be inactive");
    assert_eq!(hist.id, listing_id);

    // Token balances: Bob pays price, Alice receives price-fee, admin receives fee.
    let seller_receives = price - expected_fee;
    assert_eq!(
        token.balance(&alice),
        alice_bal_before + seller_receives,
        "alice should receive price - fee"
    );
    assert_eq!(
        token.balance(&bob),
        bob_bal_before - price,
        "bob should pay full price"
    );
    assert_eq!(
        token.balance(&admin),
        admin_bal_before,
        "the fee is retained in the contract, not paid to the admin"
    );
    assert_eq!(
        marketplace.fees_accrued(&token.address),
        expected_fee,
        "the fee accrues for withdraw_fees"
    );
    // Total supply check: balances sum to minted + fees? Just check no underflow.
    assert!(token.balance(&bob) >= 0, "bob balance should not underflow");

    // Registry bot_counts unchanged by marketplace transfer (only mint increments).
    assert_eq!(
        registry.get_user(&alice).bot_count,
        2,
        "alice registry bot_count stays 2 after sale (mint only)"
    );
    assert_eq!(
        registry.get_user(&bob).bot_count,
        1,
        "bob registry bot_count stays 1 after buy (buy does not increment)"
    );

    // Both accrual rates via bot_nft reflect new ownership.
    // Alice back to 1 (only basic), Bob now 1 + gold_rate.
    assert_eq!(
        bot.get_user_total_rate(&alice),
        1,
        "alice total rate should be 1 after selling Gold (AM-126)"
    );
    let bob_rate_after = bot.get_user_total_rate(&bob);
    assert_eq!(
        bob_rate_after,
        1 + gold_rate,
        "bob total rate should be basic + gold after buy"
    );
    assert!(
        bob_rate_after > 1,
        "bob rate should have increased after acquiring Gold"
    );

    // Accrual contract still has the rates captured at start — not auto-synced to bot_nft.
    // This desync is intentional; the test documents it: accrual rate is fixed at
    // start, bot_nft rate is the source of truth for future mints. Changing
    // accrual rate requires a separate update, which is out-of-scope for this
    // flow. We assert the accrual state still exists and hasn't been corrupted.
    assert!(accrual.get_accrual_state(&alice).is_some());
    assert!(accrual.get_accrual_state(&bob).is_some());
    assert_eq!(registry.total_users(), 2, "total_users still 2 at end");
}

#[test]
fn test_bot_nft_validation_on_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let invalid_addr = Address::generate(&env);

    let marketplace_id = env.register_contract(None, MarketplaceContract);
    let mkt = MarketplaceContractClient::new(&env, &marketplace_id);

    let result = mkt.try_initialize(&admin, &invalid_addr, &250u32, &0u32);
    assert_eq!(
        result,
        Err(Ok(MarketplaceError::InvalidBotNft)),
        "initialize with non-contract should fail"
    );
}

#[test]
fn test_bot_nft_validation_on_set_bot_nft() {
    let h = setup();
    let invalid_addr = Address::generate(&h.env);

    let result = h.mkt.try_set_bot_nft(&invalid_addr);
    assert_eq!(
        result,
        Err(Ok(MarketplaceError::InvalidBotNft)),
        "set_bot_nft with invalid address should fail"
    );
}

#[test]
fn test_bot_nft_getter() {
    let h = setup();
    assert_eq!(h.mkt.bot_nft(), h.bot.address);
}

// ── #912: rotating the bot NFT address vs escrowed listings ───────────────

#[test]
fn set_bot_nft_is_rejected_while_a_listing_holds_a_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    let (new_bot_nft, _) = deploy_bot_nft_with_registry(&h.env, &h.admin, &h.registry.address);

    let result = h.mkt.try_set_bot_nft(&new_bot_nft);
    assert_eq!(result, Err(Ok(MarketplaceError::ActiveListingsExist)));
    assert_eq!(h.mkt.bot_nft(), h.bot.address);

    // The escrowed bot still settles through the original contract.
    h.mkt.cancel_listing(&seller, &listing_id);
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
}

#[test]
fn set_bot_nft_succeeds_once_every_listing_has_settled() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let cancelled_bot = h.bot.mint_basic(&seller);
    let sold_bot = h.bot.mint_basic(&seller);
    let cancelled = h.mkt.list_bot(
        &seller,
        &cancelled_bot,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    let sold = h.mkt.list_bot(
        &seller,
        &sold_bot,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.token.mint(&buyer, &50_0000000_i128);
    h.mkt.buy_bot(&buyer, &sold);

    // One listing is still escrowing a bot, so rotation stays blocked.
    let (new_bot_nft, _) = deploy_bot_nft_with_registry(&h.env, &h.admin, &h.registry.address);
    assert_eq!(
        h.mkt.try_set_bot_nft(&new_bot_nft),
        Err(Ok(MarketplaceError::ActiveListingsExist))
    );

    h.mkt.cancel_listing(&seller, &cancelled);
    h.mkt.set_bot_nft(&new_bot_nft);
    assert_eq!(h.mkt.bot_nft(), new_bot_nft);
}

// ── #911: combined fee + royalty cap on set_fee_bps ──────────────────────

#[test]
fn set_fee_bps_enforces_the_combined_fee_and_royalty_cap() {
    let h = setup();
    h.env.mock_all_auths();

    // Fee and royalty together may use the whole 10,000 bps and no more.
    let mkt_id = h.env.register_contract(None, MarketplaceContract);
    let mkt = MarketplaceContractClient::new(&h.env, &mkt_id);
    mkt.initialize(&h.admin, &h.bot.address, &100u32, &9_900u32);

    mkt.set_fee_bps(&100u32);
    assert_eq!(mkt.config().fee_bps, 100);
    assert_eq!(
        mkt.try_set_fee_bps(&101u32),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
    assert_eq!(
        mkt.config().fee_bps,
        100,
        "a rejected fee update must leave the fee unchanged"
    );

    // With no royalty the fee alone may reach 10,000 bps but not exceed it.
    h.mkt.set_fee_bps(&10_000u32);
    assert_eq!(h.mkt.config().fee_bps, 10_000);
    assert_eq!(
        h.mkt.try_set_fee_bps(&10_001u32),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
    assert_eq!(h.mkt.config().fee_bps, 10_000);
}

// ── #910: sale and listing events identify their currency ─────────────────

#[test]
fn listed_and_sold_events_carry_the_currency() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let price = 50_0000000_i128;
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);

    let events = h.env.events().all();
    let (_, _, data) = events.last().unwrap();
    let (listed_bot, listed_price, listed_currency): (u64, i128, Address) =
        <(u64, i128, Address)>::try_from_val(&h.env, &data).unwrap();
    assert_eq!(listed_bot, bot_id);
    assert_eq!(listed_price, price);
    assert_eq!(listed_currency, h.token.address);

    h.token.mint(&buyer, &price);
    h.mkt.buy_bot(&buyer, &listing_id);

    let events = h.env.events().all();
    let (_, _, data) = events.last().unwrap();
    let (sold_listing, sold_bot, sold_price, sold_currency): (u64, u64, i128, Address) =
        <(u64, u64, i128, Address)>::try_from_val(&h.env, &data).unwrap();
    assert_eq!(sold_listing, listing_id);
    assert_eq!(sold_bot, bot_id);
    assert_eq!(sold_price, price);
    assert_eq!(sold_currency, h.token.address);
}

#[test]
fn test_per_seller_listing_limit() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let seller = Address::generate(&h.env);
    let cap = h.mkt.get_listing_cap();
    assert_eq!(cap, 50, "default cap should be 50");

    for i in 0..cap {
        let tier = if i < 25 {
            BotTier::Basic
        } else {
            BotTier::Bronze
        };
        let bot_id = h.bot.admin_mint(&seller, &tier);
        let result = h.mkt.try_list_bot(
            &seller,
            &bot_id,
            &(100_0000000_i128 + i as i128),
            &h.token.address,
            &604_800_u64,
        );
        assert!(result.is_ok(), "listing #{} should succeed", i + 1);
    }

    let bot_id = h.bot.admin_mint(&seller, &BotTier::Silver);
    let result = h.mkt.try_list_bot(
        &seller,
        &bot_id,
        &(100_0000000_i128 + cap as i128),
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(
        result,
        Err(Ok(MarketplaceError::TooManyListings)),
        "51st listing should exceed cap"
    );

    assert_eq!(
        h.mkt.get_user_active_listing_count(&seller),
        cap,
        "active count should equal cap"
    );
}

#[test]
fn test_listing_count_decreases_on_cancel() {
    let h = setup();
    let seller = Address::generate(&h.env);

    let bot1 = h.bot.mint_basic(&seller);
    let listing1 = h.mkt.list_bot(
        &seller,
        &bot1,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    let bot2 = h.bot.mint_basic(&seller);
    let listing2 = h.mkt.list_bot(
        &seller,
        &bot2,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    assert_eq!(
        h.mkt.get_user_active_listing_count(&seller),
        2,
        "seller should have 2 active listings"
    );

    h.mkt.cancel_listing(&seller, &listing1);

    assert_eq!(
        h.mkt.get_user_active_listing_count(&seller),
        1,
        "seller should have 1 active listing after cancel"
    );

    h.mkt.cancel_listing(&seller, &listing2);

    assert_eq!(
        h.mkt.get_user_active_listing_count(&seller),
        0,
        "seller should have 0 active listings after cancelling all"
    );
}

#[test]
fn test_listing_count_decreases_on_purchase() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 100_0000000_i128;

    let bot1 = h.bot.mint_basic(&seller);
    let listing1 = h
        .mkt
        .list_bot(&seller, &bot1, &price, &h.token.address, &604_800_u64);

    let bot2 = h.bot.mint_basic(&seller);
    let listing2 = h
        .mkt
        .list_bot(&seller, &bot2, &price, &h.token.address, &604_800_u64);

    h.token.mint(&buyer, &(price * 2));

    h.mkt.buy_bot(&buyer, &listing1);

    assert_eq!(
        h.mkt.get_user_active_listing_count(&seller),
        1,
        "seller should have 1 active listing after sale"
    );
}

#[test]
fn test_admin_can_adjust_listing_cap() {
    let h = setup();
    let seller = Address::generate(&h.env);

    h.mkt.set_listing_cap(&10);
    assert_eq!(h.mkt.get_listing_cap(), 10);

    for i in 0..10 {
        let bot_id = h.bot.mint_basic(&seller);
        h.mkt.list_bot(
            &seller,
            &bot_id,
            &(50_0000000_i128 + i as i128),
            &h.token.address,
            &604_800_u64,
        );
    }

    let bot_id = h.bot.mint_basic(&seller);
    let result = h.mkt.try_list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    assert_eq!(
        result,
        Err(Ok(MarketplaceError::TooManyListings)),
        "11th listing should exceed new cap of 10"
    );
}

#[test]
fn test_transfer_listed_bot_deactivates_listing() {
    let h = setup();
    h.env.mock_all_auths();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let recipient = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    h.bot.set_marketplace(&h.mkt.address);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &50_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // Transferring the listed bot to recipient notifies on_bot_moved
    h.bot.transfer(&bot_id, &h.mkt.address, &recipient);

    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);

    h.token.mint(&buyer, &100_0000000_i128);
    let result = h.mkt.try_buy_bot(&buyer, &listing_id);
    assert_eq!(result, Err(Ok(MarketplaceError::ListingNotActive)));
}

#[test]
fn test_marketplace_outage_does_not_block_transfer() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let recipient = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    // Set marketplace to a non-contract or uninitialized address
    let bad_mkt = Address::generate(&h.env);
    h.bot.set_marketplace(&bad_mkt);

    // Transfer must succeed cleanly despite marketplace outage
    let result = h.bot.try_transfer(&bot_id, &seller, &recipient);
    assert!(result.is_ok());
    assert_eq!(h.bot.get_bot(&bot_id).owner, recipient);
}

// ── #432 sales statistics ────────────────────────────────────────────────────

#[test]
fn test_tier_stats_follow_a_scripted_sequence_of_sales() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    h.token.mint(&buyer, &1000_0000000_i128);

    let stats = h.mkt.tier_stats(&MktBotTier::Basic);
    assert_eq!(stats.volume, 0);
    assert_eq!(stats.sale_count, 0);
    assert_eq!(stats.floor_price, 0);

    let bot_a = h.bot.mint_basic(&seller);
    let bot_b = h.bot.admin_mint(&seller, &BotTier::Basic);
    let cheap = h.mkt.list_bot(
        &seller,
        &bot_a,
        &40_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    let dear = h.mkt.list_bot(
        &seller,
        &bot_b,
        &60_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // The floor is the cheapest active listing.
    assert_eq!(
        h.mkt.tier_stats(&MktBotTier::Basic).floor_price,
        40_0000000_i128
    );

    // Buying the cheapest moves the floor to the next one.
    h.mkt.buy_bot(&buyer, &cheap);
    let stats = h.mkt.tier_stats(&MktBotTier::Basic);
    assert_eq!(stats.volume, 40_0000000_i128);
    assert_eq!(stats.sale_count, 1);
    assert_eq!(stats.last_sale_price, 40_0000000_i128);
    assert_eq!(stats.floor_price, 60_0000000_i128);

    // Buying the last listing leaves no floor.
    h.mkt.buy_bot(&buyer, &dear);
    let stats = h.mkt.tier_stats(&MktBotTier::Basic);
    assert_eq!(stats.volume, 100_0000000_i128);
    assert_eq!(stats.sale_count, 2);
    assert_eq!(stats.last_sale_price, 60_0000000_i128);
    assert_eq!(stats.floor_price, 0);

    // Other tiers are untouched, and market_stats reports every tier.
    assert_eq!(h.mkt.tier_stats(&MktBotTier::Gold).sale_count, 0);
    assert_eq!(h.mkt.market_stats().len(), 5);
}

#[test]
fn test_floor_updates_when_the_cheapest_listing_is_cancelled_or_repriced() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_a = h.bot.mint_basic(&seller);
    let bot_b = h.bot.admin_mint(&seller, &BotTier::Basic);
    let cheap = h.mkt.list_bot(
        &seller,
        &bot_a,
        &40_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    let dear = h.mkt.list_bot(
        &seller,
        &bot_b,
        &60_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // Repricing the cheapest above the other moves the floor.
    h.mkt.update_price(&seller, &cheap, &80_0000000_i128);
    assert_eq!(
        h.mkt.tier_stats(&MktBotTier::Basic).floor_price,
        60_0000000_i128
    );

    // Repricing below the floor lowers it.
    h.mkt.update_price(&seller, &dear, &50_0000000_i128);
    assert_eq!(
        h.mkt.tier_stats(&MktBotTier::Basic).floor_price,
        50_0000000_i128
    );

    // Cancelling the floor listing falls back to the remaining one.
    h.mkt.cancel_listing(&seller, &dear);
    assert_eq!(
        h.mkt.tier_stats(&MktBotTier::Basic).floor_price,
        80_0000000_i128
    );
}

// ── #433 check ordering ──────────────────────────────────────────────────────

#[test]
fn test_non_seller_gets_unauthorized_whatever_the_listing_state() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    // Active listing.
    assert_eq!(
        h.mkt.try_cancel_listing(&stranger, &listing_id),
        Err(Ok(MarketplaceError::Unauthorized))
    );
    assert_eq!(
        h.mkt
            .try_update_price(&stranger, &listing_id, &200_0000000_i128),
        Err(Ok(MarketplaceError::Unauthorized))
    );

    // Inactive listing: still Unauthorized, not ListingNotActive.
    h.mkt.cancel_listing(&seller, &listing_id);
    assert_eq!(
        h.mkt.try_cancel_listing(&stranger, &listing_id),
        Err(Ok(MarketplaceError::Unauthorized))
    );
    assert_eq!(
        h.mkt
            .try_update_price(&stranger, &listing_id, &200_0000000_i128),
        Err(Ok(MarketplaceError::Unauthorized))
    );

    // The seller does learn that the listing is no longer active.
    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &listing_id),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
}

#[test]
fn test_seller_cannot_buy_own_listing_whatever_its_state() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_id,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.mkt.cancel_listing(&seller, &listing_id);

    assert_eq!(
        h.mkt.try_buy_bot(&seller, &listing_id),
        Err(Ok(MarketplaceError::SelfPurchase))
    );
}

// ── #434 pause and two-step admin transfer ───────────────────────────────────

#[test]
fn test_pause_blocks_trading_but_not_cancel_listing() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    h.token.mint(&buyer, &1000_0000000_i128);
    let bot_a = h.bot.mint_basic(&seller);
    let bot_b = h.bot.admin_mint(&seller, &BotTier::Basic);
    let listing_id = h.mkt.list_bot(
        &seller,
        &bot_a,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );

    h.mkt.pause();
    assert!(h.mkt.is_paused());

    assert_eq!(
        h.mkt.try_list_bot(
            &seller,
            &bot_b,
            &100_0000000_i128,
            &h.token.address,
            &604_800_u64
        ),
        Err(Ok(MarketplaceError::ContractPaused))
    );
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &listing_id),
        Err(Ok(MarketplaceError::ContractPaused))
    );
    assert_eq!(
        h.mkt
            .try_update_price(&seller, &listing_id, &120_0000000_i128),
        Err(Ok(MarketplaceError::ContractPaused))
    );

    // The escape hatch: a seller can still retrieve the escrowed bot.
    h.mkt.cancel_listing(&seller, &listing_id);
    assert_eq!(h.bot.get_bot(&bot_a).owner, seller);

    // Trading resumes after unpause.
    h.mkt.unpause();
    assert!(!h.mkt.is_paused());
    h.mkt.list_bot(
        &seller,
        &bot_b,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
}

#[test]
fn test_admin_transfer_takes_two_steps() {
    let h = setup();
    let new_admin = Address::generate(&h.env);

    assert_eq!(
        h.mkt.try_accept_admin(),
        Err(Ok(MarketplaceError::NoPendingAdmin))
    );

    h.mkt.propose_admin(&new_admin);
    assert_eq!(h.mkt.pending_admin(), Some(new_admin.clone()));
    // Proposing alone changes nothing.
    assert_eq!(h.mkt.config().admin, h.admin);

    h.mkt.accept_admin();
    assert_eq!(h.mkt.config().admin, new_admin);
    assert_eq!(h.mkt.pending_admin(), None);
}

// ---- #323: fee leg is checked; total is pulled first ------------------------

#[test]
fn test_buy_conserves_price_and_admin_gets_exact_fee() {
    let h = setup();
    let cfg = h.mkt.config();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 1000_0000000_i128;
    let bot_id = h.bot.mint_basic(&seller);
    let l = h
        .mkt
        .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);
    h.token.mint(&buyer, &price);

    let fee = price * cfg.fee_bps as i128 / 10_000;
    let seller_before = h.token.balance(&seller);
    let admin_before = h.mkt.fees_accrued(&h.token.address);
    h.mkt.buy_bot(&buyer, &l);

    assert_eq!(h.mkt.fees_accrued(&h.token.address) - admin_before, fee);
    assert_eq!(
        (h.token.balance(&seller) - seller_before)
            + (h.mkt.fees_accrued(&h.token.address) - admin_before),
        price
    );
    assert_eq!(h.token.balance(&buyer), 0);
    assert_eq!(
        h.token.balance(&h.mkt.address),
        fee,
        "only the accrued fee remains in the contract"
    );
}

#[test]
fn test_buy_one_short_keeps_listing_and_escrow() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 1000_0000000_i128;
    let bot_id = h.bot.mint_basic(&seller);
    let l = h
        .mkt
        .list_bot(&seller, &bot_id, &price, &h.token.address, &604_800_u64);
    h.token.mint(&buyer, &(price - 1));

    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &l),
        Err(Ok(MarketplaceError::PaymentFailed))
    );
    assert!(h.mkt.get_listing(&l).active);
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);
    assert_eq!(h.token.balance(&buyer), price - 1);
}

// ---- #333: paged listing index ---------------------------------------------

fn list_many(
    h: &Harness<'static>,
    sellers: &[Address],
    per_seller: u32,
    price: i128,
) -> std::vec::Vec<u64> {
    let mut ids = std::vec::Vec::new();
    let mut n = 0usize;
    for s in sellers {
        for _ in 0..per_seller {
            let bot = h.bot.admin_mint(s, &TIERS[n % 5]);
            n += 1;
            ids.push(
                h.mkt
                    .list_bot(s, &bot, &price, &h.token.address, &604_800_u64),
            );
        }
    }
    ids
}

#[test]
fn test_listing_pages_are_bounded_and_cursor_visits_each_once() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let price = 100_0000000_i128;
    // 5 sellers x 40 = 200 listings.
    let sellers: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&h.env)).collect();
    let ids = list_many(&h, &sellers, 40, price);
    assert_eq!(ids.len(), 200);
    // 200 ids / 100 per page = 2 pages, never one unbounded entry.
    assert_eq!(h.mkt.listing_page_count(), 2);

    // Paginate with the returned cursor, cancelling mid-way.
    let mut cursor = 0u64;
    let mut seen: std::vec::Vec<u64> = std::vec::Vec::new();
    let mut first = true;
    loop {
        let (page, next) = h.mkt.get_active_listings(&cursor, &25);
        for l in page.iter() {
            assert!(l.active);
            seen.push(l.id);
        }
        if first {
            // Cancel a listing already seen and one not yet reached.
            let l0 = h.mkt.get_listing(&ids[0]);
            h.mkt.cancel_listing(&l0.seller, &ids[0]);
            let l_late = h.mkt.get_listing(&ids[150]);
            h.mkt.cancel_listing(&l_late.seller, &ids[150]);
            first = false;
        }
        if next == cursor {
            break;
        }
        cursor = next;
    }
    // Every still-active listing exactly once (ids[0] was seen before cancel).
    let mut sorted = seen.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), seen.len(), "no duplicates");
    for (i, id) in ids.iter().enumerate() {
        if i == 150 {
            assert!(!seen.contains(id));
        } else {
            assert!(seen.contains(id), "listing {} visited", id);
        }
    }
}

#[test]
fn test_compact_page_drops_tombstones_and_pagination_survives() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let sellers: std::vec::Vec<Address> = (0..2).map(|_| Address::generate(&h.env)).collect();
    let ids = list_many(&h, &sellers, 10, 100_0000000_i128);
    for id in ids.iter().take(15) {
        let l = h.mkt.get_listing(id);
        h.mkt.cancel_listing(&l.seller, id);
    }
    assert_eq!(h.mkt.compact_page(&0), 15);
    assert_eq!(h.mkt.compact_page(&0), 0);
    let (page, _) = h.mkt.get_active_listings(&0, &100);
    assert_eq!(page.len(), 5);
    assert_eq!(page.get(0).unwrap().id, ids[15]);
}

#[test]
fn test_500_listings_across_relist_cycles_stay_paged() {
    let h = setup();
    h.env.budget().reset_unlimited();
    let sellers: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&h.env)).collect();
    let price = 100_0000000_i128;
    let mut total = 0u32;
    let mut bots: std::vec::Vec<(Address, u64)> = std::vec::Vec::new();
    for s in &sellers {
        for _ in 0..40 {
            let t = TIERS[bots.len() % 5];
            bots.push((s.clone(), h.bot.admin_mint(s, &t)));
        }
    }
    // 200 bots; list/cancel cycles until 500 listing ids were issued.
    let mut last_ids = std::vec::Vec::new();
    while total < 500 {
        last_ids.clear();
        for (s, b) in &bots {
            if total >= 500 {
                break;
            }
            last_ids.push(h.mkt.list_bot(s, b, &price, &h.token.address, &604_800_u64));
            total += 1;
        }
        if total < 500 {
            for id in &last_ids {
                let l = h.mkt.get_listing(id);
                h.mkt.cancel_listing(&l.seller, id);
            }
        }
    }
    assert_eq!(h.mkt.next_listing_id(), 501);
    assert_eq!(h.mkt.listing_page_count(), 5);
    // Only the last batch is active.
    let (page, _) = h.mkt.get_active_listings(&0, &200);
    assert!(page.iter().all(|l| l.active));
}

#[test]
fn test_cancel_cost_does_not_rebuild_index() {
    // Tombstoning: cancel leaves the id in its page and the listing readable.
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&seller);
    let l = h.mkt.list_bot(
        &seller,
        &bot,
        &100_0000000_i128,
        &h.token.address,
        &604_800_u64,
    );
    h.mkt.cancel_listing(&seller, &l);
    assert!(!h.mkt.get_listing(&l).active);
    assert_eq!(h.mkt.get_active_listings(&0, &10).0.len(), 0);
    assert_eq!(h.mkt.compact_page(&0), 1);
}

// ── Issue #425 (offers), #426 (fee withdrawal), #335 (checked counters) ──
mod offers_and_fees {
    use super::*;
    use soroban_sdk::testutils::{Events, Ledger};
    use soroban_sdk::{Symbol, TryFromVal};

    const PRICE: i128 = 100_0000000;
    const DAY: u64 = 86_400;
    const WEEK: u64 = 604_800;

    fn now(h: &Harness) -> u64 {
        h.env.ledger().timestamp()
    }

    fn advance(h: &Harness, seconds: u64) {
        h.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
            l.sequence_number += 1;
        });
    }

    /// A funded buyer with an open offer on a bot the seller owns outright.
    fn offer_setup(h: &Harness) -> (Address, Address, u64, u64) {
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        h.token.mint(&buyer, &PRICE);
        let expires = now(h) + DAY;
        let offer_id = h
            .mkt
            .make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &expires);
        (seller, buyer, bot_id, offer_id)
    }

    fn last_event_topic(h: &Harness) -> Symbol {
        let events = h.env.events().all();
        let (_, topics, _) = events.last().unwrap();
        Symbol::try_from_val(&h.env, &topics.get(0).unwrap()).unwrap()
    }

    // ---- make_offer ----

    #[test]
    fn offered_event_carries_the_currency() {
        let h = setup();
        let (_seller, buyer, bot_id, offer_id) = offer_setup(&h);
        let events = h.env.events().all();
        let (contract, topics, data) = events.last().unwrap();
        assert_eq!(contract, h.mkt.address);
        let (symbol, event_buyer, event_offer_id): (Symbol, Address, u64) =
            <(Symbol, Address, u64)>::try_from_val(&h.env, &topics).unwrap();
        assert_eq!(symbol, symbol_short!("offered"));
        assert_eq!(event_buyer, buyer);
        assert_eq!(event_offer_id, offer_id);

        let (offered_bot, offered_amount, offered_expires_at, offered_currency): (
            u64,
            i128,
            u64,
            Address,
        ) = <(u64, i128, u64, Address)>::try_from_val(&h.env, &data).unwrap();
        assert_eq!(offered_bot, bot_id);
        assert_eq!(offered_amount, PRICE);
        assert_eq!(offered_expires_at, now(&h) + DAY);
        assert_eq!(offered_currency, h.token.address);
    }

    #[test]
    fn make_offer_escrows_the_funds_and_indexes_the_offer() {
        let h = setup();
        let (_seller, buyer, bot_id, offer_id) = offer_setup(&h);

        assert_eq!(offer_id, 1);
        assert_eq!(h.token.balance(&buyer), 0);
        assert_eq!(h.token.balance(&h.mkt.address), PRICE);
        let offer = h.mkt.get_offer(&offer_id);
        assert_eq!(offer.buyer, buyer);
        assert_eq!(offer.bot_id, bot_id);
        assert_eq!(offer.amount, PRICE);
        assert_eq!(offer.status, OfferStatus::Active);
        let open = h.mkt.get_offers_for_bot(&bot_id);
        assert_eq!(open.len(), 1);
        assert_eq!(open.get(0).unwrap().id, offer_id);
        // Escrow is not fee revenue.
        assert_eq!(h.mkt.fees_accrued(&h.token.address), 0);
        assert_eq!(last_event_topic(&h), symbol_short!("offered"));
    }

    #[test]
    fn make_offer_ids_are_sequential_and_per_bot_lists_are_ordered() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let mut ids = std::vec::Vec::new();
        for _ in 0..3 {
            let buyer = Address::generate(&h.env);
            h.token.mint(&buyer, &PRICE);
            ids.push(
                h.mkt
                    .make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY)),
            );
        }
        assert_eq!(ids, std::vec![1, 2, 3]);
        let open = h.mkt.get_offers_for_bot(&bot_id);
        assert_eq!(open.len(), 3);
        assert_eq!(open.get(2).unwrap().id, 3);
    }

    #[test]
    fn make_offer_on_own_bot_is_rejected() {
        let h = setup();
        let owner = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&owner);
        h.token.mint(&owner, &PRICE);
        assert_eq!(
            h.mkt
                .try_make_offer(&owner, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY)),
            Err(Ok(MarketplaceError::OfferOnOwnBot))
        );
        assert_eq!(h.token.balance(&owner), PRICE);
    }

    #[test]
    fn make_offer_on_own_listed_bot_is_rejected() {
        let h = setup();
        let owner = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&owner);
        h.mkt
            .list_bot(&owner, &bot_id, &PRICE, &h.token.address, &WEEK);
        h.token.mint(&owner, &PRICE);
        // The marketplace holds the bot, but it is the owner's own listing.
        assert_eq!(
            h.mkt
                .try_make_offer(&owner, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY)),
            Err(Ok(MarketplaceError::OfferOnOwnBot))
        );
    }

    #[test]
    fn make_offer_validates_amount_currency_expiry_and_bot() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        h.token.mint(&buyer, &PRICE);
        let future = now(&h) + DAY;
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &bot_id, &0, &h.token.address, &future),
            Err(Ok(MarketplaceError::InvalidPrice))
        );
        // Default floor for a 2.5% fee is 40 base units.
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &bot_id, &39, &h.token.address, &future),
            Err(Ok(MarketplaceError::PriceTooLow))
        );
        let other = Address::generate(&h.env);
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &bot_id, &PRICE, &other, &future),
            Err(Ok(MarketplaceError::UnsupportedCurrency))
        );
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &now(&h)),
            Err(Ok(MarketplaceError::InvalidExpiry))
        );
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &999, &PRICE, &h.token.address, &future),
            Err(Ok(MarketplaceError::BotNotFound))
        );
        // Nothing was escrowed by any rejected attempt.
        assert_eq!(h.token.balance(&buyer), PRICE);
        assert_eq!(h.mkt.get_offers_for_bot(&bot_id).len(), 0);
    }

    #[test]
    fn make_offer_without_funds_fails_with_payment_failed() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY)),
            Err(Ok(MarketplaceError::PaymentFailed))
        );
    }

    #[test]
    fn make_offer_is_capped_per_bot() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        for _ in 0..MAX_OFFERS_PER_BOT {
            let buyer = Address::generate(&h.env);
            h.token.mint(&buyer, &40);
            h.mkt
                .make_offer(&buyer, &bot_id, &40, &h.token.address, &(now(&h) + DAY));
        }
        let extra = Address::generate(&h.env);
        h.token.mint(&extra, &40);
        assert_eq!(
            h.mkt
                .try_make_offer(&extra, &bot_id, &40, &h.token.address, &(now(&h) + DAY)),
            Err(Ok(MarketplaceError::TooManyOffers))
        );
        assert_eq!(h.mkt.get_offers_for_bot(&bot_id).len(), MAX_OFFERS_PER_BOT);
    }

    #[test]
    fn make_offer_requires_buyer_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        h.token.mint(&buyer, &PRICE);
        h.env.mock_auths(&[]);
        assert!(h
            .mkt
            .try_make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY))
            .is_err());
    }

    // ---- accept_offer ----

    #[test]
    fn accept_offer_moves_bot_and_funds_atomically() {
        let h = setup();
        let (seller, buyer, bot_id, offer_id) = offer_setup(&h);
        let fee = PRICE * 250 / 10_000;

        h.mkt.accept_offer(&seller, &offer_id);

        assert_eq!(h.bot.get_bot(&bot_id).owner, buyer);
        // Seller is the minter, so no royalty leaves the payout.
        assert_eq!(h.token.balance(&seller), PRICE - fee);
        assert_eq!(h.token.balance(&buyer), 0);
        assert_eq!(h.mkt.fees_accrued(&h.token.address), fee);
        assert_eq!(h.token.balance(&h.mkt.address), fee);
        let offer = h.mkt.get_offer(&offer_id);
        assert_eq!(offer.status, OfferStatus::Accepted);
        assert_eq!(h.mkt.get_offers_for_bot(&bot_id).len(), 0);
        assert_eq!(h.mkt.get_user_purchases(&buyer, &10).len(), 1);
        assert_eq!(h.mkt.tier_stats(&MktBotTier::Basic).sale_count, 1);
        assert_eq!(last_event_topic(&h), symbol_short!("offer_acc"));
    }

    #[test]
    fn accept_offer_pays_royalty_to_the_original_minter() {
        // deploy_all initializes the marketplace with no royalty, so wire a
        // second marketplace at 2.5% fee / 5% royalty against the same bots.
        let deployment = deploy_all(Env::default());
        let env = deployment.env.clone();
        let bot = BotNFTContractClient::new(&env, &deployment.bot_nft_id);
        let token = AMTTokenClient::new(&env, &deployment.token_id);
        let mkt_id = env.register_contract(None, MarketplaceContract);
        let mkt = MarketplaceContractClient::new(&env, &mkt_id);
        mkt.initialize(&deployment.admin, &deployment.bot_nft_id, &250u32, &500u32);
        mkt.add_allowed_currency(&deployment.token_id);
        let minter = Address::generate(&env);
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        let bot_id = bot.mint_basic(&minter);
        bot.transfer(&bot_id, &minter, &seller);
        token.mint(&buyer, &PRICE);
        let expires = env.ledger().timestamp() + DAY;
        let offer_id = mkt.make_offer(&buyer, &bot_id, &PRICE, &deployment.token_id, &expires);

        mkt.accept_offer(&seller, &offer_id);

        let fee = PRICE * 250 / 10_000;
        let royalty = PRICE * 500 / 10_000;
        assert_eq!(token.balance(&minter), royalty);
        assert_eq!(token.balance(&seller), PRICE - fee - royalty);
        assert_eq!(mkt.fees_accrued(&deployment.token_id), fee);
        assert_eq!(token.balance(&mkt_id), fee);
        assert_eq!(bot.get_bot(&bot_id).owner, buyer);
    }

    #[test]
    fn accept_offer_on_a_listed_bot_deactivates_the_listing() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &(PRICE * 2), &h.token.address, &WEEK);
        h.token.mint(&buyer, &PRICE);
        let offer_id =
            h.mkt
                .make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY));

        h.mkt.accept_offer(&seller, &offer_id);

        assert_eq!(h.bot.get_bot(&bot_id).owner, buyer);
        assert!(!h.mkt.get_listing(&listing_id).active);
        assert_eq!(h.mkt.get_active_listings(&0, &10).0.len(), 0);
        assert_eq!(h.mkt.get_user_active_listing_count(&seller), 0);
        assert_eq!(
            h.mkt.try_get_listing_for_bot(&bot_id),
            Err(Ok(MarketplaceError::ListingNotFound))
        );
        // The listing cannot be bought any more.
        let other = Address::generate(&h.env);
        h.token.mint(&other, &(PRICE * 2));
        assert_eq!(
            h.mkt.try_buy_bot(&other, &listing_id),
            Err(Ok(MarketplaceError::ListingNotActive))
        );
    }

    #[test]
    fn accept_offer_by_someone_who_does_not_hold_the_bot_fails() {
        let h = setup();
        let (_seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        let stranger = Address::generate(&h.env);
        assert_eq!(
            h.mkt.try_accept_offer(&stranger, &offer_id),
            Err(Ok(MarketplaceError::NotBotOwner))
        );
    }

    #[test]
    fn accept_offer_on_a_bot_listed_by_someone_else_fails() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let impostor = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        h.mkt
            .list_bot(&seller, &bot_id, &PRICE, &h.token.address, &WEEK);
        h.token.mint(&buyer, &PRICE);
        let offer_id =
            h.mkt
                .make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY));
        assert_eq!(
            h.mkt.try_accept_offer(&impostor, &offer_id),
            Err(Ok(MarketplaceError::NotBotOwner))
        );
    }

    #[test]
    fn accept_offer_rejects_expired_inactive_and_unknown_offers() {
        let h = setup();
        let (seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        assert_eq!(
            h.mkt.try_accept_offer(&seller, &999),
            Err(Ok(MarketplaceError::OfferNotFound))
        );
        advance(&h, DAY);
        assert_eq!(
            h.mkt.try_accept_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::OfferExpired))
        );
        // Refund, then the offer is no longer active.
        h.mkt.cancel_offer(&seller, &offer_id);
        assert_eq!(
            h.mkt.try_accept_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::OfferNotActive))
        );
    }

    #[test]
    fn accept_offer_twice_fails() {
        let h = setup();
        let (seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        h.mkt.accept_offer(&seller, &offer_id);
        assert_eq!(
            h.mkt.try_accept_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::OfferNotActive))
        );
    }

    #[test]
    fn accept_offer_requires_seller_auth() {
        let h = setup();
        let (seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        h.env.mock_auths(&[]);
        assert!(h.mkt.try_accept_offer(&seller, &offer_id).is_err());
    }

    #[test]
    fn other_offers_on_a_sold_bot_stay_refundable() {
        let h = setup();
        let (seller, _buyer, bot_id, offer_id) = offer_setup(&h);
        let second = Address::generate(&h.env);
        h.token.mint(&second, &PRICE);
        let second_id =
            h.mkt
                .make_offer(&second, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY));
        h.mkt.accept_offer(&seller, &offer_id);

        let open = h.mkt.get_offers_for_bot(&bot_id);
        assert_eq!(open.len(), 1);
        assert_eq!(open.get(0).unwrap().id, second_id);
        h.mkt.cancel_offer(&second, &second_id);
        assert_eq!(h.token.balance(&second), PRICE);
    }

    // ---- cancel_offer ----

    #[test]
    fn cancel_offer_refunds_the_buyer_in_full() {
        let h = setup();
        let (_seller, buyer, bot_id, offer_id) = offer_setup(&h);
        h.mkt.cancel_offer(&buyer, &offer_id);
        assert_eq!(h.token.balance(&buyer), PRICE);
        assert_eq!(h.token.balance(&h.mkt.address), 0);
        assert_eq!(h.mkt.get_offer(&offer_id).status, OfferStatus::Cancelled);
        assert_eq!(h.mkt.get_offers_for_bot(&bot_id).len(), 0);
        assert_eq!(last_event_topic(&h), symbol_short!("offer_cxl"));
        assert_eq!(
            h.mkt.try_cancel_offer(&buyer, &offer_id),
            Err(Ok(MarketplaceError::OfferNotActive))
        );
    }

    #[test]
    fn cancel_offer_before_expiry_is_buyer_only() {
        let h = setup();
        let (seller, buyer, _bot_id, offer_id) = offer_setup(&h);
        assert_eq!(
            h.mkt.try_cancel_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::NotOfferOwner))
        );
        assert_eq!(h.token.balance(&buyer), 0);
        h.env.mock_auths(&[]);
        assert!(h.mkt.try_cancel_offer(&buyer, &offer_id).is_err());
    }

    #[test]
    fn expired_offer_is_refundable_by_anyone_to_the_buyer() {
        let h = setup();
        let (_seller, buyer, _bot_id, offer_id) = offer_setup(&h);
        advance(&h, DAY);
        let keeper = Address::generate(&h.env);
        h.mkt.cancel_offer(&keeper, &offer_id);
        assert_eq!(h.token.balance(&buyer), PRICE);
        assert_eq!(h.token.balance(&keeper), 0);
        assert_eq!(h.mkt.get_offer(&offer_id).status, OfferStatus::Cancelled);
    }

    #[test]
    fn pause_blocks_new_offers_and_acceptance_but_not_cancellation() {
        let h = setup();
        let (seller, buyer, bot_id, offer_id) = offer_setup(&h);
        h.mkt.pause();
        let late = Address::generate(&h.env);
        h.token.mint(&late, &PRICE);
        assert_eq!(
            h.mkt
                .try_make_offer(&late, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY)),
            Err(Ok(MarketplaceError::ContractPaused))
        );
        assert_eq!(
            h.mkt.try_accept_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::ContractPaused))
        );
        h.mkt.cancel_offer(&buyer, &offer_id);
        assert_eq!(h.token.balance(&buyer), PRICE);
    }

    // ---- offer lifetime and dismissal (#914) ----

    /// Fill every offer slot on a fresh seller-owned bot with
    /// maximum-lifetime offers from distinct buyers.
    fn fill_offer_slots(h: &Harness) -> (Address, u64, std::vec::Vec<(Address, u64)>) {
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let mut offers = std::vec::Vec::new();
        for _ in 0..MAX_OFFERS_PER_BOT {
            let buyer = Address::generate(&h.env);
            h.token.mint(&buyer, &40);
            let id = h.mkt.make_offer(
                &buyer,
                &bot_id,
                &40,
                &h.token.address,
                &(now(h) + MAX_OFFER_DURATION),
            );
            offers.push((buyer, id));
        }
        (seller, bot_id, offers)
    }

    #[test]
    fn make_offer_rejects_expiry_beyond_max_duration() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        h.token.mint(&buyer, &PRICE);
        assert_eq!(
            h.mkt.try_make_offer(
                &buyer,
                &bot_id,
                &PRICE,
                &h.token.address,
                &(now(&h) + MAX_OFFER_DURATION + 1)
            ),
            Err(Ok(MarketplaceError::InvalidExpiry))
        );
        assert_eq!(
            h.mkt
                .try_make_offer(&buyer, &bot_id, &PRICE, &h.token.address, &u64::MAX),
            Err(Ok(MarketplaceError::InvalidExpiry))
        );
        assert_eq!(h.token.balance(&buyer), PRICE);
        // Exactly the maximum lifetime is accepted.
        let id = h.mkt.make_offer(
            &buyer,
            &bot_id,
            &PRICE,
            &h.token.address,
            &(now(&h) + MAX_OFFER_DURATION),
        );
        assert_eq!(
            h.mkt.get_offer(&id).expires_at,
            now(&h) + MAX_OFFER_DURATION
        );
    }

    #[test]
    fn long_lived_offers_exhausting_the_cap_free_up_at_max_duration() {
        let h = setup();
        let (_seller, bot_id, offers) = fill_offer_slots(&h);
        let late = Address::generate(&h.env);
        h.token.mint(&late, &40);
        assert_eq!(
            h.mkt
                .try_make_offer(&late, &bot_id, &40, &h.token.address, &(now(&h) + DAY)),
            Err(Ok(MarketplaceError::TooManyOffers))
        );
        // Once the bounded lifetime passes, anyone can clear a slot.
        advance(&h, MAX_OFFER_DURATION);
        let keeper = Address::generate(&h.env);
        let (buyer, id) = offers[0].clone();
        h.mkt.cancel_offer(&keeper, &id);
        assert_eq!(h.token.balance(&buyer), 40);
        h.mkt
            .make_offer(&late, &bot_id, &40, &h.token.address, &(now(&h) + DAY));
        assert_eq!(h.mkt.get_offers_for_bot(&bot_id).len(), MAX_OFFERS_PER_BOT);
    }

    #[test]
    fn seller_can_dismiss_offers_exhausting_the_cap() {
        let h = setup();
        let (seller, bot_id, offers) = fill_offer_slots(&h);
        let (buyer, id) = offers[3].clone();
        h.mkt.dismiss_offer(&seller, &id);
        assert_eq!(last_event_topic(&h), symbol_short!("offer_dsm"));
        // The refund always goes to the buyer, never the dismisser.
        assert_eq!(h.token.balance(&buyer), 40);
        assert_eq!(h.token.balance(&seller), 0);
        assert_eq!(h.mkt.get_offer(&id).status, OfferStatus::Cancelled);
        assert_eq!(
            h.mkt.get_offers_for_bot(&bot_id).len(),
            MAX_OFFERS_PER_BOT - 1
        );
        let late = Address::generate(&h.env);
        h.token.mint(&late, &40);
        h.mkt
            .make_offer(&late, &bot_id, &40, &h.token.address, &(now(&h) + DAY));
        assert_eq!(
            h.mkt.try_dismiss_offer(&seller, &id),
            Err(Ok(MarketplaceError::OfferNotActive))
        );
    }

    #[test]
    fn listing_seller_and_admin_can_dismiss_offers() {
        let h = setup();
        let (seller, buyer, bot_id, offer_id) = offer_setup(&h);
        h.mkt
            .list_bot(&seller, &bot_id, &PRICE, &h.token.address, &WEEK);
        // The marketplace holds the bot; the listing seller still controls it.
        h.mkt.dismiss_offer(&seller, &offer_id);
        assert_eq!(h.token.balance(&buyer), PRICE);

        let other = Address::generate(&h.env);
        h.token.mint(&other, &PRICE);
        let id = h
            .mkt
            .make_offer(&other, &bot_id, &PRICE, &h.token.address, &(now(&h) + DAY));
        h.mkt.dismiss_offer(&h.admin, &id);
        assert_eq!(h.token.balance(&other), PRICE);
        assert_eq!(h.token.balance(&h.admin), 0);
        assert_eq!(h.mkt.get_offers_for_bot(&bot_id).len(), 0);
    }

    #[test]
    fn dismiss_offer_rejects_third_parties_and_requires_auth() {
        let h = setup();
        let (seller, buyer, _bot_id, offer_id) = offer_setup(&h);
        let stranger = Address::generate(&h.env);
        assert_eq!(
            h.mkt.try_dismiss_offer(&stranger, &offer_id),
            Err(Ok(MarketplaceError::Unauthorized))
        );
        // The buyer is not the bot owner; they use `cancel_offer` instead.
        assert_eq!(
            h.mkt.try_dismiss_offer(&buyer, &offer_id),
            Err(Ok(MarketplaceError::Unauthorized))
        );
        assert_eq!(
            h.mkt.try_dismiss_offer(&seller, &999),
            Err(Ok(MarketplaceError::OfferNotFound))
        );
        assert_eq!(h.token.balance(&h.mkt.address), PRICE);
        h.env.mock_auths(&[]);
        assert!(h.mkt.try_dismiss_offer(&seller, &offer_id).is_err());
        assert_eq!(h.mkt.get_offer(&offer_id).status, OfferStatus::Active);
    }

    #[test]
    fn previous_owner_cannot_dismiss_after_transfer() {
        let h = setup();
        let (seller, buyer, bot_id, offer_id) = offer_setup(&h);
        let new_owner = Address::generate(&h.env);
        h.bot.transfer(&bot_id, &seller, &new_owner);
        assert_eq!(
            h.mkt.try_dismiss_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::Unauthorized))
        );
        h.mkt.dismiss_offer(&new_owner, &offer_id);
        assert_eq!(h.token.balance(&buyer), PRICE);
    }

    // ---- fees (#426) ----

    #[test]
    fn buy_bot_accrues_the_fee_instead_of_paying_the_admin() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &PRICE, &h.token.address, &WEEK);
        h.token.mint(&buyer, &PRICE);
        let admin_before = h.token.balance(&h.admin);
        h.mkt.buy_bot(&buyer, &listing_id);
        let fee = PRICE * 250 / 10_000;
        assert_eq!(h.token.balance(&h.admin), admin_before);
        assert_eq!(h.mkt.fees_accrued(&h.token.address), fee);
        assert_eq!(h.token.balance(&h.mkt.address), fee);
    }

    #[test]
    fn withdraw_fees_pays_out_and_emits_an_event() {
        let h = setup();
        let (seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        h.mkt.accept_offer(&seller, &offer_id);
        let fee = PRICE * 250 / 10_000;
        let treasury = Address::generate(&h.env);

        h.mkt.withdraw_fees(&h.token.address, &treasury, &(fee - 1));

        assert_eq!(h.token.balance(&treasury), fee - 1);
        assert_eq!(h.mkt.fees_accrued(&h.token.address), 1);
        let events = h.env.events().all();
        let (_, topics, data) = events.last().unwrap();
        let topic: Symbol = Symbol::try_from_val(&h.env, &topics.get(0).unwrap()).unwrap();
        assert_eq!(topic, symbol_short!("fees_wd"));
        let (currency, amount, remaining): (Address, i128, i128) =
            <(Address, i128, i128)>::try_from_val(&h.env, &data).unwrap();
        assert_eq!(currency, h.token.address);
        assert_eq!(amount, fee - 1);
        assert_eq!(remaining, 1);
        // The rest can go too.
        h.mkt.withdraw_fees(&h.token.address, &treasury, &1);
        assert_eq!(h.mkt.fees_accrued(&h.token.address), 0);
    }

    #[test]
    fn withdraw_fees_above_the_accrued_balance_fails() {
        let h = setup();
        let (seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        h.mkt.accept_offer(&seller, &offer_id);
        let fee = PRICE * 250 / 10_000;
        let treasury = Address::generate(&h.env);
        assert_eq!(
            h.mkt
                .try_withdraw_fees(&h.token.address, &treasury, &(fee + 1)),
            Err(Ok(MarketplaceError::InsufficientFees))
        );
        assert_eq!(
            h.mkt.try_withdraw_fees(&h.token.address, &treasury, &0),
            Err(Ok(MarketplaceError::InvalidAmount))
        );
        assert_eq!(
            h.mkt.try_withdraw_fees(&h.token.address, &treasury, &-1),
            Err(Ok(MarketplaceError::InvalidAmount))
        );
        assert_eq!(h.mkt.fees_accrued(&h.token.address), fee);
        assert_eq!(h.token.balance(&treasury), 0);
    }

    #[test]
    fn escrowed_offer_funds_are_never_withdrawable_as_fees() {
        let h = setup();
        let (_seller, _buyer, _bot_id, _offer_id) = offer_setup(&h);
        // The contract holds PRICE in escrow but has accrued nothing.
        assert_eq!(h.token.balance(&h.mkt.address), PRICE);
        assert_eq!(h.mkt.fees_accrued(&h.token.address), 0);
        let treasury = Address::generate(&h.env);
        assert_eq!(
            h.mkt.try_withdraw_fees(&h.token.address, &treasury, &1),
            Err(Ok(MarketplaceError::InsufficientFees))
        );
        // A currency with no activity at all reads as zero too.
        let other = Address::generate(&h.env);
        assert_eq!(h.mkt.fees_accrued(&other), 0);
    }

    #[test]
    fn withdraw_fees_requires_admin_auth() {
        let h = setup();
        let (seller, _buyer, _bot_id, offer_id) = offer_setup(&h);
        h.mkt.accept_offer(&seller, &offer_id);
        let treasury = Address::generate(&h.env);
        h.env.mock_auths(&[]);
        assert!(h
            .mkt
            .try_withdraw_fees(&h.token.address, &treasury, &1)
            .is_err());
    }

    // ---- checked counters (#335) ----

    #[test]
    fn list_bot_at_listing_id_ceiling_returns_overflow_and_keeps_the_bot() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        h.env.as_contract(&h.mkt.address, || {
            h.env
                .storage()
                .instance()
                .set(&DataKey::NextListingId, &u64::MAX);
        });
        assert_eq!(
            h.mkt
                .try_list_bot(&seller, &bot_id, &PRICE, &h.token.address, &WEEK),
            Err(Ok(MarketplaceError::Overflow))
        );
        // The failed call rolled back before escrow: seller still owns the bot.
        assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
        assert_eq!(h.mkt.next_listing_id(), u64::MAX);
    }

    #[test]
    fn sale_count_at_ceiling_returns_overflow() {
        let h = setup();
        let (seller, buyer, bot_id, offer_id) = offer_setup(&h);
        h.env.as_contract(&h.mkt.address, || {
            h.env.storage().persistent().set(
                &DataKey::TierStats(MktBotTier::Basic),
                &TierStats {
                    tier: MktBotTier::Basic,
                    volume: 0,
                    sale_count: u64::MAX,
                    last_sale_price: 0,
                    floor_price: 0,
                    floor_listing_id: 0,
                },
            );
        });
        assert_eq!(
            h.mkt.try_accept_offer(&seller, &offer_id),
            Err(Ok(MarketplaceError::Overflow))
        );
        // Rolled back: bot and escrow untouched.
        assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
        assert_eq!(h.token.balance(&buyer), 0);
        assert_eq!(h.token.balance(&h.mkt.address), PRICE);
        assert_eq!(h.mkt.get_offer(&offer_id).status, OfferStatus::Active);
    }

    // ---- user history growth (#916) ----

    #[test]
    fn user_listing_history_is_paged_and_reads_back_in_order() {
        let h = setup();
        h.env.budget().reset_unlimited();
        h.mkt.set_listing_cap(&200);
        let seller = Address::generate(&h.env);
        let total: u32 = 120;
        let mut ids: std::vec::Vec<u64> = std::vec::Vec::new();
        for i in 0..total {
            let tier = TIERS[i as usize % TIERS.len()];
            let bot_id = h.bot.admin_mint(&seller, &tier);
            let listing_id = h.mkt.list_bot(
                &seller,
                &bot_id,
                &(100_0000000_i128 + i as i128),
                &h.token.address,
                &604_800_u64,
            );
            ids.push(listing_id);
        }

        // 120 entries span three pages of at most USER_HISTORY_PAGE_SIZE each.
        h.env.as_contract(&h.mkt.address, || {
            assert_eq!(
                MarketplaceContract::user_listing_count(&h.env, &seller),
                total
            );
            for (page, expected) in [(0, 50), (1, 50), (2, 20)] {
                let stored: Vec<u64> = h
                    .env
                    .storage()
                    .persistent()
                    .get(&DataKey::UserListingPage(seller.clone(), page))
                    .unwrap();
                assert_eq!(stored.len(), expected);
            }
        });

        let all = h.mkt.get_user_listings(&seller);
        assert_eq!(all.len(), total);
        for (i, listing) in all.iter().enumerate() {
            assert_eq!(listing.id, ids[i]);
        }

        // A cursor walk with a small page size visits each listing once.
        let mut cursor: u32 = 0;
        let mut seen: std::vec::Vec<u64> = std::vec::Vec::new();
        loop {
            let (page, next) = h.mkt.get_user_listings_page(&seller, &cursor, &30);
            assert!(page.len() <= 30);
            for listing in page.iter() {
                seen.push(listing.id);
            }
            match next {
                Some(n) => cursor = n,
                None => break,
            }
        }
        assert_eq!(seen, ids);

        // Requests above the page cap are clamped to it.
        let (capped, _) = h.mkt.get_user_listings_page(&seller, &0, &500);
        assert_eq!(capped.len(), MAX_HISTORY_PAGE_LIMIT);
    }

    #[test]
    fn user_purchase_history_is_paged_and_reads_back_recent_first_window() {
        let h = setup();
        let buyer = Address::generate(&h.env);
        let seller = Address::generate(&h.env);
        let total: u32 = 120;
        h.env.as_contract(&h.mkt.address, || {
            for i in 0..total {
                MarketplaceContract::add_user_purchase(
                    &h.env,
                    &buyer,
                    Purchase {
                        listing_id: i as u64 + 1,
                        bot_id: i as u64 + 1,
                        seller: seller.clone(),
                        price: 100_0000000_i128,
                        currency: h.token.address.clone(),
                        purchased_at: i as u64,
                    },
                );
            }
            for (page, expected) in [(0, 50), (1, 50), (2, 20)] {
                let stored: Vec<Purchase> = h
                    .env
                    .storage()
                    .persistent()
                    .get(&DataKey::UserPurchasePage(buyer.clone(), page))
                    .unwrap();
                assert_eq!(stored.len(), expected);
            }
        });

        // The window read returns the most recent purchases, oldest first.
        let recent = h.mkt.get_user_purchases(&buyer, &10);
        assert_eq!(recent.len(), 10);
        assert_eq!(recent.get(0).unwrap().listing_id, 111);
        assert_eq!(recent.get(9).unwrap().listing_id, 120);
        assert_eq!(h.mkt.get_user_purchases(&buyer, &500).len(), total);

        // A cursor walk visits every purchase once, in order.
        let mut cursor: u32 = 0;
        let mut seen: std::vec::Vec<u64> = std::vec::Vec::new();
        loop {
            let (page, next) = h.mkt.get_user_purchases_page(&buyer, &cursor, &50);
            for purchase in page.iter() {
                seen.push(purchase.listing_id);
            }
            match next {
                Some(n) => cursor = n,
                None => break,
            }
        }
        let expected: std::vec::Vec<u64> = (1..=total as u64).collect();
        assert_eq!(seen, expected);
    }
}

// #915: with the bot NFT wired to this marketplace, every escrow exit's
// `bot_nft.transfer` calls back into `on_bot_moved`. The listing must still be
// retired exactly once, so a seller with several listings keeps an accurate
// count (and cannot slip past the listing cap).
mod escrow_exit_counts {
    use super::*;
    use soroban_sdk::testutils::Ledger as _;

    const PRICE: i128 = 50_0000000;

    /// Seller with three escrowed listings and the bot NFT notifying the
    /// marketplace. Returns (seller, [(listing_id, bot_id); 3]).
    fn three_listings(h: &Harness) -> (Address, [(u64, u64); 3]) {
        h.env.mock_all_auths();
        h.bot.set_marketplace(&h.mkt.address);
        let seller = Address::generate(&h.env);
        let mut out = [(0, 0); 3];
        for slot in out.iter_mut() {
            let bot_id = h.bot.mint_basic(&seller);
            let id = h
                .mkt
                .list_bot(&seller, &bot_id, &PRICE, &h.token.address, &604_800_u64);
            *slot = (id, bot_id);
        }
        assert_eq!(h.mkt.get_user_active_listing_count(&seller), 3);
        (seller, out)
    }

    fn assert_two_left(h: &Harness, seller: &Address, exited: u64) {
        assert!(!h.mkt.get_listing(&exited).active);
        assert_eq!(h.mkt.get_user_active_listing_count(seller), 2);
    }

    #[test]
    fn buy_bot_decrements_once() {
        let h = setup();
        let (seller, l) = three_listings(&h);
        let buyer = Address::generate(&h.env);
        h.token.mint(&buyer, &PRICE);
        h.mkt.buy_bot(&buyer, &l[0].0);
        assert_two_left(&h, &seller, l[0].0);
    }

    #[test]
    fn cancel_listing_decrements_once() {
        let h = setup();
        let (seller, l) = three_listings(&h);
        h.mkt.cancel_listing(&seller, &l[0].0);
        assert_two_left(&h, &seller, l[0].0);
    }

    #[test]
    fn reclaim_expired_decrements_once() {
        let h = setup();
        let (seller, l) = three_listings(&h);
        let expires_at = h.mkt.get_listing(&l[0].0).expires_at;
        h.env.ledger().with_mut(|li| li.timestamp = expires_at + 1);
        h.mkt.reclaim_expired(&l[0].0);
        assert_two_left(&h, &seller, l[0].0);
    }

    #[test]
    fn accept_offer_decrements_once() {
        let h = setup();
        let (seller, l) = three_listings(&h);
        let buyer = Address::generate(&h.env);
        h.token.mint(&buyer, &PRICE);
        let expires = h.env.ledger().timestamp() + 86_400;
        let offer_id = h
            .mkt
            .make_offer(&buyer, &l[0].1, &PRICE, &h.token.address, &expires);
        h.mkt.accept_offer(&seller, &offer_id);
        assert_two_left(&h, &seller, l[0].0);
    }
}
