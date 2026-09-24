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
//! `get_active_listings(start, limit)` together with `next_listing_id()` as a
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

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
    Vec,
};

use automint_bot_nft::{BotNFTContractClient, BotTier};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Listing(u64),
    ActiveListings,
    UserListings(Address),
    UserPurchases(Address),
    NextListingId,
    Config,
    Initialized,
    MinPrice(Address),
    UserActiveListingCount(Address),
    ListingCap,
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

#[derive(Clone)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub bot_nft: Address,
    pub fee_bps: u32,
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
}

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
    ) -> Result<(), MarketplaceError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(MarketplaceError::AlreadyInitialized);
        }
        admin.require_auth();

        Self::probe_bot_nft(&env, &bot_nft)?;

        let config = Config {
            admin: admin.clone(),
            bot_nft: bot_nft.clone(),
            fee_bps,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::NextListingId, &1u64);
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &Vec::<u64>::new(&env));
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
            .unwrap_or(Config {
                admin: currency.clone(),
                bot_nft: currency.clone(),
                fee_bps: 250,
            });
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
        seller.require_auth();

        // A listing must have a strictly positive price.
        if price <= 0 {
            return Err(MarketplaceError::InvalidPrice);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;

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
            return Err(MarketplaceError::TooManyListings);
        }

        // Enforce per-currency floor: price must be >= min_price(currency).
        // The default guarantees fee >= 1 base unit when fee_bps > 0.
        let min_price = Self::min_price_for_currency(&env, &currency, config.fee_bps);
        if price < min_price {
            return Err(MarketplaceError::PriceTooLow);
        }

        // Fetch the bot's tier from the NFT contract.
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        let bot = bot_client
            .try_get_bot(&bot_id)
            .map_err(|_| MarketplaceError::BotTransferFailed)?
            .map_err(|_| MarketplaceError::BotTransferFailed)?;
        let bot_tier = bot.tier;

        // Escrow the bot into the marketplace. The transfer fails (and we
        // surface BotTransferFailed instead of panicking) when the bot does not
        // exist or the seller is not its owner.
        let marketplace = env.current_contract_address();
        if bot_client
            .try_transfer(&bot_id, &seller, &marketplace)
            .is_err()
        {
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

        let mut active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        active.push_back(listing_id);
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &active);

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
        Ok(listing_id)
    }

    pub fn buy_bot(env: Env, buyer: Address, listing_id: u64) -> Result<(), MarketplaceError> {
        buyer.require_auth();
        let mut listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)?;
        if !listing.active {
            return Err(MarketplaceError::ListingNotActive);
        }
        if listing.seller == buyer {
            return Err(MarketplaceError::SelfPurchase);
        }
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;

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
                Self::remove_active_listing(&env, listing_id);
                return Err(MarketplaceError::ListingStale);
            }
        };
        if bot.owner != env.current_contract_address() {
            listing.active = false;
            env.storage()
                .persistent()
                .set(&DataKey::Listing(listing_id), &listing);
            Self::remove_active_listing(&env, listing_id);
            return Err(MarketplaceError::ListingStale);
        }

        // 2.5% fee (250 bps) by default, guarded against overflow.
        let fee = listing
            .price
            .checked_mul(config.fee_bps as i128)
            .ok_or(MarketplaceError::Overflow)?
            .checked_div(10_000)
            .ok_or(MarketplaceError::Overflow)?;
        let seller_amount = listing
            .price
            .checked_sub(fee)
            .ok_or(MarketplaceError::Overflow)?;

        // Transfer the NFT first. If payment later fails the buyer already
        // holds the bot, which is preferable to the reverse (payment moved but
        // bot not received) because payment is reversible via governance.
        let marketplace = env.current_contract_address();
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &buyer)
            .is_err()
        {
            return Err(MarketplaceError::BotTransferFailed);
        }

        // Now handle payment transfers.
        let token_client = token::Client::new(&env, &listing.currency);
        if token_client
            .try_transfer(&buyer, &listing.seller, &seller_amount)
            .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }
        if fee > 0
            && token_client
                .try_transfer(&buyer, &config.admin, &fee)
                .is_err()
        {
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
        Self::remove_active_listing(&env, listing_id);
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
        Ok(())
    }

    pub fn cancel_listing(
        env: Env,
        seller: Address,
        listing_id: u64,
    ) -> Result<(), MarketplaceError> {
        seller.require_auth();

        let mut listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)?;

        if !listing.active {
            return Err(MarketplaceError::ListingNotActive);
        }

        if listing.seller != seller {
            return Err(MarketplaceError::Unauthorized);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;

        // Return the escrowed bot from the marketplace back to the seller.
        let marketplace = env.current_contract_address();
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &seller)
            .is_err()
        {
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

        // Remove from the active listings index.
        let active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_active: Vec<u64> = Vec::new(&env);
        for id in active.iter() {
            if id != listing_id {
                new_active.push_back(id);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &new_active);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        Self::decrement_user_active_listing_count(&env, &listing.seller);

        env.events().publish(
            (symbol_short!("cancel"), seller, listing_id),
            listing.bot_id,
        );
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

    /// Return up to `limit` active listings, skipping the first `start` entries
    /// of the active-listings index.
    ///
    /// Input validation / edge-case handling (issue #120):
    /// - `limit == 0`: a request for zero items is trivially satisfied, so we
    ///   return an empty vec immediately rather than treating it as an error.
    /// - `start` beyond the number of active listings: the index iteration
    ///   simply skips every entry and yields an empty vec — no panic.
    /// - Stale index entry (an id in `ActiveListings` whose `Listing(id)` record
    ///   was removed from persistent storage): skipped gracefully via the
    ///   `if let Some(l)` guard.
    /// - An id still present in the index but whose listing has `active == false`:
    ///   filtered out by the `if l.active` check.
    ///
    /// Every edge case degrades gracefully to an empty/partial result, so there
    /// is no genuine failure condition to signal. The return type stays
    /// `Vec<Listing>` (rather than `Result<..>`) to avoid needless API churn for
    /// callers.
    pub fn get_active_listings(env: Env, start: u64, limit: u32) -> Vec<Listing> {
        let mut result: Vec<Listing> = Vec::new(&env);
        if limit == 0 {
            return result;
        }
        let active_ids: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        let marketplace = env.current_contract_address();
        let config: Option<Config> = env.storage().instance().get(&DataKey::Config);
        let mut count: u32 = 0;
        for (i, id) in active_ids.iter().enumerate() {
            if (i as u64) < start {
                continue;
            }
            if count >= limit {
                break;
            }
            if let Some(l) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            {
                if l.active {
                    // Filter stale listings where marketplace no longer owns the bot.
                    // This ensures a listing that became stale (e.g. via admin
                    // transfer) stops appearing even though the `buy_bot` stale
                    // path returns an error and the host reverts the
                    // `active=false` write. See module docs for enumeration
                    // design.
                    if let Some(cfg) = config.as_ref() {
                        let bot_client = BotNFTContractClient::new(&env, &cfg.bot_nft);
                        match bot_client.try_get_bot(&l.bot_id) {
                            Ok(Ok(bot)) if bot.owner == marketplace => {}
                            _ => continue,
                        }
                    }
                    result.push_back(l);
                    count += 1;
                }
            }
        }
        result
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

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        let old_admin = config.admin.clone();
        config.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (Symbol::new(&env, "admin_upd"),),
            (old_admin, config.admin.clone()),
        );
        Ok(())
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

    fn remove_active_listing(env: &Env, listing_id: u64) {
        let active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(env));
        let mut new_active: Vec<u64> = Vec::new(env);
        for id in active.iter() {
            if id != listing_id {
                new_active.push_back(id);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &new_active);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
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
        bot_client
            .try_get_bot(&1)
            .ok()
            .ok_or(MarketplaceError::InvalidBotNft)?;
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
            } else {
                env.storage()
                    .persistent()
                    .remove(&DataKey::UserActiveListingCount(seller.clone()));
            }
            env.storage().persistent().extend_ttl(
                &DataKey::UserActiveListingCount(seller.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
        }
    }
}

#[cfg(test)]
mod test;
