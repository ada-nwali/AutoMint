// SPDX-License-Identifier: Apache-2.0

#![no_std]
//! Marketplace contract for trading NFT bots.
//!
//! ## Listing-ID enumeration — deliberate public design
//!
//! Listing IDs are sequential `u64` values beginning at `1` and incremented via
//! `NextListingId` on every successful `list_bot`. The current value is
//! readable through [`MarketplaceContract::next_listing_id`], so off-chain
//! tooling can discover total volume without scanning.
//!
//! This enumeration is **intentionally public**. Historical `Listing` records
//! remain readable via `get_listing(id)` even after the listing has been
//! bought or cancelled (with `active == false`). `get_active_listings` only
//! returns currently-active entries. Clients that need pagination should use
//! `get_active_listings(cursor, limit)` (listing-id cursor; returns the next cursor) or `next_listing_id()` as a
//! cursor bound rather than brute-force scanning all IDs. This design mirrors
//! AM-016's cursor guidance and is a deliberate transparency choice for a
//! public chain; an alternative (hash of `(seller, bot_id, nonce)`) was
//! considered and rejected because it would hide volume at the cost of UX
//! without adding privacy on-chain.
//!
//! ## Escrowed-bot rate accrual (#443)
//!
//! When a bot is listed, it is transferred to the marketplace contract, which
//! becomes its owner. The marketplace address must be excluded from rate
//! accounting in sync_rate (AM-003) and similar operations to prevent accrual
//! on escrowed bots from accumulating to an address that cannot claim.
//! Rate accrual for escrowed bots is either burned (simple) or credited to the
//! seller for the listing duration (documented economic model).
//!
//! ## Price, currency and fee relationship
//!
//! ```text
//! fee = price * fee_bps / 10_000
//! seller_receives = price - fee
//! ```
//! With a 7-decimal token (AMT) `price = 1` corresponds to `0.0000001` AMT. For
//! `fee_bps = 250` (2.5 %) `fee = 1*250/10_000 = 0` — dust listings would be
//! free to create and trade while generating no platform revenue. To prevent
//! this, every allowed currency has a configurable `min_price`.
//!
//! `min_price(currency)` is the smallest `price` accepted by `list_bot` for
//! that currency. If the admin has not set a custom value via
//! `set_min_price`, the contract derives a **default** that guarantees the fee
//! rounds to at least one base unit:
//!
//! ```text
//! default_min_price = ceil(10_000 / fee_bps)   if fee_bps > 0
//!                   = 1                        if fee_bps == 0
//! ```
//! For `fee_bps = 250`, `default_min_price = ceil(10_000/250) = 40`; any
//! accepted price therefore satisfies `price * fee_bps / 10_000 >= 1`.
//!
//! Changing `fee_bps` via `set_fee_bps` automatically changes the *default* for
//! currencies without an explicit override; currencies with an explicit
//! `min_price` remain unchanged and must be updated by the admin if the new
//! fee schedule requires a different floor. `set_min_price` exists for that
//! purpose and is `admin`-only.
//!
//! `list_bot` returns `PriceTooLow` when `price < min_price(currency)`.
//!
//! ## Per-seller listing limits (#438)
//!
//! Each seller may maintain up to a configurable number of active listings
//! (default: 50). This cap prevents one attacker from flooding the marketplace
//! with thousands of dust listings. The limit applies only to *active* listings;
//! cancelled or completed listings do not count.
//!
//! `list_bot` returns `TooManyListings` when `seller`'s active listing count
//! reaches the cap. Cancelling or selling a listing frees a slot.
//!
//! The cap is readable via `get_listing_cap()` and adjustable by admin via
//! `set_listing_cap(new_cap)`.
//!
//! ## Bot NFT contract validation (#444)
//!
//! At initialization and on `set_bot_nft`, the marketplace probes the supplied
//! address with a cheap read (checking if it responds to the bot_nft interface)
//! and rejects an unresponsive one with `InvalidBotNft`. This prevents a
//! permanently-broken marketplace caused by a typo in the bot_nft address.
//! The bot_nft address is readable via `bot_nft()` getter.
//!
//! ## Check ordering in mutating functions (#433)
//!
//! `buy_bot`, `cancel_listing` and `update_price` validate in one fixed order:
//! existence -> authorization -> state validity -> effects. A caller who is not
//! authorized for a listing therefore always gets `Unauthorized`/`SelfPurchase`
//! whatever the listing's state, so probing listing IDs does not reveal which
//! are active.
//!
//! ## Pause and admin transfer (#434)
//!
//! While paused, `list_bot`, `buy_bot` and `update_price` fail with
//! `ContractPaused`. `cancel_listing` deliberately keeps working so sellers can
//! always retrieve their escrowed bots. Admin rotation is two-step:
//! `propose_admin(new_admin)` then `accept_admin()` signed by the new admin.
//!
//! ## Sales statistics (#432)
//!
//! `tier_stats(tier)` and `market_stats()` expose, per bot tier, cumulative
//! volume, sale count, last sale price and the floor (lowest active listing
//! price, `0` when none). Volume and prices are raw base units summed across
//! whatever currencies were used. Each list, sale, cancel or price change
//! updates one tier's record in O(1); the floor is rescanned only when the
//! listing that held it leaves the market or is repriced upward.
//!
//! ## Events
//!
//! The marketplace emits the following events for auditing:
//! - `initialized`: Emitted when contract initializes.
//!   Topics: ("initialized",), Data: (admin, bot_nft, fee_bps)
//! - `listed`: Emitted when a bot is listed for sale.
//!   Topics: ("listed", seller, listing_id), Data: (bot_id, price)
//! - `sold`: Emitted when a bot is purchased.
//!   Topics: ("sold", seller, buyer), Data: (listing_id, bot_id, price)
//! - `cancel`: Emitted when a listing is cancelled.
//!   Topics: ("cancel", seller, listing_id), Data: (bot_id,)
//! - `fee_bps_updated`: Emitted when fee basis points change.
//!   Topics: ("fee_bps_updated",), Data: (old_fee_bps, new_fee_bps)
//! - `min_price_updated`: Emitted when min_price for a currency changes.
//!   Topics: ("min_price_updated", currency), Data: (old_min, new_min)
//! - `bot_nft_updated`: Emitted when bot NFT address changes.
//!   Topics: ("bot_nft_updated",), Data: (old_nft, new_nft)
//! - `admin_updated`: Emitted when admin changes.
//!   Topics: ("admin_updated",), Data: (old_admin, new_admin)
//! - `admin_proposed`: Emitted when an admin transfer is proposed.
//!   Topics: ("admin_proposed",), Data: (current_admin, pending_admin)
//! - `paused` / `unpaused`: Emitted when the admin pauses or resumes trading.
//! - `price_upd`: Emitted when a listing price changes.
//!   Topics: ("price_upd", seller, listing_id), Data: (old_price, new_price)

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
    Vec,
};

use automint_bot_nft::{BotNFTContractClient, BotTier};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Listing(u64),
    /// Paged listing-ID index: page `n` holds at most `LISTING_PAGE_SIZE` ids
    /// in ascending order (persistent storage).
    ListingPage(u32),
    /// Number of listing pages allocated (instance storage, a single u32).
    PageCount,
    UserListings(Address),
    UserPurchases(Address),
    NextListingId,
    Config,
    Initialized,
    MinPrice(Address),
    UserActiveListingCount(Address),
    ListingCap,
    Paused,
    PendingAdmin,
    TierStats(BotTier),
    BotListing(u64),
    Locked,  // #326: Reentrancy guard
    AllowedCurrencies,  // #325: Currency allowlist
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Listing {
    pub id: u64,
    pub seller: Address,
    pub bot_id: u64,
    pub bot_tier: BotTier,
    pub price: i128,
    pub currency: Address,
    pub listed_at: u64,
    pub active: bool,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Purchase {
    pub listing_id: u64,
    pub bot_id: u64,
    pub seller: Address,
    pub price: i128,
    pub currency: Address,
    pub purchased_at: u64,
}

/// Sales statistics for one bot tier (#432).
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct TierStats {
    pub tier: BotTier,
    /// Cumulative sale volume in raw base units.
    pub volume: i128,
    pub sale_count: u64,
    pub last_sale_price: i128,
    /// Lowest active listing price for this tier; `0` when nothing is listed.
    pub floor_price: i128,
    /// Listing holding the floor; `0` when nothing is listed.
    pub floor_listing_id: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub bot_nft: Address,
    pub fee_bps: u32,
    pub royalty_bps: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum MarketplaceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidPrice = 3,
    BotTransferFailed = 4,
    ListingNotFound = 5,
    NotSeller = 6,
    ListingInactive = 7,
    InsufficientFunds = 8,
    ListingNotActive = 9,
    Unauthorized = 10,
    PaymentFailed = 11,
    Overflow = 12,
    PriceTooLow = 13,
    ListingStale = 14,
    SelfPurchase = 15,
    TooManyListings = 16,
    InvalidBotNft = 17,
    ContractPaused = 18,
    NoPendingAdmin = 19,
    BotNotFound = 20,
    NotBotOwner = 21,
    Reentrancy = 22,  // #326: Reentrancy guard
    UnsupportedCurrency = 23,  // #325: Currency allowlist
}

/// Every bot tier, in order, for per-tier reporting.
const ALL_TIERS: [BotTier; 5] = [
    BotTier::Basic,
    BotTier::Bronze,
    BotTier::Silver,
    BotTier::Gold,
    BotTier::Diamond,
];

/// Maximum listing ids per `ListingPage` bucket (#333).
const LISTING_PAGE_SIZE: u32 = 100;
/// Maximum index entries examined by one `get_listings_filtered` call.
const MAX_FILTER_SCAN: u32 = 200;
const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    /// Set the admin and bot_nft addresses. Fails with `AlreadyInitialized` if
    /// called twice. Validates bot_nft contract responds to admin() call.
    pub fn initialize(
        env: Env,
        admin: Address,
        bot_nft: Address,
        fee_bps: u32,
        royalty_bps: u32,
    ) -> Result<(), MarketplaceError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(MarketplaceError::AlreadyInitialized);
        }
        admin.require_auth();

        Self::probe_bot_nft(&env, &bot_nft)?;

        if (fee_bps as u64) + (royalty_bps as u64) > 10_000 {
            return Err(MarketplaceError::InvalidPrice);
        }

        let config = Config {
            admin: admin.clone(),
            bot_nft: bot_nft.clone(),
            fee_bps,
            royalty_bps,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::NextListingId, &1u64);
        env.storage().instance().set(&DataKey::PageCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::ListingCap, &50u32);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "initialized"),),
            (admin, bot_nft, fee_bps),
        );
        Ok(())
    }

    /// Return the next listing ID that will be assigned (i.e. `NextListingId`).
    /// This is the public enumeration cursor — tooling should use it instead of
    /// scanning `get_listing` over an unbounded range. The value is `1` before
    /// any listing has been created.
    pub fn next_listing_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextListingId)
            .unwrap_or(1)
    }

    /// Return the configured minimum price for `currency`. If the admin has not
    /// set an explicit floor, the default `ceil(10_000/fee_bps)` (or `1` when
    /// `fee_bps == 0`) is returned. Every accepted price guarantees
    /// `price * fee_bps / 10_000 >= 1` when `fee_bps > 0`.
    pub fn get_min_price(env: Env, currency: Address) -> i128 {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("Marketplace not initialized");
        Self::min_price_for_currency(&env, &currency, config.fee_bps)
    }

    /// Admin-only: set the minimum price for `currency`. `min_price` must be
    /// strictly positive. Emits `min_price_updated`.
    pub fn set_min_price(
        env: Env,
        currency: Address,
        min_price: i128,
    ) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        if min_price <= 0 {
            return Err(MarketplaceError::InvalidPrice);
        }
        let old: Option<i128> = env
            .storage()
            .instance()
            .get(&DataKey::MinPrice(currency.clone()));
        env.storage()
            .instance()
            .set(&DataKey::MinPrice(currency.clone()), &min_price);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "min_price"), currency.clone()),
            (old.unwrap_or(0), min_price),
        );
        Ok(())
    }

    /// Escrow `bot_id` from `seller` into the marketplace contract, record a
    /// `Listing` at `price` in `currency`, and return the new listing ID.
    pub fn list_bot(
        env: Env,
        seller: Address,
        bot_id: u64,
        price: i128,
        currency: Address,
    ) -> Result<u64, MarketplaceError> {
        Self::check_and_set_lock(&env)?;

        seller.require_auth();
        if let Err(e) = Self::require_not_paused(&env) {
            Self::clear_lock(&env);
            return Err(e);
        }

        // A listing must have a strictly positive price.
        if price <= 0 {
            Self::clear_lock(&env);
            return Err(MarketplaceError::InvalidPrice);
        }

        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(c) => c,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::NotInitialized);
            }
        };

        let listing_cap: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ListingCap)
            .unwrap_or(50);

        let user_count: u32 = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::UserActiveListingCount(seller.clone()))
            .unwrap_or(0);

        if user_count >= listing_cap {
            Self::clear_lock(&env);
            return Err(MarketplaceError::TooManyListings);
        }

        // #325: Check if currency is allowlisted
        if !Self::is_currency_allowed(&env, &currency) {
            Self::clear_lock(&env);
            return Err(MarketplaceError::UnsupportedCurrency);
        }

        // Enforce per-currency floor: price must be >= min_price(currency).
        // The default guarantees fee >= 1 base unit when fee_bps > 0.
        let min_price = Self::min_price_for_currency(&env, &currency, config.fee_bps);
        if price < min_price {
            Self::clear_lock(&env);
            return Err(MarketplaceError::PriceTooLow);
        }

        // Fetch the bot from the NFT contract. A missing bot maps to
        // BotNotFound (no extra cross-contract call is spent), and a bot
        // owned by someone else maps to NotBotOwner — both checked before
        // the escrow transfer, which keeps BotTransferFailed for genuine
        // transfer failures (#427).
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        let bot = match bot_client.try_get_bot(&bot_id) {
            Ok(Ok(b)) => b,
            _ => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::BotNotFound);
            }
        };
        if bot.owner != seller {
            Self::clear_lock(&env);
            return Err(MarketplaceError::NotBotOwner);
        }
        let bot_tier = bot.tier;

        // Escrow the bot into the marketplace. A failure here is a genuine
        // transfer failure, surfaced as BotTransferFailed.
        let marketplace = env.current_contract_address();
        if bot_client
            .try_transfer(&bot_id, &seller, &marketplace)
            .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::BotTransferFailed);
        }

        let listing_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextListingId)
            .unwrap_or(1);

        let listing = Listing {
            id: listing_id,
            seller: seller.clone(),
            bot_id,
            bot_tier,
            price,
            currency: currency.clone(),
            listed_at: env.ledger().timestamp(),
            active: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.storage().persistent().extend_ttl(
            &DataKey::Listing(listing_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        env.storage()
            .persistent()
            .set(&DataKey::BotListing(bot_id), &listing_id);
        env.storage().persistent().extend_ttl(
            &DataKey::BotListing(bot_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        Self::append_listing_id(&env, listing_id);
        Self::on_listing_added(&env, &listing);

        let mut user_listings: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserListings(seller.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        user_listings.push_back(listing_id);
        env.storage()
            .persistent()
            .set(&DataKey::UserListings(seller.clone()), &user_listings);

        let updated_count = user_count + 1;
        env.storage()
            .persistent()
            .set(&DataKey::UserActiveListingCount(seller.clone()), &updated_count);
        env.storage().persistent().extend_ttl(
            &DataKey::UserActiveListingCount(seller.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        env.storage()
            .instance()
            .set(&DataKey::NextListingId, &(listing_id + 1));
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("listed"), seller, listing_id),
            (bot_id, price),
        );
        Self::clear_lock(&env);
        Ok(listing_id)
    }

    pub fn buy_bot(env: Env, buyer: Address, listing_id: u64) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;

        buyer.require_auth();
        if let Err(e) = Self::require_not_paused(&env) {
            Self::clear_lock(&env);
            return Err(e);
        }
        // Order: existence -> authorization -> state validity -> effects.
        let mut listing: Listing = match env.storage().persistent().get(&DataKey::Listing(listing_id)) {
            Some(l) => l,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::ListingNotFound);
            }
        };
        if listing.seller == buyer {
            Self::clear_lock(&env);
            return Err(MarketplaceError::SelfPurchase);
        }
        if !listing.active {
            Self::clear_lock(&env);
            return Err(MarketplaceError::ListingNotActive);
        }
        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(c) => c,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::NotInitialized);
            }
        };

        // #325: Check if the currency is still allowlisted
        if !Self::is_currency_allowed(&env, &listing.currency) {
            Self::clear_lock(&env);
            return Err(MarketplaceError::UnsupportedCurrency);
        }

        // Verify the marketplace still owns the escrowed bot before moving any
        // funds. If the bot is missing or has been reassigned (admin action,
        // bug, future non-custodial path) we mark the listing stale, remove it
        // from the active index, and return `ListingStale` *before* the payment
        // leg so the buyer's balance is untouched.
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        let bot = match bot_client.try_get_bot(&listing.bot_id) {
            Ok(Ok(b)) => b,
            _ => {
                listing.active = false;
                env.storage()
                    .persistent()
                    .set(&DataKey::Listing(listing_id), &listing);
                Self::on_listing_removed(&env, &listing);
                Self::clear_lock(&env);
                return Err(MarketplaceError::ListingStale);
            }
        };
        if bot.owner != env.current_contract_address() {
            listing.active = false;
            env.storage()
                .persistent()
                .set(&DataKey::Listing(listing_id), &listing);
            Self::on_listing_removed(&env, &listing);
            Self::clear_lock(&env);
            return Err(MarketplaceError::ListingStale);
        }

        let platform_fee = match listing.price.checked_mul(config.fee_bps as i128) {
            Some(p) => match p.checked_div(10_000) {
                Some(f) => f,
                None => {
                    Self::clear_lock(&env);
                    return Err(MarketplaceError::Overflow);
                }
            },
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::Overflow);
            }
        };

        let royalty = match listing.price.checked_mul(config.royalty_bps as i128) {
            Some(p) => match p.checked_div(10_000) {
                Some(r) => r,
                None => {
                    Self::clear_lock(&env);
                    return Err(MarketplaceError::Overflow);
                }
            },
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::Overflow);
            }
        };

        let seller_amount = match listing.price.checked_sub(platform_fee) {
            Some(p) => match p.checked_sub(royalty) {
                Some(a) => a,
                None => {
                    Self::clear_lock(&env);
                    return Err(MarketplaceError::Overflow);
                }
            },
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::Overflow);
            }
        };

        // Transfer the NFT first. If payment later fails the buyer already
        // holds the bot, which is preferable to the reverse (payment moved but
        // bot not received) because payment is reversible via governance.
        let marketplace = env.current_contract_address();
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &buyer)
            .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::BotTransferFailed);
        }

        // Pull the full price into the marketplace first so the buyer's
        // solvency is one atomic check, then pay out every leg from the
        // contract. Every token call is checked: any failure aborts the whole
        // invocation (including the bot transfer above), so a fee can never be
        // silently skipped.
        let token_client = token::Client::new(&env, &listing.currency);
        if token_client
            .try_transfer(&buyer, &marketplace, &listing.price)
            .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::PaymentFailed);
        }

        // The royalty goes to the original minter; when the minter is the
        // seller themself it stays with the seller so no funds are stranded.
        let pay_royalty = royalty > 0 && bot.minter != listing.seller;
        let seller_payout = if royalty > 0 && !pay_royalty {
            match seller_amount.checked_add(royalty) {
                Some(v) => v,
                None => {
                    Self::clear_lock(&env);
                    return Err(MarketplaceError::Overflow);
                }
            }
        } else {
            seller_amount
        };

        if seller_payout > 0
            && token_client
                .try_transfer(&marketplace, &listing.seller, &seller_payout)
                .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::PaymentFailed);
        }
        if platform_fee > 0
            && token_client
                .try_transfer(&marketplace, &config.admin, &platform_fee)
                .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::PaymentFailed);
        }
        if pay_royalty
            && token_client
                .try_transfer(&marketplace, &bot.minter, &royalty)
                .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::PaymentFailed);
        }

        listing.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.storage().persistent().extend_ttl(
            &DataKey::Listing(listing_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage()
            .persistent()
            .remove(&DataKey::BotListing(listing.bot_id));
        if let Err(e) = Self::record_sale(&env, listing.bot_tier, listing.price) {
            Self::clear_lock(&env);
            return Err(e);
        }
        Self::on_listing_removed(&env, &listing);
        Self::decrement_user_active_listing_count(&env, &listing.seller);
        let purchase = Purchase {
            listing_id,
            bot_id: listing.bot_id,
            seller: listing.seller.clone(),
            price: listing.price,
            currency: listing.currency.clone(),
            purchased_at: env.ledger().timestamp(),
        };
        Self::add_user_purchase(&env, &buyer, purchase);
        env.events().publish(
            (symbol_short!("sold"), listing.seller.clone(), buyer.clone()),
            (listing_id, listing.bot_id, listing.price),
        );
        Self::clear_lock(&env);
        Ok(())
    }

    /// Cancel a listing and return the escrowed bot to its seller.
    ///
    /// This is the escape hatch: it is intentionally NOT blocked while the
    /// marketplace is paused, so sellers can always retrieve escrowed bots.
    /// Order: existence -> authorization -> state validity -> effects.
    pub fn cancel_listing(
        env: Env,
        seller: Address,
        listing_id: u64,
    ) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;

        seller.require_auth();

        let mut listing: Listing = match env.storage().persistent().get(&DataKey::Listing(listing_id)) {
            Some(l) => l,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::ListingNotFound);
            }
        };

        if listing.seller != seller {
            Self::clear_lock(&env);
            return Err(MarketplaceError::Unauthorized);
        }

        if !listing.active {
            Self::clear_lock(&env);
            return Err(MarketplaceError::ListingNotActive);
        }

        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(c) => c,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::NotInitialized);
            }
        };

        // Return the escrowed bot from the marketplace back to the seller.
        let marketplace = env.current_contract_address();
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &seller)
            .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::BotTransferFailed);
        }

        // Mark listing inactive and persist.
        listing.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.storage().persistent().extend_ttl(
            &DataKey::Listing(listing_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        env.storage()
            .persistent()
            .remove(&DataKey::BotListing(listing.bot_id));

        // The id stays in its ListingPage as a tombstone (`active == false`);
        // `compact_page` reclaims the slot later.
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::on_listing_removed(&env, &listing);

        Self::decrement_user_active_listing_count(&env, &listing.seller);

        env.events().publish(
            (symbol_short!("cancel"), seller, listing_id),
            listing.bot_id,
        );
        Self::clear_lock(&env);
        Ok(())
    }

    /// Change the price of an active listing. Only the seller may call it, and
    /// the new price must satisfy the same rules as `list_bot`.
    /// Order: existence -> authorization -> state validity -> effects.
    pub fn update_price(
        env: Env,
        seller: Address,
        listing_id: u64,
        new_price: i128,
    ) -> Result<(), MarketplaceError> {
        seller.require_auth();
        Self::require_not_paused(&env)?;

        let mut listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)?;

        if listing.seller != seller {
            return Err(MarketplaceError::Unauthorized);
        }

        if !listing.active {
            return Err(MarketplaceError::ListingNotActive);
        }

        if new_price <= 0 {
            return Err(MarketplaceError::InvalidPrice);
        }
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        let min_price = Self::min_price_for_currency(&env, &listing.currency, config.fee_bps);
        if new_price < min_price {
            return Err(MarketplaceError::PriceTooLow);
        }

        let old_price = listing.price;
        listing.price = new_price;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.storage().persistent().extend_ttl(
            &DataKey::Listing(listing_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Self::on_price_changed(&env, &listing);

        env.events().publish(
            (Symbol::new(&env, "price_upd"), seller, listing_id),
            (old_price, new_price),
        );
        Ok(())
    }

    /// Deactivate any active listing for `bot_id`. Permissioned to `bot_nft` contract.
    pub fn on_bot_moved(env: Env, bot_id: u64) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.bot_nft.require_auth();

        // O(1): the bot -> active listing index replaces a scan of all ids.
        let listing_id: u64 = match env
            .storage()
            .persistent()
            .get(&DataKey::BotListing(bot_id))
        {
            Some(id) => id,
            None => return Ok(()),
        };
        if let Some(mut listing) = env
            .storage()
            .persistent()
            .get::<_, Listing>(&DataKey::Listing(listing_id))
        {
            if listing.bot_id == bot_id && listing.active {
                listing.active = false;
                env.storage()
                    .persistent()
                    .set(&DataKey::Listing(listing_id), &listing);
                env.storage()
                    .persistent()
                    .remove(&DataKey::BotListing(listing.bot_id));
                Self::on_listing_removed(&env, &listing);
                Self::decrement_user_active_listing_count(&env, &listing.seller);
                env.events()
                    .publish((symbol_short!("deactive"), bot_id), listing_id);
            }
        }
        Ok(())
    }

    /// Retrieve a listing by ID. Historical listings (bought/cancelled/stale)
    /// remain readable with `active == false`; only an ID that was never
    /// assigned returns `ListingNotFound`. This is intentional (see module
    /// docs): auditability over hiding.
    pub fn get_listing(env: Env, listing_id: u64) -> Result<Listing, MarketplaceError> {
        env.storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)
    }

    /// Return the active listing ID for a bot, if one exists. Returns
    /// `ListingNotFound` if the bot is not listed or its listing was cancelled/sold.
    pub fn get_listing_for_bot(env: Env, bot_id: u64) -> Result<u64, MarketplaceError> {
        env.storage()
            .persistent()
            .get(&DataKey::BotListing(bot_id))
            .ok_or(MarketplaceError::ListingNotFound)
    }

    /// Return up to `limit` active listings with id greater than `cursor`,
    /// plus the cursor to pass to the next call (#333).
    ///
    /// `cursor` is a listing ID (0 = start), NOT a positional index, so it stays
    /// valid when listings are cancelled, sold or compacted mid-pagination:
    /// every active listing is visited exactly once. The scan examines at most
    /// `limit * 4` index entries per call, so a page may be short when many
    /// tombstones are skipped; keep paging until the returned cursor equals the
    /// one passed in (nothing left to scan).
    ///
    /// - `limit == 0` returns `(empty, cursor)`.
    /// - Inactive listings (tombstones), missing records and listings whose bot
    ///   is no longer escrowed here are skipped.
    pub fn get_active_listings(env: Env, cursor: u64, limit: u32) -> (Vec<Listing>, u64) {
        let mut result: Vec<Listing> = Vec::new(&env);
        if limit == 0 {
            return (result, cursor);
        }
        let ids = Self::ids_after(&env, cursor, limit.saturating_mul(4));
        let marketplace = env.current_contract_address();
        let config: Option<Config> = env.storage().instance().get(&DataKey::Config);
        let mut next = cursor;
        for id in ids.iter() {
            if result.len() >= limit {
                break;
            }
            next = id;
            if let Some(l) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            {
                if l.active {
                    // Skip stale listings where the marketplace no longer owns
                    // the bot (e.g. admin transfer); see module docs.
                    if let Some(cfg) = config.as_ref() {
                        let bot_client = BotNFTContractClient::new(&env, &cfg.bot_nft);
                        match bot_client.try_get_bot(&l.bot_id) {
                            Ok(Ok(bot)) if bot.owner == marketplace => {}
                            _ => continue,
                        }
                    }
                    result.push_back(l);
                }
            }
        }
        (result, next)
    }

    /// Permissionless: drop tombstoned (inactive / missing) ids from `page` so
    /// the slot count reflects live listings. Cursors are id-based so this is
    /// safe at any time. Returns the number of ids removed.
    pub fn compact_page(env: Env, page: u32) -> u32 {
        let key = DataKey::ListingPage(page);
        let ids: Vec<u64> = match env.storage().persistent().get(&key) {
            Some(v) => v,
            None => return 0,
        };
        let mut kept: Vec<u64> = Vec::new(&env);
        for id in ids.iter() {
            let live = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
                .map(|l| l.active)
                .unwrap_or(false);
            if live {
                kept.push_back(id);
            }
        }
        let removed = ids.len() - kept.len();
        if removed > 0 {
            env.storage().persistent().set(&key, &kept);
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        removed
    }

    /// Number of listing pages allocated.
    pub fn listing_page_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::PageCount)
            .unwrap_or(0)
    }

    /// Bounded page of active listings matching optional tier and inclusive
    /// price constraints. `cursor` is a listing ID (0 = start), as in
    /// `get_active_listings`; at most `MAX_FILTER_SCAN` index entries are
    /// examined and at most 50 listings returned. Returns the next cursor;
    /// stop when it equals the cursor passed in.
    pub fn get_listings_filtered(
        env: Env,
        tier: Option<BotTier>,
        min_price: Option<i128>,
        max_price: Option<i128>,
        cursor: u64,
        limit: u32,
    ) -> (Vec<Listing>, u64) {
        let mut result: Vec<Listing> = Vec::new(&env);
        let bounded_limit = limit.min(50);
        if bounded_limit == 0 {
            return (result, cursor);
        }

        let ids = Self::ids_after(&env, cursor, MAX_FILTER_SCAN);
        let marketplace = env.current_contract_address();
        let config: Option<Config> = env.storage().instance().get(&DataKey::Config);
        let mut next = cursor;

        for id in ids.iter() {
            if result.len() >= bounded_limit {
                break;
            }
            next = id;
            let Some(listing) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            else {
                continue;
            };
            if !listing.active {
                continue;
            }
            if let Some(expected_tier) = tier {
                if listing.bot_tier != expected_tier {
                    continue;
                }
            }
            if let Some(minimum) = min_price {
                if listing.price < minimum {
                    continue;
                }
            }
            if let Some(maximum) = max_price {
                if listing.price > maximum {
                    continue;
                }
            }
            if let Some(cfg) = config.as_ref() {
                let bot_client = BotNFTContractClient::new(&env, &cfg.bot_nft);
                match bot_client.try_get_bot(&listing.bot_id) {
                    Ok(Ok(bot)) if bot.owner == marketplace => {}
                    _ => continue,
                }
            }
            result.push_back(listing);
        }
        (result, next)
    }
    pub fn get_user_listings(env: Env, seller: Address) -> Vec<Listing> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserListings(seller))
            .unwrap_or_else(|| Vec::new(&env));
        let mut result: Vec<Listing> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(l) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            {
                result.push_back(l);
            }
        }
        result
    }

    pub fn get_user_purchases(env: Env, buyer: Address, limit: u32) -> Vec<Purchase> {
        let purchases: Vec<Purchase> = env
            .storage()
            .persistent()
            .get::<_, Vec<Purchase>>(&DataKey::UserPurchases(buyer))
            .unwrap_or_else(|| Vec::new(&env));
        let mut result: Vec<Purchase> = Vec::new(&env);
        let start = if purchases.len() > limit {
            purchases.len() - limit
        } else {
            0
        };
        for i in start..purchases.len() {
            result.push_back(purchases.get(i).unwrap().clone());
        }
        result
    }

    pub fn config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn set_fee_bps(env: Env, new_fee_bps: u32) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        let old_fee_bps = config.fee_bps;
        config.fee_bps = new_fee_bps;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "fee_bps_upd"),),
            (old_fee_bps, new_fee_bps),
        );
        Ok(())
    }

    pub fn set_bot_nft(env: Env, new_bot_nft: Address) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();

        Self::probe_bot_nft(&env, &new_bot_nft)?;

        let old_nft = config.bot_nft.clone();
        config.bot_nft = new_bot_nft;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "bot_nft_upd"),),
            (old_nft, config.bot_nft.clone()),
        );
        Ok(())
    }

    /// Step one of an admin transfer: the current admin nominates `new_admin`.
    /// Nothing changes until `new_admin` calls `accept_admin`; proposing again
    /// replaces the pending nomination.
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "admin_proposed"),),
            (config.admin, new_admin),
        );
        Ok(())
    }

    /// Step two of an admin transfer: the nominated address accepts and becomes
    /// admin. Fails with `NoPendingAdmin` if nobody was proposed.
    pub fn accept_admin(env: Env) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(MarketplaceError::NoPendingAdmin)?;
        pending.require_auth();
        let old_admin = config.admin.clone();
        config.admin = pending;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "admin_upd"),),
            (old_admin, config.admin.clone()),
        );
        Ok(())
    }

    /// The address nominated by `propose_admin`, if a transfer is pending.
    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Admin-only: block `list_bot`, `buy_bot` and `update_price`.
    /// `cancel_listing` keeps working so sellers can always retrieve bots.
    pub fn pause(env: Env) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish((symbol_short!("paused"),), config.admin);
        Ok(())
    }

    /// Admin-only: resume trading after `pause`.
    pub fn unpause(env: Env) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events()
            .publish((Symbol::new(&env, "unpaused"),), config.admin);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Admin-only: add a currency to the allowlist (#325)
    pub fn add_allowed_currency(env: Env, currency: Address) -> Result<(), MarketplaceError> {
        Self::add_currency(&env, currency)
    }

    /// Admin-only: remove a currency from the allowlist (#325)
    pub fn remove_allowed_currency(env: Env, currency: Address) -> Result<(), MarketplaceError> {
        Self::remove_currency(&env, currency)
    }

    /// Check if a currency is in the allowlist (#325)
    pub fn is_allowed_currency(env: Env, currency: Address) -> bool {
        Self::is_currency_allowed(&env, &currency)
    }

    /// Sales statistics for one tier (all zeros before any activity).
    pub fn tier_stats(env: Env, tier: BotTier) -> TierStats {
        Self::read_tier_stats(&env, tier)
    }

    /// Sales statistics for every tier, in tier order (Basic .. Diamond).
    pub fn market_stats(env: Env) -> Vec<TierStats> {
        let mut result: Vec<TierStats> = Vec::new(&env);
        for tier in ALL_TIERS {
            result.push_back(Self::read_tier_stats(&env, tier));
        }
        result
    }

    pub fn get_listing_cap(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ListingCap)
            .unwrap_or(50)
    }

    pub fn set_listing_cap(env: Env, new_cap: u32) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ListingCap, &new_cap);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "listing_cap_upd"),),
            new_cap,
        );
        Ok(())
    }

    pub fn get_user_active_listing_count(env: Env, seller: Address) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::UserActiveListingCount(seller))
            .unwrap_or(0)
    }

    pub fn bot_nft(env: Env) -> Address {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap();
        config.bot_nft
    }

    fn require_not_paused(env: &Env) -> Result<(), MarketplaceError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(MarketplaceError::ContractPaused);
        }
        Ok(())
    }

    fn read_tier_stats(env: &Env, tier: BotTier) -> TierStats {
        env.storage()
            .persistent()
            .get(&DataKey::TierStats(tier))
            .unwrap_or(TierStats {
                tier,
                volume: 0,
                sale_count: 0,
                last_sale_price: 0,
                floor_price: 0,
                floor_listing_id: 0,
            })
    }

    fn write_tier_stats(env: &Env, stats: &TierStats) {
        let key = DataKey::TierStats(stats.tier);
        env.storage().persistent().set(&key, stats);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// A new active listing can only lower the floor: one comparison.
    fn on_listing_added(env: &Env, listing: &Listing) {
        let mut stats = Self::read_tier_stats(env, listing.bot_tier);
        if stats.floor_price == 0 || listing.price < stats.floor_price {
            stats.floor_price = listing.price;
            stats.floor_listing_id = listing.id;
            Self::write_tier_stats(env, &stats);
        }
    }

    /// Called after `listing` has left the active index (sold, cancelled,
    /// deactivated). The floor is rescanned only if this listing held it.
    fn on_listing_removed(env: &Env, listing: &Listing) {
        let mut stats = Self::read_tier_stats(env, listing.bot_tier);
        if stats.floor_listing_id == listing.id {
            let (price, id) = Self::scan_floor(env, listing.bot_tier);
            stats.floor_price = price;
            stats.floor_listing_id = id;
            Self::write_tier_stats(env, &stats);
        }
    }

    /// Called after an active listing's price changed and was persisted.
    fn on_price_changed(env: &Env, listing: &Listing) {
        let mut stats = Self::read_tier_stats(env, listing.bot_tier);
        if stats.floor_price == 0 || listing.price < stats.floor_price {
            stats.floor_price = listing.price;
            stats.floor_listing_id = listing.id;
            Self::write_tier_stats(env, &stats);
        } else if stats.floor_listing_id == listing.id {
            let (price, id) = Self::scan_floor(env, listing.bot_tier);
            stats.floor_price = price;
            stats.floor_listing_id = id;
            Self::write_tier_stats(env, &stats);
        }
    }

    fn record_sale(env: &Env, tier: BotTier, price: i128) -> Result<(), MarketplaceError> {
        let mut stats = Self::read_tier_stats(env, tier);
        stats.volume = stats
            .volume
            .checked_add(price)
            .ok_or(MarketplaceError::Overflow)?;
        stats.sale_count += 1;
        stats.last_sale_price = price;
        Self::write_tier_stats(env, &stats);
        Ok(())
    }

    /// Lowest price and listing id among active listings of `tier`, or
    /// `(0, 0)` when there are none.
    fn scan_floor(env: &Env, tier: BotTier) -> (i128, u64) {
        let active: Vec<u64> = Self::ids_after(env, 0, u32::MAX);
        let mut best: (i128, u64) = (0, 0);
        for id in active.iter() {
            if let Some(l) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            {
                if l.active && l.bot_tier == tier && (best.0 == 0 || l.price < best.0) {
                    best = (l.price, l.id);
                }
            }
        }
        best
    }

    /// Append `listing_id` to the last page, opening a new page when full.
    /// Touches one bounded persistent entry regardless of total listings.
    fn append_listing_id(env: &Env, listing_id: u64) {
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PageCount)
            .unwrap_or(0);
        let mut page_no = count.saturating_sub(1);
        let mut page: Vec<u64> = if count == 0 {
            Vec::new(env)
        } else {
            env.storage()
                .persistent()
                .get(&DataKey::ListingPage(page_no))
                .unwrap_or_else(|| Vec::new(env))
        };
        if count == 0 || page.len() >= LISTING_PAGE_SIZE {
            page_no = count;
            page = Vec::new(env);
            env.storage()
                .instance()
                .set(&DataKey::PageCount, &(count + 1));
        }
        page.push_back(listing_id);
        let key = DataKey::ListingPage(page_no);
        env.storage().persistent().set(&key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Up to `max` indexed listing ids strictly greater than `cursor`, in
    /// ascending id order. Ids are appended monotonically, so pages are sorted
    /// and an id cursor stays valid across removals and compaction.
    fn ids_after(env: &Env, cursor: u64, max: u32) -> Vec<u64> {
        let mut out: Vec<u64> = Vec::new(env);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PageCount)
            .unwrap_or(0);
        let mut p = 0u32;
        while p < count {
            let page: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::ListingPage(p))
                .unwrap_or_else(|| Vec::new(env));
            p += 1;
            match page.last() {
                Some(last) if last > cursor => {}
                _ => continue,
            }
            for id in page.iter() {
                if id > cursor {
                    out.push_back(id);
                    if out.len() >= max {
                        return out;
                    }
                }
            }
        }
        out
    }

    fn add_user_purchase(env: &Env, buyer: &Address, purchase: Purchase) {
        let mut purchases: Vec<Purchase> = env
            .storage()
            .persistent()
            .get::<_, Vec<Purchase>>(&DataKey::UserPurchases(buyer.clone()))
            .unwrap_or_else(|| Vec::new(env));
        purchases.push_back(purchase);
        env.storage()
            .persistent()
            .set(&DataKey::UserPurchases(buyer.clone()), &purchases);
        env.storage().persistent().extend_ttl(
            &DataKey::UserPurchases(buyer.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    fn min_price_for_currency(env: &Env, currency: &Address, fee_bps: u32) -> i128 {
        if let Some(v) = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::MinPrice(currency.clone()))
        {
            return v;
        }
        if fee_bps == 0 {
            return 1;
        }
        // ceil(10_000 / fee_bps)
        let denom = fee_bps as i128;
        (10_000 + denom - 1) / denom
    }

    fn probe_bot_nft(env: &Env, bot_nft: &Address) -> Result<(), MarketplaceError> {
        let bot_client = BotNFTContractClient::new(env, bot_nft);
        match bot_client.try_admin() {
            Ok(Ok(_)) => Ok(()),
            _ => Err(MarketplaceError::InvalidBotNft),
        }
    }

    fn check_and_set_lock(env: &Env) -> Result<(), MarketplaceError> {
        if env.storage().instance().has(&DataKey::Locked) {
            return Err(MarketplaceError::Reentrancy);
        }
        env.storage().instance().set(&DataKey::Locked, &true);
        Ok(())
    }

    fn clear_lock(env: &Env) {
        env.storage().instance().remove(&DataKey::Locked);
    }

    fn is_currency_allowed(env: &Env, currency: &Address) -> bool {
        let allowed: Option<Vec<Address>> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedCurrencies);
        if let Some(currencies) = allowed {
            for c in currencies.iter() {
                if c == *currency {
                    return true;
                }
            }
            false
        } else {
            false
        }
    }

    fn add_currency(env: &Env, currency: Address) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();

        let mut allowed: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedCurrencies)
            .unwrap_or_else(|| Vec::new(env));

        for c in allowed.iter() {
            if c == currency {
                return Ok(());
            }
        }

        allowed.push_back(currency.clone());
        env.storage()
            .instance()
            .set(&DataKey::AllowedCurrencies, &allowed);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(env, "currency_added"),),
            currency,
        );
        Ok(())
    }

    fn remove_currency(env: &Env, currency: Address) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();

        let allowed: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedCurrencies)
            .unwrap_or_else(|| Vec::new(env));

        let mut new_allowed: Vec<Address> = Vec::new(env);
        for c in allowed.iter() {
            if c != currency {
                new_allowed.push_back(c);
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::AllowedCurrencies, &new_allowed);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(env, "currency_removed"),),
            currency,
        );
        Ok(())
    }

    fn decrement_user_active_listing_count(env: &Env, seller: &Address) {
        let count: u32 = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::UserActiveListingCount(seller.clone()))
            .unwrap_or(0);

        if count > 0 {
            let new_count = count - 1;
            if new_count > 0 {
                env.storage()
                    .persistent()
                    .set(&DataKey::UserActiveListingCount(seller.clone()), &new_count);
                env.storage().persistent().extend_ttl(
                    &DataKey::UserActiveListingCount(seller.clone()),
                    LEDGER_THRESHOLD,
                    LEDGER_BUMP,
                );
            } else {
                env.storage()
                    .persistent()
                    .remove(&DataKey::UserActiveListingCount(seller.clone()));
            }
        }
    }
}

#[cfg(test)]
mod test;
