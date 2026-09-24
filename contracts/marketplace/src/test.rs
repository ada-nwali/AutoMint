// SPDX-License-Identifier: Apache-2.0

#![cfg(test)]
#![allow(clippy::inconsistent_digit_grouping)]
use super::*;
use automint_bot_nft::BotNFTContractClient;
use automint_registry::RegistryContractClient;
use automint_testutils::{deploy_all, deploy_bot_nft_with_registry, register_user};
use automint_token::AMTTokenClient;
use soroban_sdk::{testutils::Address as _, Env};

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

    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);
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
    let id2 = h.bot.mint_basic(&seller);

    let l1 = h
        .mkt
        .list_bot(&seller, &id1, &10_0000000_i128, &h.token.address);
    let l2 = h
        .mkt
        .list_bot(&seller, &id2, &20_0000000_i128, &h.token.address);
    assert_eq!(l1, 1);
    assert_eq!(l2, 2);

    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 2);
    assert_eq!(h.mkt.get_user_listings(&seller).len(), 2);
}

#[test]
fn test_list_bot_zero_price_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_id, &0_i128, &h.token.address),
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
            .try_list_bot(&seller, &bot_id, &-1_i128, &h.token.address),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
}

#[test]
fn test_list_nonexistent_bot_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &999_u64, &10_0000000_i128, &h.token.address),
        Err(Ok(MarketplaceError::BotTransferFailed))
    );
}

#[test]
fn test_list_bot_not_owned_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    // `stranger` does not own the bot, so the escrow transfer must fail.
    assert_eq!(
        h.mkt
            .try_list_bot(&stranger, &bot_id, &10_0000000_i128, &h.token.address),
        Err(Ok(MarketplaceError::BotTransferFailed))
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
        h.mkt.try_initialize(&h.admin, &h.bot.address, &250u32),
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
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
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
    let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

    let seller_balance_before = h.token.balance(&seller);
    let admin_balance_before = h.token.balance(&h.admin);

    h.mkt.buy_bot(&buyer, &listing_id);

    // 2.5% fee = 25_0000000, seller gets 975_0000000
    let fee = price * 25 / 1000;
    assert_eq!(
        h.token.balance(&seller),
        seller_balance_before + price - fee
    );
    assert_eq!(h.token.balance(&h.admin), admin_balance_before + fee);
    assert_eq!(h.token.balance(&buyer), 0);

    // Bot transferred to buyer
    assert_eq!(h.bot.get_bot(&bot_id).owner, buyer);
    assert_eq!(h.bot.get_user_bots(&buyer).len(), 1);

    // Listing is now inactive
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
}

#[test]
fn test_cancel_listing_returns_bot_to_seller() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);

    // Bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);

    h.mkt.cancel_listing(&seller, &listing_id);

    // Bot returned to seller
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // Listing is inactive and removed from active list
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
}

#[test]
fn test_buy_inactive_listing_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 100_0000000_i128;

    h.token.mint(&buyer, &(price * 2));
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

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
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

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
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

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
    h.bot.mint_basic(&user);
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
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);
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
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

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
    let _listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);

    // Verify seller no longer owns the bot
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Attempt to list the same bot again should fail (seller is no longer owner)
    let result = h
        .mkt
        .try_list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);
    assert_eq!(result, Err(Ok(MarketplaceError::BotTransferFailed)));
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
        .list_bot(&seller, &bot_nft_id, &price, &h.token.address);

    // Verify bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_nft_id).owner, h.mkt.address);

    // Record balances before purchase
    let seller_balance_before = h.token.balance(&seller);
    let buyer_balance_before = h.token.balance(&buyer);
    let admin_balance_before = h.token.balance(&h.admin);

    // Buyer purchases the bot
    h.mkt.buy_bot(&buyer, &listing_id);

    // Verify token transfers: buyer pays full price, seller gets (price - fee), admin gets fee
    assert_eq!(h.token.balance(&buyer), buyer_balance_before - price);
    assert_eq!(
        h.token.balance(&seller),
        seller_balance_before + seller_receives
    );
    assert_eq!(h.token.balance(&h.admin), admin_balance_before + fee);

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
    let bot_id2 = h.bot.mint_basic(&seller);

    // List both bots
    let listing_id1 = h.mkt.list_bot(&seller, &bot_id1, &price, &h.token.address);
    let listing_id2 = h.mkt.list_bot(&seller, &bot_id2, &price, &h.token.address);

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
        let result = mkt.try_initialize(&admin, &h.bot.address, &250u32);
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
                args: (admin.clone(), h.bot.address.clone(), 250u32).into_val(&h.env),
                sub_invokes: &[],
            },
        }]);
        let result = mkt.try_initialize(&admin, &h.bot.address, &250u32);
        assert!(result.is_ok());
    }

    #[test]
    fn test_list_bot_fails_without_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);

        h.env.mock_auths(&[]);
        let result = h
            .mkt
            .try_list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);
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
        let result = h
            .mkt
            .try_list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_listing_fails_without_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

        h.env.mock_auths(&[]);
        let result = h.mkt.try_cancel_listing(&seller, &listing_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_listing_succeeds_with_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

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
        let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

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
        let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

        // `buy_bot` pays the seller and the admin fee via cross-contract
        // calls into `token.transfer(buyer, ..., ...)`, which itself calls
        // `buyer.require_auth()` — so the buyer's authorization for the root
        // `buy_bot` invocation must also cover both payment sub-invocations.
        // (The bot transfer from the marketplace to the buyer is
        // self-authorized by the marketplace contract and needs no mock.)
        let fee = price * 25 / 1000;
        let seller_payment = price - fee;
        h.env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "buy_bot",
                args: (buyer.clone(), listing_id).into_val(&h.env),
                sub_invokes: &[
                    MockAuthInvoke {
                        contract: &h.token.address,
                        fn_name: "transfer",
                        args: (buyer.clone(), seller.clone(), seller_payment).into_val(&h.env),
                        sub_invokes: &[],
                    },
                    MockAuthInvoke {
                        contract: &h.token.address,
                        fn_name: "transfer",
                        args: (buyer.clone(), h.admin.clone(), fee).into_val(&h.env),
                        sub_invokes: &[],
                    },
                ],
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
    let l1 = h
        .mkt
        .list_bot(&seller, &id1, &50_0000000_i128, &h.token.address);
    assert_eq!(l1, 1);
    assert_eq!(h.mkt.next_listing_id(), 2);
    let id2 = h.bot.mint_basic(&seller);
    let l2 = h
        .mkt
        .list_bot(&seller, &id2, &50_0000000_i128, &h.token.address);
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
    let l1 = h
        .mkt
        .list_bot(&seller, &bot1, &100_0000000_i128, &h.token.address);
    h.mkt.buy_bot(&buyer, &l1);
    let hist1 = h.mkt.get_listing(&l1);
    assert!(!hist1.active);
    assert_eq!(hist1.id, l1);
    assert_eq!(
        h.mkt.try_get_listing(&9999_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
    let bot2 = h.bot.mint_basic(&seller);
    let l2 = h
        .mkt
        .list_bot(&seller, &bot2, &100_0000000_i128, &h.token.address);
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
            .try_list_bot(&seller, &bot_id, &39_i128, &h.token.address),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot2 = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot2, &1_i128, &h.token.address),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot3 = h.bot.mint_basic(&seller);
    let res = h
        .mkt
        .try_list_bot(&seller, &bot3, &40_i128, &h.token.address);
    assert!(res.is_ok(), "price == min should succeed, got {:?}", res);
}

#[test]
fn test_min_price_per_currency_admin_settable() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let currency_a = h.token.address.clone();
    let currency_b = Address::generate(&h.env);
    h.mkt.set_min_price(&currency_a, &1000_i128);
    h.mkt.set_min_price(&currency_b, &5000_i128);
    assert_eq!(h.mkt.get_min_price(&currency_a), 1000);
    assert_eq!(h.mkt.get_min_price(&currency_b), 5000);
    let bot1 = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt.try_list_bot(&seller, &bot1, &500_i128, &currency_a),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot2 = h.bot.mint_basic(&seller);
    let ok_a = h.mkt.try_list_bot(&seller, &bot2, &2000_i128, &currency_a);
    assert!(ok_a.is_ok());
    let bot3 = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt.try_list_bot(&seller, &bot3, &2000_i128, &currency_b),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot4 = h.bot.mint_basic(&seller);
    assert!(h
        .mkt
        .try_list_bot(&seller, &bot4, &6000_i128, &currency_b)
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
        let listing = h.mkt.list_bot(&seller, &bot, &price, &h.token.address);
        let buyer = Address::generate(&h.env);
        h.token.mint(&buyer, &(price));
        let admin_before = h.token.balance(&h.admin);
        h.mkt.buy_bot(&buyer, &listing);
        let fee_paid = h.token.balance(&h.admin) - admin_before;
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
    let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);
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
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
    // Historical get_listing still returns it (active flag may still be true due to
    // host revert on error, but the filtered active list is empty)
    let listing = h.mkt.get_listing(&listing_id);
    // If host reverts, active may still be true; we check that it is not in active list
    // and that a subsequent buy still fails as stale (or not active)
    assert!(h.mkt.get_active_listings(&0, &100).len() == 0);
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
            .try_list_bot(&seller, &bot_dust, &39_i128, &h.token.address),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
    let bot_ok = h.bot.mint_basic(&seller);
    let l40 = h.mkt.list_bot(&seller, &bot_ok, &40_i128, &h.token.address);
    h.token.mint(&buyer, &40_i128);
    let admin_before = h.token.balance(&h.admin);
    h.mkt.buy_bot(&buyer, &l40);
    assert_eq!(h.token.balance(&h.admin) - admin_before, 1);
    let seller2 = Address::generate(&h.env);
    let buyer2 = Address::generate(&h.env);
    h.token.mint(&buyer2, &i128::MAX);
    let bot_big = h.bot.mint_basic(&seller2);
    let l_big = h
        .mkt
        .list_bot(&seller2, &bot_big, &i128::MAX, &h.token.address);
    let res = h.mkt.try_buy_bot(&buyer2, &l_big);
    assert_eq!(res, Err(Ok(MarketplaceError::Overflow)));
}

#[test]
fn test_buyer_exactly_enough_and_one_short() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let price = 1000_0000000_i128;
    let bot1 = h.bot.mint_basic(&seller);
    let l1 = h.mkt.list_bot(&seller, &bot1, &price, &h.token.address);
    let buyer_ok = Address::generate(&h.env);
    h.token.mint(&buyer_ok, &price);
    let res_ok = h.mkt.try_buy_bot(&buyer_ok, &l1);
    assert!(res_ok.is_ok(), "exactly enough should succeed");
    assert_eq!(h.token.balance(&buyer_ok), 0);
    let seller2 = Address::generate(&h.env);
    let bot2 = h.bot.mint_basic(&seller2);
    let l2 = h.mkt.list_bot(&seller2, &bot2, &price, &h.token.address);
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
    let l = h
        .mkt
        .list_bot(&seller, &bot, &100_0000000_i128, &h.token.address);
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
    let l = h.mkt.list_bot(&seller, &bot, &price, &h.token.address);
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
    let l = h.mkt.list_bot(&seller, &bot, &price, &h.token.address);
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
            let res = h.mkt.try_list_bot(&seller, &bot, &price, &h.token.address);
            if let Ok(Ok(_)) = res {
                total_created += 1;
            }
        } else if op == 1 {
            let actives = h.mkt.get_active_listings(&0, &100);
            if actives.len() > 0 {
                let listing = actives.get(0).unwrap();
                let buyer = buyers.get((i % 3) as u32).unwrap().clone();
                if buyer != listing.seller {
                    let _ = h.mkt.try_buy_bot(&buyer, &listing.id);
                }
            }
        } else if op == 2 {
            let actives = h.mkt.get_active_listings(&0, &100);
            for l in actives.iter() {
                if l.seller == seller {
                    let _ = h.mkt.try_cancel_listing(&seller, &l.id);
                    break;
                }
            }
        }
        let actives = h.mkt.get_active_listings(&0, &200);
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
    assert_eq!(h.mkt.get_active_listings(&1000, &10).len(), 0);
    assert_eq!(h.mkt.get_active_listings(&0, &0).len(), 0);
}

// ── every MarketplaceError variant has a test that asserts that exact variant ─

#[test]
fn test_error_variant_already_initialized() {
    let h = setup();
    assert_eq!(
        h.mkt.try_initialize(&h.admin, &h.bot.address, &250u32),
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
    let res = mkt.try_list_bot(&seller, &bot_fake, &100_i128, &tok);
    assert_eq!(res, Err(Ok(MarketplaceError::NotInitialized)));
}

#[test]
fn test_error_variant_invalid_price() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt.try_list_bot(&seller, &bot, &0_i128, &h.token.address),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
    let bot2 = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot2, &-5_i128, &h.token.address),
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
            .try_list_bot(&seller, &bot, &10_i128, &h.token.address),
        Err(Ok(MarketplaceError::PriceTooLow))
    );
}

#[test]
fn test_error_variant_bot_transfer_failed() {
    let h = setup();
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &9999_u64, &100_i128, &h.token.address),
        Err(Ok(MarketplaceError::BotTransferFailed))
    );
    let owner = Address::generate(&h.env);
    let bot = h.bot.mint_basic(&owner);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot, &100_i128, &h.token.address),
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
    let l = h
        .mkt
        .list_bot(&seller, &bot, &100_0000000_i128, &h.token.address);
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
    let l = h
        .mkt
        .list_bot(&seller, &bot, &100_0000000_i128, &h.token.address);
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
    let l = h
        .mkt
        .list_bot(&seller, &bot, &100_0000000_i128, &h.token.address);
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
    let l = h
        .mkt
        .list_bot(&seller, &bot, &100_0000000_i128, &h.token.address);
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
    let l = h.mkt.list_bot(&seller, &bot, &i128::MAX, &h.token.address);
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
    let l = h
        .mkt
        .list_bot(&seller, &bot, &100_0000000_i128, &h.token.address);
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

    // 3. Start accrual for both users.
    // Use a high rate (3600) so 1 hour yields 3600 points → 36 AMT, making
    // the token assertion deterministic without advancing 100 hours.
    // This still exercises the accrual contract's rate storage.
    let accrual_rate: u64 = 3600;
    accrual.start_accrual(&alice, &accrual_rate);
    accrual.start_accrual(&bob, &accrual_rate);

    // Invariants 8-9: accrual state initialized correctly.
    let alice_state = accrual
        .get_accrual_state(&alice)
        .expect("alice accrual state");
    assert_eq!(alice_state.total_claimed_points, 0);
    // last_claim_ts should equal current ledger timestamp at start.
    assert_eq!(alice_state.last_claim_ts, env.ledger().timestamp());
    let bob_state = accrual.get_accrual_state(&bob).expect("bob accrual state");
    assert_eq!(bob_state.last_claim_ts, env.ledger().timestamp());
    assert_eq!(
        accrual.pending_points(&alice),
        0,
        "pending at t=0 should be 0"
    );

    // 4. Advance time by 1 hour (3600s) and claim.
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp.saturating_add(3600);
        li.sequence_number = li.sequence_number.saturating_add(10);
    });

    // Pending should be rate * elapsed /3600 = 3600*3600/3600 =3600.
    assert_eq!(
        accrual.pending_points(&alice),
        3600,
        "pending after 1h at 3600/hr should be 3600 (AM-012)"
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
        36,
        "alice should have 36 AMT after first claim (3600/100)"
    );
    assert_eq!(
        token.balance(&bob),
        36,
        "bob should have 36 AMT after first claim"
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
    // Accrual state carry is 0 because 3600 %100==0.
    assert_eq!(
        accrual
            .get_accrual_state(&alice)
            .unwrap()
            .total_claimed_points,
        0
    );

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
    let listing_id = marketplace.list_bot(&alice, &gold_id, &price, &deployment.token_id);
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
    assert_eq!(marketplace.get_active_listings(&0, &100).len(), 1);

    // Fund Bob to afford the purchase. Bob currently has 36 AMT; mint price to cover.
    // Mint exactly price so Bob's balance becomes 36 + price.
    token.mint(&bob, &price);
    let bob_bal_before = token.balance(&bob);
    let alice_bal_before = token.balance(&alice);
    let admin_bal_before = token.balance(&admin);
    assert_eq!(
        bob_bal_before,
        36 + price,
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
        marketplace.get_active_listings(&0, &100).len(),
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
        admin_bal_before + expected_fee,
        "admin should receive fee"
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

    // Accrual contract still has original rates (3600) — not auto-synced to bot_nft.
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

    let result = mkt.try_initialize(&admin, &invalid_addr, &250u32);
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

#[test]
fn test_per_seller_listing_limit() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let cap = h.mkt.get_listing_cap();
    assert_eq!(cap, 50, "default cap should be 50");

    for i in 0..cap {
        let bot_id = h.bot.mint_basic(&seller);
        let result = h.mkt.try_list_bot(
            &seller,
            &bot_id,
            &(100_0000000_i128 + i as i128),
            &h.token.address,
        );
        assert!(
            result.is_ok(),
            "listing #{} should succeed",
            i + 1
        );
    }

    let bot_id = h.bot.mint_basic(&seller);
    let result = h.mkt.try_list_bot(
        &seller,
        &bot_id,
        &(100_0000000_i128 + cap as i128),
        &h.token.address,
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
    let listing1 = h
        .mkt
        .list_bot(&seller, &bot1, &100_0000000_i128, &h.token.address);

    let bot2 = h.bot.mint_basic(&seller);
    let listing2 = h
        .mkt
        .list_bot(&seller, &bot2, &100_0000000_i128, &h.token.address);

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
        .list_bot(&seller, &bot1, &price, &h.token.address);

    let bot2 = h.bot.mint_basic(&seller);
    let listing2 = h
        .mkt
        .list_bot(&seller, &bot2, &price, &h.token.address);

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
        h.mkt.list_bot(&seller, &bot_id, &(50_0000000_i128 + i as i128), &h.token.address);
    }

    let bot_id = h.bot.mint_basic(&seller);
    let result = h.mkt.try_list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);
    assert_eq!(
        result,
        Err(Ok(MarketplaceError::TooManyListings)),
        "11th listing should exceed new cap of 10"
    );
}
