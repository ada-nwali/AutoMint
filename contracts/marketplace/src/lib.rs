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
//! The bot_nft address is readable via `bot_nft()` getter. Escrowed bots and
//! open offers settle through that address, so `set_bot_nft` is rejected with
//! `ActiveListingsExist` while any listing is still active (#912).
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
//!   Topics: ("listed", seller, listing_id), Data: (bot_id, price, currency)
//! - `sold`: Emitted when a bot is purchased.
//!   Topics: ("sold", seller, buyer), Data: (listing_id, bot_id, price, currency)
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
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Env, String, Symbol, Vec,
};

/// The bot_nft entry points marketplace calls, declared locally instead of
/// depending on `automint-bot-nft`: linking another contract's rlib pulls its
/// exported functions (`initialize`, ...) into this wasm, where the duplicate
/// `initialize` silently drops ours from the export table — and the registry
/// chain that dependency used to pull broke this wasm's link outright. Same
/// pattern as accrual's `RegistryInterface` (#346c800). Typed errors from the
/// callee surface through `try_*`.
#[contractclient(name = "BotNFTContractClient")]
pub trait BotNftInterface {
    fn get_bot(env: Env, bot_id: u64) -> BotNFT;
    fn admin(env: Env) -> Address;
    fn transfer(env: Env, bot_id: u64, from: Address, to: Address);
}

/// Local mirror of bot_nft's `BotTier`: same variant names, order, and
/// discriminants, so values encode identically on the wire; see
/// `BotNftInterface`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[contracttype]
#[repr(u32)]
pub enum BotTier {
    Basic = 0,
    Bronze = 1,
    Silver = 2,
    Gold = 3,
    Diamond = 4,
}

/// Local mirror of bot_nft's `BotNFT`: same field names and order, so
/// cross-contract values decode identically; see `BotNftInterface`.
#[derive(Clone)]
#[contracttype]
pub struct BotNFT {
    pub id: u64,
    pub tier: BotTier,
    pub owner: Address,
    pub minter: Address,
    pub accrual_rate: u64,
    pub minted_at: u64,
    /// Owner-settable nickname (max 24 bytes); `None` when unset.
    pub nickname: Option<String>,
    /// Deterministic variant (0..=7) assigned at mint, used for rarity.
    pub variant: u32,
    /// Deterministic bonus bps (0..500) on top of the tier base accrual rate.
    pub bonus_bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Listing(u64),
    /// Paged listing-ID index: page `n` holds at most `LISTING_PAGE_SIZE` ids
    /// in ascending order (persistent storage).
    ListingPage(u32),
    /// Number of listing pages allocated (instance storage, a single u32).
    PageCount,
    /// Page `n` of a seller's listing ids, `USER_HISTORY_PAGE_SIZE` per page (#916).
    UserListingPage(Address, u32),
    UserListingCount(Address),
    /// Page `n` of a buyer's purchases, `USER_HISTORY_PAGE_SIZE` per page (#916).
    UserPurchasePage(Address, u32),
    UserPurchaseCount(Address),
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
    /// Listings currently escrowing a bot (instance storage). Maintained by
    /// `on_listing_added` / `on_listing_removed`; `set_bot_nft` refuses to
    /// rotate the bot NFT address while it is non-zero.
    ActiveListingCount,
    Locked,            // #326: Reentrancy guard
    AllowedCurrencies, // #325: Currency allowlist
    /// An escrowed offer by id (persistent) (#425).
    Offer(u64),
    /// Open offer ids for a bot, oldest first (persistent) (#425).
    BotOffers(u64),
    /// Next offer id to assign (instance) (#425).
    NextOfferId,
    /// Platform fees accrued per currency and not yet withdrawn (persistent) (#426).
    Fees(Address),
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
    /// Unix timestamp (seconds) after which the listing is considered expired.
    /// `buy_bot` rejects purchases past this time; `reclaim_expired` returns
    /// the bot to the seller. Bounded to 1–90 days from `listed_at` (#423).
    pub expires_at: u64,
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

/// A buyer's escrowed bid for a bot (#425).
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Offer {
    pub id: u64,
    pub buyer: Address,
    pub bot_id: u64,
    /// Escrowed amount in `currency`'s base units.
    pub amount: i128,
    pub currency: Address,
    pub created_at: u64,
    /// Ledger timestamp from which the offer can no longer be accepted and
    /// anyone may cancel it to refund the buyer.
    pub expires_at: u64,
    pub status: OfferStatus,
}

#[derive(Clone, Copy, Debug, PartialEq)]
#[contracttype]
pub enum OfferStatus {
    Active,
    Accepted,
    Cancelled,
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
    Reentrancy = 22,          // #326: Reentrancy guard
    UnsupportedCurrency = 23, // #325: Currency allowlist
    ListingExpired = 24,      // #423: listing expiry
    /// `make_offer`: `expires_at` is not in the future (#425), or is more than
    /// `MAX_OFFER_DURATION` seconds away (#914).
    InvalidExpiry = 25,
    OfferNotFound = 26,
    /// The offer was already accepted or cancelled (#425).
    OfferNotActive = 27,
    /// `accept_offer`: the offer's `expires_at` has passed (#425).
    OfferExpired = 28,
    /// `cancel_offer` before expiry by someone other than the buyer (#425).
    NotOfferOwner = 29,
    /// `make_offer` on a bot the buyer already owns or has listed (#425).
    OfferOnOwnBot = 30,
    /// The bot already carries `MAX_OFFERS_PER_BOT` open offers (#425).
    TooManyOffers = 31,
    /// `withdraw_fees` amount was zero or negative (#426).
    InvalidAmount = 32,
    /// `withdraw_fees` amount exceeds the accrued fee balance (#426).
    InsufficientFees = 33,
    /// `set_bot_nft`: at least one listing still escrows a bot in the current
    /// bot NFT contract, so the address cannot change until they settle.
    ActiveListingsExist = 34,
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
/// Maximum open offers a single bot may carry (#425); bounds the per-bot
/// index so `get_offers_for_bot` and offer bookkeeping stay O(1) in storage
/// entries.
pub const MAX_OFFERS_PER_BOT: u32 = 25;
/// Longest an offer may stay open, in seconds (30 days) (#914). Bounds how
/// long a buyer can hold one of a bot's `MAX_OFFERS_PER_BOT` slots.
pub const MAX_OFFER_DURATION: u64 = 2_592_000;

/// Entries per persistent user-history page (#916). Appends rewrite only the
/// last page, so a long history never gets loaded and stored in full.
pub const USER_HISTORY_PAGE_SIZE: u32 = 50;

/// Most history entries one paginated read returns (#916).
pub const MAX_HISTORY_PAGE_LIMIT: u32 = 50;

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
        env.storage().instance().set(&DataKey::ListingCap, &50u32);
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
        duration_secs: u64,
    ) -> Result<u64, MarketplaceError> {
        Self::check_and_set_lock(&env)?;

        seller.require_auth();
        if let Err(e) = Self::require_not_paused(&env) {
            Self::clear_lock(&env);
            return Err(e);
        }

        // duration_secs must be between 1 day and 90 days (#423).
        const MIN_DURATION: u64 = 86_400; // 1 day
        const MAX_DURATION: u64 = 86_400 * 90; // 90 days
        if !(MIN_DURATION..=MAX_DURATION).contains(&duration_secs) {
            Self::clear_lock(&env);
            return Err(MarketplaceError::InvalidPrice);
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
        let next_listing_id = match listing_id.checked_add(1) {
            Some(n) => n,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::Overflow);
            }
        };

        let now = env.ledger().timestamp();
        let listing = Listing {
            id: listing_id,
            seller: seller.clone(),
            bot_id,
            bot_tier,
            price,
            currency: currency.clone(),
            listed_at: now,
            active: true,
            expires_at: now.saturating_add(duration_secs),
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

        if let Err(e) = Self::append_listing_id(&env, listing_id) {
            Self::clear_lock(&env);
            return Err(e);
        }
        Self::on_listing_added(&env, &listing);

        Self::append_user_listing(&env, &seller, listing_id);

        let updated_count = match user_count.checked_add(1) {
            Some(n) => n,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::Overflow);
            }
        };
        env.storage().persistent().set(
            &DataKey::UserActiveListingCount(seller.clone()),
            &updated_count,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::UserActiveListingCount(seller.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        env.storage()
            .instance()
            .set(&DataKey::NextListingId, &next_listing_id);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("listed"), seller, listing_id),
            (bot_id, price, currency),
        );
        Self::clear_lock(&env);
        Ok(listing_id)
    }

    /// Purchase the escrowed bot behind `listing_id` for `buyer`.
    ///
    /// Fee/royalty split on `listing.price`:
    /// - `platform_fee = price * fee_bps / 10_000` stays in the contract and
    ///   accrues to `fees_accrued(currency)` for `withdraw_fees`;
    /// - `royalty = price * royalty_bps / 10_000` is paid to the bot's
    ///   original minter, unless the minter is the seller (then the royalty
    ///   is added back to the seller's payout so no funds are stranded);
    /// - the seller receives `price - platform_fee - royalty` (plus the
    ///   royalty when waived as above).
    ///
    /// The bot transfer to `buyer` happens *before* any token leg; if a
    /// later leg fails the entire invocation rolls back, so the buyer can
    /// never hold both the bot and their payment. Emits `sold`.
    ///
    /// Auth: `buyer.require_auth()`; the buyer must not be the seller.
    /// Order: existence -> authorization -> state validity -> effects.
    ///
    /// Errors: `ListingNotFound`, `SelfPurchase`, `ListingNotActive`,
    /// `ListingExpired`, `ContractPaused`, `UnsupportedCurrency`,
    /// `ListingStale` (escrow no longer holds the bot — the listing is
    /// deactivated before the error returns), `BotTransferFailed`,
    /// `PaymentFailed`, `Overflow`.
    pub fn buy_bot(env: Env, buyer: Address, listing_id: u64) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;

        buyer.require_auth();
        if let Err(e) = Self::require_not_paused(&env) {
            Self::clear_lock(&env);
            return Err(e);
        }
        // Order: existence -> authorization -> state validity -> effects.
        let mut listing: Listing = match env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
        {
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
        // Reject purchases on expired listings (#423).
        if env.ledger().timestamp() > listing.expires_at {
            Self::clear_lock(&env);
            return Err(MarketplaceError::ListingExpired);
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

        let platform_fee = match Self::bps_of(listing.price, config.fee_bps) {
            Ok(f) => f,
            Err(e) => {
                Self::clear_lock(&env);
                return Err(e);
            }
        };

        let royalty = match Self::bps_of(listing.price, config.royalty_bps) {
            Ok(r) => r,
            Err(e) => {
                Self::clear_lock(&env);
                return Err(e);
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
        // The platform fee stays in the contract's balance and is tracked in
        // `DataKey::Fees(currency)` for `withdraw_fees` (#426).
        if let Err(e) = Self::accrue_fee(&env, &listing.currency, platform_fee) {
            Self::clear_lock(&env);
            return Err(e);
        }
        if pay_royalty
            && token_client
                .try_transfer(&marketplace, &bot.minter, &royalty)
                .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::PaymentFailed);
        }

        if let Err(e) = Self::record_sale(&env, listing.bot_tier, listing.price) {
            Self::clear_lock(&env);
            return Err(e);
        }
        Self::deactivate_listing(&env, listing_id);
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
            (
                listing_id,
                listing.bot_id,
                listing.price,
                listing.currency.clone(),
            ),
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

        let listing: Listing = match env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
        {
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

        // The id stays in its ListingPage as a tombstone (`active == false`);
        // `compact_page` reclaims the slot later.
        Self::deactivate_listing(&env, listing_id);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("cancel"), seller, listing_id),
            listing.bot_id,
        );
        Self::clear_lock(&env);
        Ok(())
    }

    /// Permissionless: return an expired, still-active listing's escrowed bot
    /// to the original seller. Anyone may trigger this; the bot always returns
    /// to the seller, never to the caller (#423).
    pub fn reclaim_expired(env: Env, listing_id: u64) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;

        let listing: Listing = match env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
        {
            Some(l) => l,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::ListingNotFound);
            }
        };

        if !listing.active {
            Self::clear_lock(&env);
            return Err(MarketplaceError::ListingNotActive);
        }

        if env.ledger().timestamp() <= listing.expires_at {
            Self::clear_lock(&env);
            return Err(MarketplaceError::ListingNotActive); // not yet expired
        }

        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(c) => c,
            None => {
                Self::clear_lock(&env);
                return Err(MarketplaceError::NotInitialized);
            }
        };

        // Return the escrowed bot to the original seller, not the caller.
        let marketplace = env.current_contract_address();
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &listing.seller)
            .is_err()
        {
            Self::clear_lock(&env);
            return Err(MarketplaceError::BotTransferFailed);
        }

        Self::deactivate_listing(&env, listing_id);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (
                Symbol::new(&env, "reclaimed"),
                listing.seller.clone(),
                listing_id,
            ),
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
        let listing_id: u64 = match env.storage().persistent().get(&DataKey::BotListing(bot_id)) {
            Some(id) => id,
            None => return Ok(()),
        };
        if Self::deactivate_listing(&env, listing_id) {
            env.events()
                .publish((symbol_short!("deactive"), bot_id), listing_id);
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
    /// Every listing the seller has created. Reads the whole history; use
    /// `get_user_listings_page` for bounded reads (#916).
    pub fn get_user_listings(env: Env, seller: Address) -> Vec<Listing> {
        let count = Self::user_listing_count(&env, &seller);
        Self::read_user_listings(&env, &seller, 0, count)
    }

    /// Up to `limit` (at most `MAX_HISTORY_PAGE_LIMIT`) of the seller's
    /// listings, oldest first, starting at index `cursor`. The second value is
    /// the cursor for the next page, or `None` once the history is exhausted.
    pub fn get_user_listings_page(
        env: Env,
        seller: Address,
        cursor: u32,
        limit: u32,
    ) -> (Vec<Listing>, Option<u32>) {
        let count = Self::user_listing_count(&env, &seller);
        let end = cursor
            .saturating_add(limit.min(MAX_HISTORY_PAGE_LIMIT))
            .min(count);
        let listings = Self::read_user_listings(&env, &seller, cursor, end);
        let next = if end < count { Some(end) } else { None };
        (listings, next)
    }

    /// The buyer's most recent `limit` purchases, oldest first (#916).
    pub fn get_user_purchases(env: Env, buyer: Address, limit: u32) -> Vec<Purchase> {
        let count = Self::user_purchase_count(&env, &buyer);
        Self::read_user_purchases(&env, &buyer, count.saturating_sub(limit), count)
    }

    /// Up to `limit` (at most `MAX_HISTORY_PAGE_LIMIT`) of the buyer's
    /// purchases, oldest first, starting at index `cursor`. The second value is
    /// the cursor for the next page, or `None` once the history is exhausted.
    pub fn get_user_purchases_page(
        env: Env,
        buyer: Address,
        cursor: u32,
        limit: u32,
    ) -> (Vec<Purchase>, Option<u32>) {
        let count = Self::user_purchase_count(&env, &buyer);
        let end = cursor
            .saturating_add(limit.min(MAX_HISTORY_PAGE_LIMIT))
            .min(count);
        let purchases = Self::read_user_purchases(&env, &buyer, cursor, end);
        let next = if end < count { Some(end) } else { None };
        (purchases, next)
    }

    /// The stored configuration: admin, bot NFT contract, platform fee
    /// (`fee_bps`) and creator royalty (`royalty_bps`), both in basis
    /// points. Read-only.
    /// The marketplace configuration set at `initialize`.
    ///
    /// Errors: `NotInitialized` before the contract is set up.
    pub fn config(env: Env) -> Result<Config, MarketplaceError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)
    }

    /// The admin address recorded at initialization. Read-only.
    ///
    /// Errors: `NotInitialized` before the contract is set up.
    pub fn admin(env: Env) -> Result<Address, MarketplaceError> {
        Ok(Self::config(env)?.admin)
    }

    /// Change the platform fee. The combined `fee_bps + royalty_bps` must stay
    /// within 10,000 basis points, as enforced by `initialize` (#911).
    pub fn set_fee_bps(env: Env, new_fee_bps: u32) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        if (new_fee_bps as u64) + (config.royalty_bps as u64) > 10_000 {
            return Err(MarketplaceError::InvalidPrice);
        }
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

    /// Point the marketplace at a new bot NFT contract. Rejected with
    /// `ActiveListingsExist` while any listing escrows a bot, because escrowed
    /// bots are settled through the configured address (#912).
    pub fn set_bot_nft(env: Env, new_bot_nft: Address) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();

        if Self::active_listing_count(&env) > 0 {
            return Err(MarketplaceError::ActiveListingsExist);
        }

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
        env.events()
            .publish((symbol_short!("paused"),), config.admin);
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

    /// Whether the marketplace is currently paused. While paused,
    /// `list_bot`, `buy_bot` and `update_price` fail with `ContractPaused`;
    /// `cancel_listing` keeps working so sellers can always retrieve
    /// escrowed bots. Read-only; `false` when never paused.
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

    /// Maximum number of *active* listings one seller may hold at once
    /// (default 50). Cancelled or completed listings do not count.
    /// `list_bot` fails with `TooManyListings` when the cap is reached.
    /// Read-only.
    pub fn get_listing_cap(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ListingCap)
            .unwrap_or(50)
    }

    /// Admin-only: set the per-seller active-listing cap (#438). Prevents
    /// one account flooding the market with dust listings. Applies to
    /// future `list_bot` calls; sellers already at the old cap are not
    /// evicted. Emits `listing_cap_upd`.
    ///
    /// Auth: admin only.
    ///
    /// Errors: `NotInitialized`.
    pub fn set_listing_cap(env: Env, new_cap: u32) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();

        env.storage().instance().set(&DataKey::ListingCap, &new_cap);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events()
            .publish((Symbol::new(&env, "listing_cap_upd"),), new_cap);
        Ok(())
    }

    /// Number of active listings `seller` currently holds in the escrow
    /// marketplace. Bounded by `get_listing_cap`. Read-only; `0` when the
    /// seller has never listed or holds no active listings.
    pub fn get_user_active_listing_count(env: Env, seller: Address) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::UserActiveListingCount(seller))
            .unwrap_or(0)
    }

    /// The bot NFT contract this marketplace escrows and settles trades
    /// through. Set at `initialize` (or by admin `set_bot_nft`) and
    /// probed to respond to the bot_nft interface. Read-only.
    ///
    /// Errors: `NotInitialized` before the contract is set up.
    pub fn bot_nft(env: Env) -> Result<Address, MarketplaceError> {
        Ok(Self::config(env)?.bot_nft)
    }

    // ---------------------------------------------------------------------
    // Offers (#425)
    // ---------------------------------------------------------------------

    /// Escrow `amount` of `currency` from `buyer` as a standing offer for
    /// `bot_id`, open until `expires_at` (ledger timestamp, exclusive).
    ///
    /// The bot does not need to be listed. The offer is rejected when the
    /// buyer already owns the bot, outright or through their own active
    /// listing, when `currency` is not allowlisted, when `amount` is below the
    /// currency's minimum price, when `expires_at` is more than
    /// `MAX_OFFER_DURATION` seconds away, or when the bot already carries
    /// `MAX_OFFERS_PER_BOT` open offers.
    pub fn make_offer(
        env: Env,
        buyer: Address,
        bot_id: u64,
        amount: i128,
        currency: Address,
        expires_at: u64,
    ) -> Result<u64, MarketplaceError> {
        Self::check_and_set_lock(&env)?;
        let result = Self::make_offer_inner(&env, buyer, bot_id, amount, currency, expires_at);
        Self::clear_lock(&env);
        result
    }

    fn make_offer_inner(
        env: &Env,
        buyer: Address,
        bot_id: u64,
        amount: i128,
        currency: Address,
        expires_at: u64,
    ) -> Result<u64, MarketplaceError> {
        buyer.require_auth();
        Self::require_not_paused(env)?;
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        if amount <= 0 {
            return Err(MarketplaceError::InvalidPrice);
        }
        if !Self::is_currency_allowed(env, &currency) {
            return Err(MarketplaceError::UnsupportedCurrency);
        }
        if amount < Self::min_price_for_currency(env, &currency, config.fee_bps) {
            return Err(MarketplaceError::PriceTooLow);
        }
        let now = env.ledger().timestamp();
        if expires_at <= now || expires_at - now > MAX_OFFER_DURATION {
            return Err(MarketplaceError::InvalidExpiry);
        }
        let bot_client = BotNFTContractClient::new(env, &config.bot_nft);
        let bot = match bot_client.try_get_bot(&bot_id) {
            Ok(Ok(b)) => b,
            _ => return Err(MarketplaceError::BotNotFound),
        };
        if Self::effective_owner(env, &bot) == buyer {
            return Err(MarketplaceError::OfferOnOwnBot);
        }
        let bot_offers = Self::read_bot_offers(env, bot_id);
        let mut active_offers: Vec<u64> = Vec::new(env);
        for id in bot_offers.iter() {
            if let Some(off) = Self::read_offer(env, id) {
                if off.status == OfferStatus::Active && off.expires_at > now {
                    active_offers.push_back(id);
                }
            }
        }
        if active_offers.len() >= MAX_OFFERS_PER_BOT {
            return Err(MarketplaceError::TooManyOffers);
        }
        let mut bot_offers = active_offers;

        let offer_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextOfferId)
            .unwrap_or(1);
        let next_offer_id = offer_id.checked_add(1).ok_or(MarketplaceError::Overflow)?;

        // Escrow the funds; the whole invocation aborts if the pull fails.
        let token_client = token::Client::new(env, &currency);
        if token_client
            .try_transfer(&buyer, &env.current_contract_address(), &amount)
            .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }

        let offer = Offer {
            id: offer_id,
            buyer: buyer.clone(),
            bot_id,
            amount,
            currency,
            created_at: env.ledger().timestamp(),
            expires_at,
            status: OfferStatus::Active,
        };
        Self::write_offer(env, &offer);
        bot_offers.push_back(offer_id);
        Self::write_bot_offers(env, bot_id, &bot_offers);
        env.storage()
            .instance()
            .set(&DataKey::NextOfferId, &next_offer_id);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (symbol_short!("offered"), buyer, offer_id),
            (bot_id, amount, expires_at),
        );
        Ok(offer_id)
    }

    /// Accept offer `offer_id` as `seller`: the bot moves to the buyer and the
    /// escrowed funds are paid out in the same invocation, so neither side
    /// can end up with both or neither.
    ///
    /// The seller must own the bot outright, or hold it in escrow through
    /// their own active listing, which is deactivated as part of the sale.
    /// The platform fee is retained in the contract (see `withdraw_fees`), the
    /// royalty goes to the original minter unless the minter is the seller.
    pub fn accept_offer(env: Env, seller: Address, offer_id: u64) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;
        let result = Self::accept_offer_inner(&env, seller, offer_id);
        Self::clear_lock(&env);
        result
    }

    fn accept_offer_inner(
        env: &Env,
        seller: Address,
        offer_id: u64,
    ) -> Result<(), MarketplaceError> {
        seller.require_auth();
        Self::require_not_paused(env)?;
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        let mut offer = Self::read_offer(env, offer_id)?;
        if offer.status != OfferStatus::Active {
            return Err(MarketplaceError::OfferNotActive);
        }
        if env.ledger().timestamp() >= offer.expires_at {
            return Err(MarketplaceError::OfferExpired);
        }
        if offer.buyer == seller {
            return Err(MarketplaceError::SelfPurchase);
        }
        if !Self::is_currency_allowed(env, &offer.currency) {
            return Err(MarketplaceError::UnsupportedCurrency);
        }

        let bot_client = BotNFTContractClient::new(env, &config.bot_nft);
        let bot = match bot_client.try_get_bot(&offer.bot_id) {
            Ok(Ok(b)) => b,
            _ => return Err(MarketplaceError::BotNotFound),
        };
        let marketplace = env.current_contract_address();

        // Resolve custody: the seller holds the bot directly, or the
        // marketplace holds it under the seller's active listing.
        let escrowed_listing: Option<Listing> = if bot.owner == seller {
            None
        } else if bot.owner == marketplace {
            match Self::active_listing_for_bot(env, offer.bot_id) {
                Some(l) if l.seller == seller => Some(l),
                _ => return Err(MarketplaceError::NotBotOwner),
            }
        } else {
            return Err(MarketplaceError::NotBotOwner);
        };

        let platform_fee = Self::bps_of(offer.amount, config.fee_bps)?;
        let royalty = Self::bps_of(offer.amount, config.royalty_bps)?;
        let pay_royalty = royalty > 0 && bot.minter != seller;
        let mut seller_payout = offer
            .amount
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(royalty))
            .ok_or(MarketplaceError::Overflow)?;
        if royalty > 0 && !pay_royalty {
            seller_payout = seller_payout
                .checked_add(royalty)
                .ok_or(MarketplaceError::Overflow)?;
        }

        // Move the bot first (see `buy_bot` for the ordering rationale).
        let from = match &escrowed_listing {
            Some(_) => marketplace.clone(),
            None => seller.clone(),
        };
        if bot_client
            .try_transfer(&offer.bot_id, &from, &offer.buyer)
            .is_err()
        {
            return Err(MarketplaceError::BotTransferFailed);
        }
        if let Some(listing) = &escrowed_listing {
            Self::deactivate_listing(env, listing.id);
        }

        // Pay out of escrow. Every leg is checked so a failure aborts the
        // whole invocation, bot transfer included.
        let token_client = token::Client::new(env, &offer.currency);
        if seller_payout > 0
            && token_client
                .try_transfer(&marketplace, &seller, &seller_payout)
                .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }
        if pay_royalty
            && token_client
                .try_transfer(&marketplace, &bot.minter, &royalty)
                .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }
        Self::accrue_fee(env, &offer.currency, platform_fee)?;

        offer.status = OfferStatus::Accepted;
        Self::write_offer(env, &offer);
        Self::remove_bot_offer(env, offer.bot_id, offer_id);
        Self::record_sale(env, bot.tier, offer.amount)?;
        Self::add_user_purchase(
            env,
            &offer.buyer,
            Purchase {
                listing_id: 0,
                bot_id: offer.bot_id,
                seller: seller.clone(),
                price: offer.amount,
                currency: offer.currency.clone(),
                purchased_at: env.ledger().timestamp(),
            },
        );
        env.events().publish(
            (symbol_short!("offer_acc"), seller, offer.buyer.clone()),
            (offer_id, offer.bot_id, offer.amount),
        );
        Ok(())
    }

    /// Cancel an open offer and refund its escrow in full. Before expiry only
    /// the offer's buyer may cancel; once `expires_at` has passed anyone may
    /// call it (the refund always goes to the buyer), so stale escrow never
    /// depends on the buyer coming back.
    pub fn cancel_offer(env: Env, caller: Address, offer_id: u64) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;
        let result = Self::cancel_offer_inner(&env, caller, offer_id);
        Self::clear_lock(&env);
        result
    }

    fn cancel_offer_inner(
        env: &Env,
        caller: Address,
        offer_id: u64,
    ) -> Result<(), MarketplaceError> {
        caller.require_auth();
        let mut offer = Self::read_offer(env, offer_id)?;
        if offer.status != OfferStatus::Active {
            return Err(MarketplaceError::OfferNotActive);
        }
        let expired = env.ledger().timestamp() >= offer.expires_at;
        if !expired && caller != offer.buyer {
            return Err(MarketplaceError::NotOfferOwner);
        }
        Self::refund_offer(env, &mut offer)?;
        env.events().publish(
            (symbol_short!("offer_cxl"), offer.buyer.clone(), offer_id),
            (offer.bot_id, offer.amount, expired),
        );
        Ok(())
    }

    /// Dismiss an open offer before expiry and refund its escrow in full to
    /// the buyer (#914). `caller` must be the bot's effective owner (directly,
    /// or as the seller of its active listing) or the admin, so a bot owner
    /// can clear unwanted offers that would otherwise hold its
    /// `MAX_OFFERS_PER_BOT` slots until they expire. The refund never goes
    /// anywhere but the buyer.
    pub fn dismiss_offer(env: Env, caller: Address, offer_id: u64) -> Result<(), MarketplaceError> {
        Self::check_and_set_lock(&env)?;
        let result = Self::dismiss_offer_inner(&env, caller, offer_id);
        Self::clear_lock(&env);
        result
    }

    fn dismiss_offer_inner(
        env: &Env,
        caller: Address,
        offer_id: u64,
    ) -> Result<(), MarketplaceError> {
        caller.require_auth();
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        let mut offer = Self::read_offer(env, offer_id)?;
        if offer.status != OfferStatus::Active {
            return Err(MarketplaceError::OfferNotActive);
        }
        if caller != config.admin {
            // A bot that no longer resolves has no owner to dismiss for it;
            // the admin, or anyone after expiry, can still clear the offer.
            let bot_client = BotNFTContractClient::new(env, &config.bot_nft);
            let bot = match bot_client.try_get_bot(&offer.bot_id) {
                Ok(Ok(b)) => b,
                _ => return Err(MarketplaceError::Unauthorized),
            };
            if Self::effective_owner(env, &bot) != caller {
                return Err(MarketplaceError::Unauthorized);
            }
        }
        Self::refund_offer(env, &mut offer)?;
        env.events().publish(
            (symbol_short!("offer_dsm"), offer.buyer.clone(), offer_id),
            (offer.bot_id, offer.amount, caller),
        );
        Ok(())
    }

    /// One offer by id, whatever its status.
    pub fn get_offer(env: Env, offer_id: u64) -> Result<Offer, MarketplaceError> {
        Self::read_offer(&env, offer_id)
    }

    /// Every open (`Active`) offer on `bot_id`, oldest first. Expired offers
    /// stay listed until someone cancels them, so callers should compare
    /// `expires_at` with the ledger timestamp.
    pub fn get_offers_for_bot(env: Env, bot_id: u64) -> Vec<Offer> {
        let ids = Self::read_bot_offers(&env, bot_id);
        let mut out: Vec<Offer> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(offer) = env
                .storage()
                .persistent()
                .get::<_, Offer>(&DataKey::Offer(id))
            {
                out.push_back(offer);
            }
        }
        out
    }

    // ---------------------------------------------------------------------
    // Fee withdrawal (#426)
    // ---------------------------------------------------------------------

    /// Platform fees accrued in `currency` and still held by the contract.
    /// Escrowed offer funds are never part of this figure.
    pub fn fees_accrued(env: Env, currency: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Fees(currency))
            .unwrap_or(0)
    }

    /// Admin-only: move `amount` of accrued fees in `currency` to `to`.
    /// Bounded by `fees_accrued`, so escrowed offer funds cannot be drained.
    pub fn withdraw_fees(
        env: Env,
        currency: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), MarketplaceError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        if amount <= 0 {
            return Err(MarketplaceError::InvalidAmount);
        }
        let accrued = Self::fees_accrued(env.clone(), currency.clone());
        if amount > accrued {
            return Err(MarketplaceError::InsufficientFees);
        }
        let remaining = accrued
            .checked_sub(amount)
            .ok_or(MarketplaceError::Overflow)?;
        let token_client = token::Client::new(&env, &currency);
        if token_client
            .try_transfer(&env.current_contract_address(), &to, &amount)
            .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }
        Self::write_fees(&env, &currency, remaining);
        env.events().publish(
            (symbol_short!("fees_wd"), config.admin, to),
            (currency, amount, remaining),
        );
        Ok(())
    }

    // ---- offer and fee helpers ----

    /// Return `offer`'s escrow to its buyer, mark it cancelled and drop it
    /// from the bot's open-offer index.
    fn refund_offer(env: &Env, offer: &mut Offer) -> Result<(), MarketplaceError> {
        let token_client = token::Client::new(env, &offer.currency);
        if token_client
            .try_transfer(&env.current_contract_address(), &offer.buyer, &offer.amount)
            .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }
        offer.status = OfferStatus::Cancelled;
        Self::write_offer(env, offer);
        Self::remove_bot_offer(env, offer.bot_id, offer.id);
        Ok(())
    }

    /// `amount * bps / 10_000`, or `Overflow`.
    ///
    /// Splits `amount` into whole and remainder parts of 10_000 so the
    /// product never exceeds `i128` before the division. Prices above
    /// `i128::MAX / 10_000` therefore settle correctly (#917).
    fn bps_of(amount: i128, bps: u32) -> Result<i128, MarketplaceError> {
        let bps = bps as i128;
        let whole_fee = (amount / 10_000)
            .checked_mul(bps)
            .ok_or(MarketplaceError::Overflow)?;
        // |remainder| < 10_000, so this product fits in i128 for any `bps`.
        let remainder_fee = (amount % 10_000) * bps / 10_000;
        whole_fee
            .checked_add(remainder_fee)
            .ok_or(MarketplaceError::Overflow)
    }

    /// Adds `fee` to the per-currency fee ledger (no transfer: the funds are
    /// already in the contract's balance).
    fn accrue_fee(env: &Env, currency: &Address, fee: i128) -> Result<(), MarketplaceError> {
        if fee <= 0 {
            return Ok(());
        }
        let total = Self::fees_accrued(env.clone(), currency.clone())
            .checked_add(fee)
            .ok_or(MarketplaceError::Overflow)?;
        Self::write_fees(env, currency, total);
        Ok(())
    }

    fn write_fees(env: &Env, currency: &Address, total: i128) {
        let key = DataKey::Fees(currency.clone());
        env.storage().persistent().set(&key, &total);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Who can dispose of `bot`: its owner, or the seller of the active
    /// listing that escrowed it in this contract.
    fn effective_owner(env: &Env, bot: &BotNFT) -> Address {
        if bot.owner == env.current_contract_address() {
            if let Some(listing) = Self::active_listing_for_bot(env, bot.id) {
                return listing.seller;
            }
        }
        bot.owner.clone()
    }

    fn active_listing_for_bot(env: &Env, bot_id: u64) -> Option<Listing> {
        let listing_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BotListing(bot_id))?;
        let listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))?;
        if listing.active {
            Some(listing)
        } else {
            None
        }
    }

    fn read_offer(env: &Env, offer_id: u64) -> Result<Offer, MarketplaceError> {
        env.storage()
            .persistent()
            .get(&DataKey::Offer(offer_id))
            .ok_or(MarketplaceError::OfferNotFound)
    }

    fn write_offer(env: &Env, offer: &Offer) {
        let key = DataKey::Offer(offer.id);
        env.storage().persistent().set(&key, offer);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn read_bot_offers(env: &Env, bot_id: u64) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::BotOffers(bot_id))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn write_bot_offers(env: &Env, bot_id: u64, ids: &Vec<u64>) {
        let key = DataKey::BotOffers(bot_id);
        if ids.is_empty() {
            env.storage().persistent().remove(&key);
            return;
        }
        env.storage().persistent().set(&key, ids);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn remove_bot_offer(env: &Env, bot_id: u64, offer_id: u64) {
        let ids = Self::read_bot_offers(env, bot_id);
        let mut kept: Vec<u64> = Vec::new(env);
        for id in ids.iter() {
            if id != offer_id {
                kept.push_back(id);
            }
        }
        Self::write_bot_offers(env, bot_id, &kept);
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

    fn active_listing_count(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ActiveListingCount)
            .unwrap_or(0)
    }

    fn write_active_listing_count(env: &Env, count: u32) {
        env.storage()
            .instance()
            .set(&DataKey::ActiveListingCount, &count);
    }

    /// A new active listing can only lower the floor: one comparison.
    fn on_listing_added(env: &Env, listing: &Listing) {
        Self::write_active_listing_count(env, Self::active_listing_count(env).saturating_add(1));
        let mut stats = Self::read_tier_stats(env, listing.bot_tier);
        if stats.floor_price == 0 || listing.price < stats.floor_price {
            stats.floor_price = listing.price;
            stats.floor_listing_id = listing.id;
            Self::write_tier_stats(env, &stats);
        }
    }

    /// Called after `listing` has left the active index (sold, cancelled,
    /// deactivated). The floor is rescanned only if this listing held it.
    /// The single place an active listing is retired: marks it inactive,
    /// drops the bot index and decrements the global and per-seller counts.
    /// Idempotent, because an escrow exit's `bot_nft.transfer` already calls
    /// back into `on_bot_moved` before the outer path gets here (#915).
    /// Returns whether this call did the deactivation.
    fn deactivate_listing(env: &Env, listing_id: u64) -> bool {
        let key = DataKey::Listing(listing_id);
        let mut listing: Listing = match env.storage().persistent().get(&key) {
            Some(l) => l,
            None => return false,
        };
        if !listing.active {
            return false;
        }
        listing.active = false;
        env.storage().persistent().set(&key, &listing);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .persistent()
            .remove(&DataKey::BotListing(listing.bot_id));
        Self::on_listing_removed(env, &listing);
        Self::decrement_user_active_listing_count(env, &listing.seller);
        true
    }

    fn on_listing_removed(env: &Env, listing: &Listing) {
        Self::write_active_listing_count(env, Self::active_listing_count(env).saturating_sub(1));
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
        stats.sale_count = stats
            .sale_count
            .checked_add(1)
            .ok_or(MarketplaceError::Overflow)?;
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
    fn append_listing_id(env: &Env, listing_id: u64) -> Result<(), MarketplaceError> {
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
            let next_count = count.checked_add(1).ok_or(MarketplaceError::Overflow)?;
            env.storage()
                .instance()
                .set(&DataKey::PageCount, &next_count);
        }
        page.push_back(listing_id);
        let key = DataKey::ListingPage(page_no);
        env.storage().persistent().set(&key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
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

    /// Appends to the buyer's history. Only the last page is rewritten, so the
    /// cost per purchase stays flat as the history grows (#916).
    fn add_user_purchase(env: &Env, buyer: &Address, purchase: Purchase) {
        let count_key = DataKey::UserPurchaseCount(buyer.clone());
        let count = Self::user_purchase_count(env, buyer);
        let page_key = DataKey::UserPurchasePage(buyer.clone(), count / USER_HISTORY_PAGE_SIZE);
        let mut page: Vec<Purchase> = env
            .storage()
            .persistent()
            .get::<_, Vec<Purchase>>(&page_key)
            .unwrap_or_else(|| Vec::new(env));
        page.push_back(purchase);
        env.storage().persistent().set(&page_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .persistent()
            .set(&count_key, &count.saturating_add(1));
        env.storage()
            .persistent()
            .extend_ttl(&count_key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Appends a listing id to the seller's paged history (#916).
    fn append_user_listing(env: &Env, seller: &Address, listing_id: u64) {
        let count_key = DataKey::UserListingCount(seller.clone());
        let count = Self::user_listing_count(env, seller);
        let page_key = DataKey::UserListingPage(seller.clone(), count / USER_HISTORY_PAGE_SIZE);
        let mut page: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&page_key)
            .unwrap_or_else(|| Vec::new(env));
        page.push_back(listing_id);
        env.storage().persistent().set(&page_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .persistent()
            .set(&count_key, &count.saturating_add(1));
        env.storage()
            .persistent()
            .extend_ttl(&count_key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn user_listing_count(env: &Env, seller: &Address) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::UserListingCount(seller.clone()))
            .unwrap_or(0)
    }

    fn user_purchase_count(env: &Env, buyer: &Address) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::UserPurchaseCount(buyer.clone()))
            .unwrap_or(0)
    }

    /// Listings for history indices `start..end`, in order. Loads one page at
    /// a time and skips ids whose listing record is gone.
    fn read_user_listings(env: &Env, seller: &Address, start: u32, end: u32) -> Vec<Listing> {
        let mut result: Vec<Listing> = Vec::new(env);
        let mut i = start;
        while i < end {
            let page_index = i / USER_HISTORY_PAGE_SIZE;
            let page: Vec<u64> = env
                .storage()
                .persistent()
                .get::<_, Vec<u64>>(&DataKey::UserListingPage(seller.clone(), page_index))
                .unwrap_or_else(|| Vec::new(env));
            let page_end = page_index
                .saturating_add(1)
                .saturating_mul(USER_HISTORY_PAGE_SIZE)
                .min(end);
            while i < page_end {
                if let Some(id) = page.get(i % USER_HISTORY_PAGE_SIZE) {
                    if let Some(listing) = env
                        .storage()
                        .persistent()
                        .get::<_, Listing>(&DataKey::Listing(id))
                    {
                        result.push_back(listing);
                    }
                }
                i += 1;
            }
        }
        result
    }

    /// Purchases for history indices `start..end`, in order, one page at a time.
    fn read_user_purchases(env: &Env, buyer: &Address, start: u32, end: u32) -> Vec<Purchase> {
        let mut result: Vec<Purchase> = Vec::new(env);
        let mut i = start;
        while i < end {
            let page_index = i / USER_HISTORY_PAGE_SIZE;
            let page: Vec<Purchase> = env
                .storage()
                .persistent()
                .get::<_, Vec<Purchase>>(&DataKey::UserPurchasePage(buyer.clone(), page_index))
                .unwrap_or_else(|| Vec::new(env));
            let page_end = page_index
                .saturating_add(1)
                .saturating_mul(USER_HISTORY_PAGE_SIZE)
                .min(end);
            while i < page_end {
                if let Some(purchase) = page.get(i % USER_HISTORY_PAGE_SIZE) {
                    result.push_back(purchase);
                }
                i += 1;
            }
        }
        result
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
        let allowed: Option<Vec<Address>> =
            env.storage().instance().get(&DataKey::AllowedCurrencies);
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
        env.events()
            .publish((Symbol::new(env, "currency_added"),), currency);
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
        env.events()
            .publish((Symbol::new(env, "currency_removed"),), currency);
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

#[cfg(test)]
mod bps_tests {
    use super::MarketplaceContract;

    #[test]
    fn bps_of_matches_multiply_then_divide_for_small_amounts() {
        for amount in 0..=20_000_i128 {
            for bps in [0_u32, 1, 25, 250, 9_999, 10_000] {
                let expected = amount * bps as i128 / 10_000;
                assert_eq!(MarketplaceContract::bps_of(amount, bps), Ok(expected));
            }
        }
    }

    #[test]
    fn bps_of_settles_prices_above_the_old_overflow_boundary() {
        let max = i128::MAX;
        assert_eq!(MarketplaceContract::bps_of(max, 0), Ok(0));
        assert_eq!(MarketplaceContract::bps_of(max, 10_000), Ok(max));

        // Just past `i128::MAX / 10_000`, where `price * bps` used to overflow.
        let boundary = max / 10_000 + 1;
        assert_eq!(MarketplaceContract::bps_of(boundary, 10_000), Ok(boundary));
        // 2.5% of `boundary` is exactly `boundary / 40` (floor identity).
        assert_eq!(
            MarketplaceContract::bps_of(boundary, 250),
            Ok(boundary / 40)
        );
    }
}
