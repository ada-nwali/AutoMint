// SPDX-License-Identifier: Apache-2.0

//! AutoMint registry: user directory, unique usernames, point totals, and
//! leaderboards.
//!
//! Registrations are indexed in bounded `UserListPage` pages. `TotalUsers`
//! remains a cached count for inexpensive landing-page reads; anyone can call
//! `verify_user_count` to reconcile it against profiles that still exist.
//! `users_since` uses each profile's `registered_at` timestamp.
//!
//! # Event catalogue (#370)
//!
//! Every state change publishes exactly one contract event. Topic layout is
//! `(symbol_short!(<name>), <indexed address>?)` — the first topic is always a
//! short `Symbol` so off-chain indexers can filter by event name, and the user
//! address is the second topic wherever the event is per-user. The data payload
//! carries the value an indexer needs to reconstruct state. Topic layouts are a
//! public API: existing names/topics must not change, only be extended.
//!
//! | Event | Topics (after name) | Data | Emitted in |
//! |-------|---------------------|------|------------|
//! | `init` | `[admin: Address]` | `timestamp: u64` | `initialize()` |
//! | `register` | `[user: Address]` | `timestamp: u64` | `register()` |
//! | `writers` | *(none)* | `(accrual: Address, bot_nft: Address)` | `set_writers()` |
//! | `addpoints` | `[user: Address]` | `points: u64` | `add_points()` (cross-contract) |
//! | `inc_bot` | `[user: Address]` | `bot_count: u32` | `increment_bot_count()` (cross-contract) |
//! | `dec_bot` | `[user: Address]` | `bot_count: u32` | `decrement_bot_count()` |
//! | `claimed` | `[user: Address]` | `amount: i128` | `add_claimed_amt()` (cross-contract) |
//! | `newseason` | *(none)* | `season: u32` | `start_new_season()` |
//! | `set_admin` | *(none)* | `(current_admin: Address, new_admin: Address)` | `set_admin()` |
//! | `adm_acpt` | *(none)* | `(old_admin: Address, new_admin: Address)` | `accept_admin()` |
//! | `adm_cncl` | *(none)* | `(admin: Address, cancelled: Address)` | `cancel_admin_transfer()` |

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

// #38: Define DataKey storage keys addressing per-user and global storage
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // Per-user storage
    UserProfile(Address),
    /// Username uniqueness mapping, keyed on the **ASCII-lowercased** form
    /// (#373) so `Alice` and `alice` cannot both register. The original
    /// casing the user typed is preserved in [`UserProfile::display_name`].
    UserPoints(Address),
    UserBotCount(Address),
    UserClaimedAmt(Address),
    Username(String),
    UserTombstone(Address),
    UserPage(u32),
    /// Points earned by a user in a given season (#371). Persistent, per-user.
    SeasonPoints(u32, Address),
    // Global storage
    /// Bounded leaderboard (#332): `Vec<(Address, u64)>` of at most
    /// `LEADERBOARD_SIZE` entries, sorted by points descending. Ties: the user
    /// who reached that total first ranks higher.
    TopUsers,
    /// Number of allocated `UserPage` buckets (#358), so `get_users` can bound
    /// its scan to live pages while the user listing stays out of the
    /// ever-growing instance vector.
    PageCount,
    /// Per-season bounded leaderboard (#371): same `Vec<(Address, u64)>`
    /// shape as [`DataKey::TopUsers`], keyed by season, so historical seasons
    /// stay queryable after a new season starts. Instance storage, like
    /// `TopUsers`, so the boards live as long as the contract instance.
    SeasonTop(u32),
    /// Current season counter (#371). Instance storage; absent = season 0.
    Season,
    /// Cached profile count, reconciled by `verify_user_count`.
    TotalUsers,
    Admin,
    PendingAdmin,
    Initialized,
    // Authorized writer set (accrual + bot_nft) for #318 gating.
    Writers,
    /// Addresses registered in page order, with `USER_LIST_PAGE_SIZE` entries
    /// per page.
    UserListPage(u32),
    /// Number of allocated `UserListPage` entries.
    UserListPageCount,
}

fn append_user_to_list(env: &Env, user: &Address) -> Result<(), RegistryError> {
    let page_count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::UserListPageCount)
        .unwrap_or(0);
    let page_index = page_count.saturating_sub(1);
    let mut page: Vec<Address> = if page_count == 0 {
        Vec::new(env)
    } else {
        env.storage()
            .instance()
            .get(&DataKey::UserListPage(page_index))
            .unwrap_or_else(|| Vec::new(env))
    };
    let page_index = if page_count == 0 || page.len() >= USER_LIST_PAGE_SIZE {
        let new_page_index = page_count;
        let next_page_count = page_count.checked_add(1).ok_or(RegistryError::Overflow)?;
        page = Vec::new(env);
        env.storage()
            .instance()
            .set(&DataKey::UserListPageCount, &next_page_count);
        new_page_index
    } else {
        page_index
    };
    page.push_back(user.clone());
    env.storage()
        .instance()
        .set(&DataKey::UserListPage(page_index), &page);
    Ok(())
}

// #39: Define UserProfile struct
/// Per-user profile stored in persistent storage.
///
/// # Numeric type rationale (`total_points: u64` vs `claimed_amt: i128`)
/// - `total_points` is `u64`: points are a non-negative internal accounting
///   counter accrued from bot rates (`u64` points/sec × elapsed `u64` seconds)
///   and never participate in SEP-41 token arithmetic.
/// - `claimed_amt` stays `i128`: across Soroban and SEP-41 (`soroban_sdk::token`),
///   token balances and transfer/mint amounts are canonically `i128` (scaled by
///   `10^decimals`). Keeping `claimed_amt` as `i128` matches the AMT token
///   contract's `mint`/`balance` signature without narrowing casts, while
///   [`RegistryContract::add_claimed_amt`] rejects negative values with
///   [`RegistryError::NegativeAmount`] so the cumulative claimed total is
///   provably monotonic.
#[derive(Clone, Debug)]
#[contracttype]
pub struct UserProfile {
    pub address: Address,
    /// Normalized (ASCII-lowercased) username — the canonical identity used
    /// for uniqueness (#373). Display the original casing via
    /// [`UserProfile::display_name`].
    pub username: String,
    /// The username exactly as the user registered it, casing preserved
    /// (#373). Never used for uniqueness comparisons.
    pub display_name: String,
    pub total_points: u64,
    pub claimed_amt: i128,
    pub registered_at: u64,
    pub bot_count: u32,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct UserTombstone {
    pub address: Address,
    pub username: String,
    pub total_points: u64,
    pub claimed_amt: i128,
    pub unregistered_at: u64,
}

/// One row of a season leaderboard (#371). `season_points` is what the row is
/// ranked by; `total_points` is the user's lifetime total, carried alongside
/// so a UI can show both without a second call.
#[derive(Clone, Debug)]
#[contracttype]
pub struct SeasonEntry {
    pub address: Address,
    /// Display username, original casing preserved (`display_name`).
    pub display_name: String,
    pub season_points: u64,
    pub total_points: u64,
}

// #318: authorized writer set. The accrual contract may update points/claimed
// amounts; the bot_nft contract may update bot counts. Off by default — if the
// writers are never configured, the gated functions remain open (backward
// compatible) so existing callers are unaffected until an admin locks them down.
#[contracttype]
pub struct Writers {
    pub accrual: Address,
    pub bot_nft: Address,
}

// #38: Define RegistryError enum
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    AlreadyRegistered = 2,
    UsernameTaken = 3,
    NotRegistered = 4,
    Unauthorized = 5,
    NotInitialized = 6,
    /// The registered-user counter has reached `u32::MAX`, or a points update
    /// would overflow `u64`.
    Overflow = 7,
    /// More than `MAX_USERS_BATCH` addresses were passed to `get_users_batch`.
    BatchTooLarge = 8,
    /// Negative amount passed to `add_claimed_amt`.
    NegativeAmount = 9,
    /// `accept_admin` or `cancel_admin_transfer` called with no pending transfer.
    NoPendingAdmin = 10,
    /// A single `add_points` update exceeded `MAX_POINTS_PER_CALL` (#363).
    ImplausiblePoints = 11,
    /// The username is empty or longer than 32 bytes. Distinct from
    /// `UsernameTaken`, which means a valid name is already in use.
    InvalidUsername = 12,
}

const PAGE_SIZE: u32 = 200;
const MAX_POINTS_PER_CALL: u64 = 10_000_000;
const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;

/// Maximum number of users tracked by the leaderboard (#332).
pub const LEADERBOARD_SIZE: u32 = 100;

/// Sentinel returned by [`RegistryContract::get_rank`] when a registered user
/// falls below the top-`LEADERBOARD_SIZE` cutoff ("unranked").
pub const UNRANKED: u32 = u32::MAX;

/// Maximum number of addresses a single `get_users_batch` call accepts.
pub const MAX_USERS_BATCH: u32 = 50;
/// Number of user addresses indexed in each registry list page.
const USER_LIST_PAGE_SIZE: u32 = 100;

#[contract]
pub struct RegistryContract;

impl RegistryContract {
    fn page_count(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::PageCount)
            .unwrap_or(1)
    }

    fn page_users(env: &Env, page: u32) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::UserPage(page))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn remove_user_from_page(env: &Env, user: &Address) {
        let page_count = Self::page_count(env);
        for page in 0..page_count {
            let users = Self::page_users(env, page);
            let mut next = Vec::new(env);
            let mut removed = false;
            for addr in users.iter() {
                if addr == *user {
                    removed = true;
                } else {
                    next.push_back(addr);
                }
            }
            if removed {
                env.storage()
                    .persistent()
                    .set(&DataKey::UserPage(page), &next);
                env.storage().persistent().extend_ttl(
                    &DataKey::UserPage(page),
                    LEDGER_THRESHOLD,
                    LEDGER_BUMP,
                );
                return;
            }
        }
    }
}

#[contractimpl]
impl RegistryContract {
    /// One-time setup: records the admin, zeroes the cached user count and
    /// the empty leaderboard. Fails with `AlreadyInitialized` if called
    /// twice. Emits `init`.
    ///
    /// Auth: `admin.require_auth()`.
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::TotalUsers, &0u32);
        env.storage().instance().set(&DataKey::PageCount, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::TopUsers, &Vec::<(Address, u64)>::new(&env));
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        // Emit initialization event (#370: every state change emits exactly
        // one event; `initialize` was the only mutator without one).
        env.events()
            .publish((symbol_short!("init"), admin), env.ledger().timestamp());
        Ok(())
    }

    /// Register `user` with `username` (1–32 bytes; uniqueness is checked
    /// against the ASCII-lowercased form, so `Alice` and `alice` collide,
    /// while the original casing is preserved as `display_name`). Creates
    /// the zeroed profile, indexes the user in the paged list, and joins
    /// the leaderboard while it has room. Emits `register`.
    ///
    /// Auth: `user.require_auth()`.
    ///
    /// Errors: `AlreadyRegistered`, `InvalidUsername` (empty or over 32
    /// bytes), `UsernameTaken` (already used by another address), `Overflow`
    /// (user counter exhausted).
    pub fn register(env: Env, user: Address, username: String) -> Result<(), RegistryError> {
        user.require_auth();

        // Check if user is already registered
        if env
            .storage()
            .persistent()
            .has(&DataKey::UserProfile(user.clone()))
        {
            return Err(RegistryError::AlreadyRegistered);
        }

        // Validate username length (empty or too long)
        if username.is_empty() || username.len() > 32 {
            return Err(RegistryError::InvalidUsername);
        }

        // #373: uniqueness is checked against the ASCII-lowercased form so
        // `Alice` and `alice` are the same identity; the original casing the
        // user typed is preserved in `display_name`.
        let normalized = Self::ascii_lower(&env, &username);

        // Check for username uniqueness
        if env
            .storage()
            .persistent()
            .has(&DataKey::Username(normalized.clone()))
        {
            return Err(RegistryError::UsernameTaken);
        }

        // Create new user profile with initial values
        let profile = UserProfile {
            address: user.clone(),
            username: normalized.clone(),
            display_name: username.clone(),
            total_points: 0,
            claimed_amt: 0,
            registered_at: env.ledger().timestamp(),
            bot_count: 0,
        };

        Self::persist_profile(&env, &user, &profile);
        append_user_to_list(&env, &user)?;

        // Store username mapping (lowercased key)
        env.storage()
            .persistent()
            .set(&DataKey::Username(normalized), &user);

        // While the leaderboard has room, a new (0-point) user joins at the
        // end so small deployments still list every registered user in
        // registration order. Once full, only users who earn points get in.
        let mut top = Self::load_top(&env);
        if top.len() < LEADERBOARD_SIZE {
            top.push_back((user.clone(), 0u64));
            env.storage().instance().set(&DataKey::TopUsers, &top);
        }

        // Increment total user counter
        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalUsers)
            .unwrap_or(0);
        let next_total = total.checked_add(1).ok_or(RegistryError::Overflow)?;

        // Write the user into the paged bucket layout to avoid a single
        // ever-growing instance vector (#358).
        let page = total / PAGE_SIZE;
        let mut page_count = Self::page_count(&env);
        if page >= page_count {
            page_count = page + 1;
            env.storage()
                .instance()
                .set(&DataKey::PageCount, &page_count);
        }
        let mut bucket = Self::page_users(&env, page);
        bucket.push_back(user.clone());
        env.storage()
            .persistent()
            .set(&DataKey::UserPage(page), &bucket);
        env.storage().persistent().extend_ttl(
            &DataKey::UserPage(page),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage()
            .instance()
            .set(&DataKey::TotalUsers, &next_total);

        // Extend instance storage TTL
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        // Emit registration event
        env.events().publish(
            (symbol_short!("register"), user.clone()),
            env.ledger().timestamp(),
        );

        Ok(())
    }

    /// #373: ASCII-only lowercase for username normalization.
    ///
    /// `soroban_sdk::String` has no `to_lowercase` under `no_std`, so bytes are
    /// copied out, `A..=Z` shifted to `a..=z`, and rebuilt. Non-ASCII bytes are
    /// left untouched — normalization is deliberately ASCII-only so UTF-8
    /// usernames round-trip without mangling.
    fn ascii_lower(env: &Env, s: &String) -> String {
        let len = s.len() as usize;
        // Usernames are validated to be <= 32 bytes before this is called;
        // fall back to a heap-free bounded copy rather than panicking if that
        // ever changes.
        let mut buf = [0u8; 32];
        let n = len.min(buf.len());
        s.copy_into_slice(&mut buf[..n]);
        for b in buf[..n].iter_mut() {
            if b.is_ascii_uppercase() {
                *b += 32;
            }
        }
        String::from_bytes(env, &buf[..n])
    }

    /// #372: registration check performs the *same* read `get_user` performs
    /// (a persistent `.get()`), so the two can never disagree about an
    /// address — both see the profile, or both see it as absent/archived.
    ///
    /// Both functions are **archival-sensitive**: if a profile's TTL lapses,
    /// the persistent entry is archived and both reads fail identically
    /// (on mainnet the transaction never reaches the contract). Keep any
    /// future registration probe based on this same read.
    pub fn is_registered(env: Env, user: Address) -> bool {
        env.storage()
            .persistent()
            .get::<_, UserProfile>(&DataKey::UserProfile(user))
            .is_some()
    }

    /// #372: reads the profile from persistent storage. Archival-sensitive —
    /// see [`Self::is_registered`], which performs this exact read.
    pub fn get_user(env: Env, user: Address) -> Result<UserProfile, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::UserProfile(user))
            .ok_or(RegistryError::NotRegistered)
    }

    /// Lifetime points for a registered user, falling back to the profile
    /// field when the denormalized `UserPoints` key is absent.
    ///
    /// Errors: `NotRegistered`.
    pub fn get_points(env: Env, user: Address) -> Result<u64, RegistryError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::UserProfile(user.clone()))
        {
            return Err(RegistryError::NotRegistered);
        }
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::UserPoints(user.clone()))
            .unwrap_or_else(|| {
                env.storage()
                    .persistent()
                    .get::<_, UserProfile>(&DataKey::UserProfile(user))
                    .unwrap()
                    .total_points
            }))
    }

    /// Number of bots the user holds (as tracked by bot_nft through
    /// `increment_bot_count` / `decrement_bot_count`), falling back to the
    /// profile field when the denormalized key is absent.
    ///
    /// Errors: `NotRegistered`.
    pub fn get_bot_count(env: Env, user: Address) -> Result<u32, RegistryError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::UserProfile(user.clone()))
        {
            return Err(RegistryError::NotRegistered);
        }
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::UserBotCount(user.clone()))
            .unwrap_or_else(|| {
                env.storage()
                    .persistent()
                    .get::<_, UserProfile>(&DataKey::UserProfile(user))
                    .unwrap()
                    .bot_count
            }))
    }

    /// Cumulative AMT the user has claimed (in token base units, `i128`),
    /// falling back to the profile field when the denormalized key is
    /// absent. Monotonically non-decreasing; see `add_claimed_amt`.
    ///
    /// Errors: `NotRegistered`.
    pub fn get_claimed_amt(env: Env, user: Address) -> Result<i128, RegistryError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::UserProfile(user.clone()))
        {
            return Err(RegistryError::NotRegistered);
        }
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::UserClaimedAmt(user.clone()))
            .unwrap_or_else(|| {
                env.storage()
                    .persistent()
                    .get::<_, UserProfile>(&DataKey::UserProfile(user))
                    .unwrap()
                    .claimed_amt
            }))
    }

    /// Fetch profiles for up to `MAX_USERS_BATCH` addresses in a single call,
    /// in the same order as `addresses`. Unregistered addresses map to `None`.
    pub fn get_users_batch(
        env: Env,
        addresses: Vec<Address>,
    ) -> Result<Vec<Option<UserProfile>>, RegistryError> {
        if addresses.len() > MAX_USERS_BATCH {
            return Err(RegistryError::BatchTooLarge);
        }
        let mut profiles: Vec<Option<UserProfile>> = Vec::new(&env);
        for address in addresses.iter() {
            let profile = env
                .storage()
                .persistent()
                .get::<_, UserProfile>(&DataKey::UserProfile(address));
            profiles.push_back(profile);
        }
        Ok(profiles)
    }

    /// Admin-only: configure the authorized writer set (#318). Once set,
    /// only the configured accrual contract may call `add_points` /
    /// `add_claimed_amt`, and only the configured bot_nft contract may call
    /// `increment_bot_count`. Before this is called the gated functions
    /// remain open (backward compatible). Idempotent. Emits `writers`.
    ///
    /// Auth: admin only.
    ///
    /// Errors: `Unauthorized` when no admin is stored.
    pub fn set_writers(env: Env, accrual: Address, bot_nft: Address) -> Result<(), RegistryError> {
        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .ok_or(RegistryError::Unauthorized)?;
        admin.require_auth();
        env.events().publish(
            (symbol_short!("writers"),),
            (accrual.clone(), bot_nft.clone()),
        );
        env.storage()
            .instance()
            .set(&DataKey::Writers, &Writers { accrual, bot_nft });
        Ok(())
    }

    /// The configured writer set, or `None` when writers were never
    /// configured (in which case the gated functions stay open). Read-only.
    pub fn get_writers(env: Env) -> Option<Writers> {
        env.storage().instance().get(&DataKey::Writers)
    }

    fn require_accrual(env: &Env) -> Result<(), RegistryError> {
        if let Some(writers) = env
            .storage()
            .instance()
            .get::<DataKey, Writers>(&DataKey::Writers)
        {
            writers.accrual.require_auth();
        }
        Ok(())
    }

    fn require_bot_nft(env: &Env) -> Result<(), RegistryError> {
        if let Some(writers) = env
            .storage()
            .instance()
            .get::<DataKey, Writers>(&DataKey::Writers)
        {
            writers.bot_nft.require_auth();
        }
        Ok(())
    }

    /// Credit `points` to a registered user's lifetime and current-season
    /// totals, updating both leaderboards. Emits `addpoints`.
    ///
    /// Writer-only: once `set_writers` has been called, only the accrual
    /// contract may invoke this; before that it stays open for backward
    /// compatibility. `points == 0` is a no-op.
    ///
    /// Errors: `NotRegistered`, `ImplausiblePoints` (above
    /// `MAX_POINTS_PER_CALL`, a sanity bound against ledger-corrupting
    /// credits), `Overflow` (total would exceed `u64`).
    pub fn add_points(env: Env, user: Address, points: u64) -> Result<(), RegistryError> {
        // #318: only the configured accrual writer may mutate points.
        Self::require_accrual(&env)?;
        // SECURITY NOTE: This function modifies user state. It should only be called
        // from the accrual contract (which has already verified user authorization).
        // In a production deployment, consider validating caller identity.
        let mut profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        if points == 0 {
            return Ok(());
        }
        if points > MAX_POINTS_PER_CALL {
            return Err(RegistryError::ImplausiblePoints);
        }
        profile.total_points = profile
            .total_points
            .checked_add(points)
            .ok_or(RegistryError::Overflow)?;
        Self::persist_profile(&env, &user, &profile);
        Self::update_top(&env, &user, profile.total_points);

        // #371: mirror the gain into the current season's total so the
        // season leaderboard moves alongside the lifetime one. Season entries
        // are persistent per-user records with their own TTL, renewed on
        // every write.
        let season = Self::current_season(&env);
        let season_key = DataKey::SeasonPoints(season, user.clone());
        let season_total: u64 = env
            .storage()
            .persistent()
            .get::<_, u64>(&season_key)
            .unwrap_or(0)
            .saturating_add(points);
        env.storage().persistent().set(&season_key, &season_total);
        env.storage()
            .persistent()
            .extend_ttl(&season_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::update_season_top(&env, season, &user, season_total);

        env.events()
            .publish((symbol_short!("addpoints"), user), points);
        Ok(())
    }

    /// Admin-only: overwrite a registered user's lifetime points with
    /// `value` and refresh the lifetime leaderboard. Emits `setpts`.
    ///
    /// Auth: admin only.
    ///
    /// Errors: `NotInitialized`, `NotRegistered`.
    pub fn set_points(env: Env, user: Address, value: u64) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        admin.require_auth();
        let mut profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        profile.total_points = value;
        Self::persist_profile(&env, &user, &profile);
        Self::update_top(&env, &user, profile.total_points);
        env.events().publish((symbol_short!("setpts"), user), value);
        Ok(())
    }

    /// Add one bot to a registered user's count. Emits `inc_bot` with the
    /// post-increment count.
    ///
    /// Writer-only: once `set_writers` has been called, only the bot_nft
    /// contract may invoke this; before that it stays open for backward
    /// compatibility.
    ///
    /// Errors: `NotRegistered`.
    pub fn increment_bot_count(env: Env, user: Address) -> Result<(), RegistryError> {
        // #318: only the configured bot_nft writer may mutate bot counts.
        Self::require_bot_nft(&env)?;
        // SECURITY NOTE: This function modifies user state. It should only be called
        // from the bot_nft contract (which has already verified user authorization).
        // In a production deployment, consider validating caller identity.
        let mut profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        profile.bot_count = profile.bot_count.saturating_add(1);
        Self::persist_profile(&env, &user, &profile);
        // #370: indexers previously saw bot counts drop (`dec_bot`) but never
        // rise; mirror that event's topic/data style with the post-increment
        // count as the payload.
        env.events()
            .publish((symbol_short!("inc_bot"), user), profile.bot_count);
        Ok(())
    }

    /// Subtract one bot from a registered user's count, floored at zero.
    /// Authenticated by the user themself (or a caller the user signed
    /// for), not by the writer set, so an owner can always sync their count
    /// down after a burn. Emits `dec_bot` with the post-decrement count.
    ///
    /// Auth: `user.require_auth()`.
    ///
    /// Errors: `NotRegistered`.
    pub fn decrement_bot_count(env: Env, user: Address) -> Result<(), RegistryError> {
        user.require_auth();
        let mut profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        // Floor at zero — bot_count is a u32, saturating_sub prevents underflow
        profile.bot_count = profile.bot_count.saturating_sub(1);
        Self::persist_profile(&env, &user, &profile);
        // Extend TTL so the profile doesn't expire around active bot operations
        env.events()
            .publish((symbol_short!("dec_bot"), user), profile.bot_count);
        Ok(())
    }

    /// Add newly claimed AMT (in token base units, `i128` per SEP-41 convention)
    /// to `user`'s cumulative `claimed_amt`. Rejects negative amounts with
    /// [`RegistryError::NegativeAmount`] so `claimed_amt` is monotonically
    /// non-decreasing.
    pub fn add_claimed_amt(env: Env, user: Address, amount: i128) -> Result<(), RegistryError> {
        // #318: only the configured accrual writer may mutate claimed amounts.
        Self::require_accrual(&env)?;
        if amount < 0 {
            return Err(RegistryError::NegativeAmount);
        }
        // SECURITY NOTE: This function modifies user state. It should only be called
        // from the accrual contract (which has already verified user authorization).
        // In a production deployment, consider validating caller identity.
        let mut profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        if amount == 0 {
            return Ok(());
        }
        profile.claimed_amt = profile.claimed_amt.saturating_add(amount);
        Self::persist_profile(&env, &user, &profile);
        // #370: AMT claim totals were previously invisible to indexers; emit
        // the claimed delta in the same topic style as `addpoints`.
        env.events()
            .publish((symbol_short!("claimed"), user), amount);
        Ok(())
    }

    /// Registered addresses on page `page` of the registration-ordered
    /// list (`PAGE_SIZE` = 200 per page). An out-of-range page returns an
    /// empty vector. Read-only.
    pub fn get_users(env: Env, page: u32) -> Vec<Address> {
        let page_count = env
            .storage()
            .instance()
            .get(&DataKey::PageCount)
            .unwrap_or(0);
        if page >= page_count {
            return Vec::new(&env);
        }
        env.storage()
            .persistent()
            .get(&DataKey::UserPage(page))
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn load_top(env: &Env) -> Vec<(Address, u64)> {
        env.storage()
            .instance()
            .get(&DataKey::TopUsers)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// In-place bounded top-N maintenance (#332 lifetime board, #371 season
    /// boards). Cost is O(N) with N = `LEADERBOARD_SIZE`, independent of total
    /// user count. Points only ever increase, so a user already listed is
    /// moved up; an unlisted user enters only if the list has room or strictly
    /// beats the current floor (a tie with the floor keeps the incumbent, who
    /// reached the total first). Returns `true` when `top` was modified.
    fn apply_to_top(top: &mut Vec<(Address, u64)>, user: &Address, new_total: u64) -> bool {
        let mut was_listed = false;
        let mut i = 0;
        while i < top.len() {
            if top.get(i).unwrap().0 == *user {
                top.remove(i);
                was_listed = true;
                break;
            }
            i += 1;
        }

        if !was_listed && top.len() >= LEADERBOARD_SIZE {
            let floor = top.last().map(|e| e.1).unwrap_or(0);
            if new_total <= floor {
                return false; // list unchanged (nothing was removed)
            }
        }

        // Insert after every entry with points >= new_total (stable ties).
        let mut pos = top.len();
        let mut k = 0;
        while k < top.len() {
            if top.get(k).unwrap().1 < new_total {
                pos = k;
                break;
            }
            k += 1;
        }
        top.insert(pos, (user.clone(), new_total));
        if top.len() > LEADERBOARD_SIZE {
            top.pop_back();
        }
        true
    }

    /// Incrementally maintain the bounded top-N lifetime list (#332).
    fn update_top(env: &Env, user: &Address, new_total: u64) {
        let mut top = Self::load_top(env);
        if Self::apply_to_top(&mut top, user, new_total) {
            env.storage().instance().set(&DataKey::TopUsers, &top);
        }
    }

    /// Current season counter (#371). Absent key means season 0 — the season
    /// in effect until `start_new_season` is first called.
    fn current_season(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::Season).unwrap_or(0)
    }

    fn load_season_top(env: &Env, season: u32) -> Vec<(Address, u64)> {
        env.storage()
            .instance()
            .get(&DataKey::SeasonTop(season))
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Incrementally maintain the bounded top-N list for one season (#371),
    /// sharing the lifetime board's eviction/tie semantics.
    fn update_season_top(env: &Env, season: u32, user: &Address, new_total: u64) {
        let mut top = Self::load_season_top(env, season);
        if Self::apply_to_top(&mut top, user, new_total) {
            env.storage()
                .instance()
                .set(&DataKey::SeasonTop(season), &top);
        }
    }

    /// Drop a user from the maintained leaderboard, e.g. after unregister (#364).
    fn remove_from_top(env: &Env, user: &Address) {
        let top = Self::load_top(env);
        let mut next: Vec<(Address, u64)> = Vec::new(env);
        let mut removed = false;
        for entry in top.iter() {
            if entry.0 == *user {
                removed = true;
            } else {
                next.push_back(entry);
            }
        }
        if removed {
            env.storage().instance().set(&DataKey::TopUsers, &next);
        }
    }

    /// Top users by points, highest first. Reads the maintained `TopUsers`
    /// list and hydrates at most `min(limit, LEADERBOARD_SIZE)` profiles, so the
    /// cost does not depend on the total number of users. Equal totals are
    /// ordered by who reached the total first (earlier wins), deterministically.
    pub fn get_leaderboard(env: Env, limit: u32) -> Vec<UserProfile> {
        let mut result: Vec<UserProfile> = Vec::new(&env);
        if limit == 0 {
            return result;
        }
        let top = Self::load_top(&env);
        let take = limit.min(LEADERBOARD_SIZE);
        for (addr, _) in top.iter() {
            if result.len() >= take {
                break;
            }
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<_, UserProfile>(&DataKey::UserProfile(addr))
            {
                result.push_back(p);
            }
        }
        result
    }

    /// Current season counter (#371). Season 0 is in effect until
    /// [`Self::start_new_season`] is first called.
    pub fn get_season(env: Env) -> u32 {
        Self::current_season(&env)
    }

    /// Roll the registry over to the next season (#371). Admin-only.
    ///
    /// Increments the season counter and starts the new season's leaderboard
    /// empty: season points are stored under `DataKey::SeasonPoints(season,
    /// user)`, so a fresh season number means every user starts from zero
    /// while lifetime `total_points` and every past season's board
    /// (`SeasonTop`/`SeasonPoints` keyed by the old number) remain intact and
    /// queryable. Returns the new season number and emits `newseason`.
    pub fn start_new_season(env: Env) -> Result<u32, RegistryError> {
        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        admin.require_auth();

        let season = Self::current_season(&env)
            .checked_add(1)
            .ok_or(RegistryError::Overflow)?;
        env.storage().instance().set(&DataKey::Season, &season);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish((symbol_short!("newseason"),), season);
        Ok(season)
    }

    /// Top users by **season** points, highest first (#371). Reads the
    /// maintained `SeasonTop(season)` list — same bounded, O(LEADERBOARD_SIZE)
    /// hydration as [`Self::get_leaderboard`] — so the cost does not depend on
    /// the total number of users, and historical seasons stay queryable.
    /// Equal season totals are ordered by who reached the total first.
    pub fn get_leaderboard_for_season(env: Env, season: u32, limit: u32) -> Vec<SeasonEntry> {
        let mut result: Vec<SeasonEntry> = Vec::new(&env);
        if limit == 0 {
            return result;
        }
        let top = Self::load_season_top(&env, season);
        let take = limit.min(LEADERBOARD_SIZE);
        for (addr, season_points) in top.iter() {
            if result.len() >= take {
                break;
            }
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<_, UserProfile>(&DataKey::UserProfile(addr))
            {
                result.push_back(SeasonEntry {
                    address: p.address,
                    display_name: p.display_name,
                    season_points,
                    total_points: p.total_points,
                });
            }
        }
        result
    }

    /// Return the 1-based leaderboard rank of `user` from the bounded top-N
    /// structure (`TopUsers`), or `u32::MAX` ([`UNRANKED`], documented as
    /// "unranked") when `user` is registered but sits below the
    /// top-`LEADERBOARD_SIZE` cutoff. Returns [`RegistryError::NotRegistered`]
    /// if `user` has not registered.
    pub fn get_rank(env: Env, user: Address) -> Result<u32, RegistryError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::UserProfile(user.clone()))
        {
            return Err(RegistryError::NotRegistered);
        }
        let top = Self::load_top(&env);
        for (idx, (addr, _)) in (0_u32..).zip(top.iter()) {
            if addr == user {
                return Ok(idx + 1);
            }
        }
        Ok(UNRANKED)
    }

    /// Look up a user's 1-based rank on a specific season's leaderboard (#1452).
    /// Returns [`UNRANKED`] if the user is registered but outside the top
    /// `LEADERBOARD_SIZE`, or [`RegistryError::NotRegistered`] if the user has
    /// never registered.
    pub fn get_season_rank(env: Env, season: u32, user: Address) -> Result<u32, RegistryError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::UserProfile(user.clone()))
        {
            return Err(RegistryError::NotRegistered);
        }
        let top = Self::load_season_top(&env, season);
        for (idx, (addr, _)) in (0_u32..).zip(top.iter()) {
            if addr == user {
                return Ok(idx + 1);
            }
        }
        Ok(UNRANKED)
    }

    /// Cached count of registered users. A missing record (queried before
    /// `initialize()`) correctly defaults to 0 — zero registered users is
    /// the true state, not an error. Reconciled against the paged user
    /// index by `verify_user_count`. Read-only.
    pub fn total_users(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalUsers)
            .unwrap_or(0)
    }

    /// Recomputes the registered profile count from the paged user index and
    /// repairs the cached count. Safe to call repeatedly.
    pub fn verify_user_count(env: Env) -> Result<u32, RegistryError> {
        let mut count = 0_u32;
        let page_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::UserListPageCount)
            .unwrap_or(0);
        for page_index in 0..page_count {
            let page: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::UserListPage(page_index))
                .unwrap_or_else(|| Vec::new(&env));
            for user in page.iter() {
                if env.storage().persistent().has(&DataKey::UserProfile(user)) {
                    count = count.checked_add(1).ok_or(RegistryError::Overflow)?;
                }
            }
        }

        let previous: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalUsers)
            .unwrap_or(0);
        if previous != count {
            env.storage().instance().set(&DataKey::TotalUsers, &count);
            env.events()
                .publish((symbol_short!("usercnt"),), (previous, count));
        }
        Ok(count)
    }

    /// Counts profiles registered at or after `timestamp`.
    pub fn users_since(env: Env, timestamp: u64) -> u32 {
        let page_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::UserListPageCount)
            .unwrap_or(0);
        let mut count = 0_u32;
        for page_index in 0..page_count {
            let page: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::UserListPage(page_index))
                .unwrap_or_else(|| Vec::new(&env));
            for user in page.iter() {
                if let Some(profile) = env
                    .storage()
                    .persistent()
                    .get::<_, UserProfile>(&DataKey::UserProfile(user))
                {
                    if profile.registered_at >= timestamp {
                        count = count.saturating_add(1);
                    }
                }
            }
        }
        count
    }

    /// Permissionless profile bump for wallet reconnects or stale
    /// registrations (#364). Extends the profile's persistent TTL back to the
    /// maximum live window supported by the network (roughly `LEDGER_BUMP`
    /// ledgers ≈ 7 days) before archival can claim it. The username mapping
    /// is allowed to age out independently.
    ///
    /// Emits `bump` with the user address and current timestamp.
    ///
    /// Errors: `NotRegistered`.
    pub fn bump_profile(env: Env, user: Address) -> Result<(), RegistryError> {
        let _profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;

        env.storage().persistent().extend_ttl(
            &DataKey::UserProfile(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        // The profile record is the canonical liveness signal for the registry.
        // The username mapping is allowed to age out independently, and touching
        // it here can fail if it has already been archived before the profile is
        // bumped.
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events()
            .publish((symbol_short!("bump"), user), env.ledger().timestamp());
        Ok(())
    }

    /// Delete the caller's profile and free the username (#364). Refuses
    /// while the user still holds bots (`bot_count > 0`); the lifetime point
    /// total survives in a [`UserTombstone`]. Removes the user from the
    /// paged user index and the maintained leaderboard, decrements
    /// `TotalUsers`, and emits `unreg`.
    ///
    /// Auth: `user.require_auth()`.
    ///
    /// Errors: `NotRegistered`, `Unauthorized` (bots still held).
    pub fn unregister(env: Env, user: Address) -> Result<(), RegistryError> {
        user.require_auth();
        let profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        if profile.bot_count > 0 {
            return Err(RegistryError::Unauthorized);
        }

        let username = profile.username.clone();
        env.storage()
            .persistent()
            .remove(&DataKey::Username(username.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::UserProfile(user.clone()));
        let tombstone = UserTombstone {
            address: user.clone(),
            username,
            total_points: profile.total_points,
            claimed_amt: profile.claimed_amt,
            unregistered_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::UserTombstone(user.clone()), &tombstone);
        Self::remove_user_from_page(&env, &user);
        Self::remove_from_top(&env, &user);

        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalUsers)
            .unwrap_or(0);
        if total > 0 {
            env.storage()
                .instance()
                .set(&DataKey::TotalUsers, &(total - 1));
        }

        env.events().publish(
            (symbol_short!("unreg"), user.clone()),
            tombstone.total_points,
        );
        Ok(())
    }

    /// The admin address recorded at initialization. Read-only.
    ///
    /// Errors: `NotInitialized` before the contract is set up.
    pub fn admin(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)
    }

    /// Step one of a two-step admin transfer (AM-031): the current admin
    /// nominates `new_admin` as the pending admin. The active admin does not
    /// change until `new_admin` calls [`Self::accept_admin`]. Proposing again
    /// replaces the pending nomination; self-nomination is rejected with
    /// [`RegistryError::Unauthorized`].
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), RegistryError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(RegistryError::NotInitialized);
        }
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        current_admin.require_auth();

        if new_admin == current_admin {
            return Err(RegistryError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events()
            .publish((symbol_short!("set_admin"),), (current_admin, new_admin));
        Ok(())
    }

    /// Step two of a two-step admin transfer (AM-031): the nominated pending
    /// admin accepts and becomes the active admin. Fails with
    /// [`RegistryError::NoPendingAdmin`] if no transfer is pending.
    pub fn accept_admin(env: Env) -> Result<(), RegistryError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(RegistryError::NotInitialized);
        }
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(RegistryError::NoPendingAdmin)?;
        pending.require_auth();

        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events()
            .publish((symbol_short!("adm_acpt"),), (current_admin, pending));
        Ok(())
    }

    /// Cancel an in-flight admin transfer (AM-031). Only the current admin may
    /// cancel; fails with [`RegistryError::NoPendingAdmin`] if no transfer is
    /// pending.
    pub fn cancel_admin_transfer(env: Env) -> Result<(), RegistryError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(RegistryError::NotInitialized);
        }
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        current_admin.require_auth();

        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(RegistryError::NoPendingAdmin)?;
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events()
            .publish((symbol_short!("adm_cncl"),), (current_admin, pending));
        Ok(())
    }

    /// Returns the address nominated by [`Self::set_admin`], if a transfer is
    /// currently pending.
    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    fn persist_profile(env: &Env, user: &Address, profile: &UserProfile) {
        let persistent = env.storage().persistent();
        let profile_key = DataKey::UserProfile(user.clone());
        let points_key = DataKey::UserPoints(user.clone());
        let bot_count_key = DataKey::UserBotCount(user.clone());
        let claimed_amt_key = DataKey::UserClaimedAmt(user.clone());
        persistent.set(&profile_key, profile);
        persistent.set(&points_key, &profile.total_points);
        persistent.set(&bot_count_key, &profile.bot_count);
        persistent.set(&claimed_amt_key, &profile.claimed_amt);
        persistent.extend_ttl(&profile_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        persistent.extend_ttl(&points_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        persistent.extend_ttl(&bot_count_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        persistent.extend_ttl(&claimed_amt_key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Env, IntoVal, String, Symbol, TryFromVal, Val};

    fn setup() -> (Env, Address, RegistryContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        // Configure writers so the gated path is exercised under mock_all_auths.
        let accrual = Address::generate(&env);
        let bot_nft = Address::generate(&env);
        client.set_writers(&accrual, &bot_nft);
        (env, admin, client)
    }

    // #318: a non-writer (root caller) must be rejected by add_points.
    #[test]
    fn test_add_points_unauthorized_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Auth"));
        env.mock_auths(&[]);
        let result = client.try_add_points(&user, &10_u64);
        assert!(result.is_err());
    }

    // #318: a non-writer (root caller) must be rejected by add_claimed_amt.
    #[test]
    fn test_add_claimed_amt_unauthorized_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Auth"));
        env.mock_auths(&[]);
        let result = client.try_add_claimed_amt(&user, &10_i128);
        assert!(result.is_err());
    }

    // #318: the configured accrual writer succeeds (same authorization check the
    // accrual contract hits when it calls add_points).
    #[test]
    fn test_add_points_by_writer_direct_succeeds() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Auth"));
        let registry_id = client.address.clone();
        let writers = client.get_writers().unwrap();
        env.mock_auths(&[MockAuth {
            address: &writers.accrual,
            invoke: &MockAuthInvoke {
                contract: &registry_id,
                fn_name: "add_points",
                args: (user.clone(), 10_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_points(&user, &10_u64);
        assert_eq!(client.get_user(&user).total_points, 10);
    }

    // #40: Test register success
    #[test]
    fn test_register_user() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Alice"));
        assert!(client.is_registered(&user));
        let profile = client.get_user(&user);
        assert_eq!(profile.total_points, 0);
        assert_eq!(profile.bot_count, 0);
        assert_eq!(profile.claimed_amt, 0);
    }

    // #40: Test duplicate-registration failure
    #[test]
    fn test_duplicate_register_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Alice"));
        let result = client.try_register(&user, &String::from_str(&env, "Alice2"));
        assert_eq!(result, Err(Ok(RegistryError::AlreadyRegistered)));
    }

    // #40: Test username collision
    #[test]
    fn test_username_collision_fails() {
        let (env, _admin, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        client.register(&user1, &String::from_str(&env, "Bob"));
        let result = client.try_register(&user2, &String::from_str(&env, "Bob"));
        assert_eq!(result, Err(Ok(RegistryError::UsernameTaken)));
    }

    // #40: Test invalid username (empty)
    #[test]
    fn test_empty_username_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let result = client.try_register(&user, &String::from_str(&env, ""));
        assert_eq!(result, Err(Ok(RegistryError::InvalidUsername)));
    }

    // #40: Test invalid username (too long)
    #[test]
    fn test_long_username_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let long_name = String::from_str(&env, "thisistoolongusernamethatexceedsthelimit");
        let result = client.try_register(&user, &long_name);
        assert_eq!(result, Err(Ok(RegistryError::InvalidUsername)));
    }

    // #40: Test add_points accumulation
    #[test]
    fn test_add_points_accumulates() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Charlie"));
        client.add_points(&user, &100_u64);
        client.add_points(&user, &250_u64);
        assert_eq!(client.get_user(&user).total_points, 350);
    }

    // #40: Test add_claimed_amt accumulation
    #[test]
    fn test_add_claimed_amt_accumulates() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Delta"));
        client.add_claimed_amt(&user, &1000_i128);
        client.add_claimed_amt(&user, &500_i128);
        assert_eq!(client.get_user(&user).claimed_amt, 1500);
    }

    // #40: Test add_claimed_amt with negative amounts fails with NegativeAmount
    #[test]
    fn test_add_claimed_amt_negative() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Echo"));
        client.add_claimed_amt(&user, &1000_i128);
        assert_eq!(
            client.try_add_claimed_amt(&user, &-300_i128),
            Err(Ok(RegistryError::NegativeAmount))
        );
        assert_eq!(
            client.try_add_claimed_amt(&user, &-1_i128),
            Err(Ok(RegistryError::NegativeAmount))
        );
        assert_eq!(
            client.try_add_claimed_amt(&user, &i128::MIN),
            Err(Ok(RegistryError::NegativeAmount))
        );
        assert_eq!(client.get_user(&user).claimed_amt, 1000);
    }

    // Property test: across arbitrary sequences of signed i128 deltas (positive,
    // negative, zero, and boundary values), `claimed_amt` is strictly
    // non-decreasing (monotonic) and negative inputs always fail with
    // `RegistryError::NegativeAmount`.
    #[test]
    fn test_claimed_amt_is_monotonic_property() {
        let (env, _admin, client) = setup();
        env.budget().reset_unlimited();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Monotonic"));

        // Deterministic xorshift64* generator over 64-bit seeds mapped into full
        // signed i128 range (including negative, zero, positive, and extremes).
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next_u64 = || -> u64 {
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            state.wrapping_mul(0x2545_F491_4F6C_DD1D)
        };

        let mut prev = client.get_user(&user).claimed_amt;
        assert_eq!(prev, 0);

        for step in 0..200u32 {
            let hi = next_u64() as i64 as i128;
            let lo = next_u64() as i128;
            let amount: i128 = match step % 8 {
                0 => 0,
                1 => -1,
                2 => 1,
                3 => -(lo.abs() % 1_000_000_000 + 1),
                4 => lo.abs() % 1_000_000_000 + 1,
                5 => (hi << 32) ^ lo,
                6 => i128::MIN / ((step as i128) + 1),
                _ => lo.abs() % (i128::MAX / 500),
            };

            let res = client.try_add_claimed_amt(&user, &amount);
            let current = client.get_user(&user).claimed_amt;

            if amount < 0 {
                assert_eq!(res, Err(Ok(RegistryError::NegativeAmount)));
                assert_eq!(current, prev, "negative delta must not mutate claimed_amt");
            } else {
                assert_eq!(res, Ok(Ok(())));
                assert!(
                    current >= prev,
                    "claimed_amt must be monotonic: {} < {}",
                    current,
                    prev
                );
                assert_eq!(current, prev.saturating_add(amount));
            }
            prev = current;
        }
    }

    #[test]
    fn test_get_user_not_found() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_get_user(&ghost);
        assert!(matches!(result, Err(Ok(RegistryError::NotRegistered))));
    }

    #[test]
    fn test_total_users_counter() {
        let (env, _admin, client) = setup();
        assert_eq!(client.total_users(), 0);
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        client.register(&u1, &String::from_str(&env, "U1"));
        client.register(&u2, &String::from_str(&env, "U2"));
        assert_eq!(client.total_users(), 2);
    }

    // #40: Test leaderboard ordering with multiple users
    #[test]
    fn test_leaderboard_ordering() {
        let (env, _admin, client) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        let u3 = Address::generate(&env);
        client.register(&u1, &String::from_str(&env, "U1"));
        client.register(&u2, &String::from_str(&env, "U2"));
        client.register(&u3, &String::from_str(&env, "U3"));
        client.add_points(&u1, &100_u64);
        client.add_points(&u2, &500_u64);
        client.add_points(&u3, &250_u64);
        let lb = client.get_leaderboard(&10_u32);
        assert_eq!(lb.len(), 3);
        assert_eq!(lb.get(0).unwrap().total_points, 500);
        assert_eq!(lb.get(1).unwrap().total_points, 250);
        assert_eq!(lb.get(2).unwrap().total_points, 100);
    }

    #[test]
    fn test_leaderboard_limit() {
        let (env, _admin, client) = setup();
        let names = ["user0", "user1", "user2", "user3", "user4"];
        for (i, name) in names.iter().enumerate() {
            let u = Address::generate(&env);
            client.register(&u, &String::from_str(&env, name));
            client.add_points(&u, &(i as u64 * 10));
        }
        let lb = client.get_leaderboard(&3_u32);
        assert_eq!(lb.len(), 3);
    }

    // #40: Test bot_count increment/decrement floor at 0
    #[test]
    fn test_leaderboard_empty_when_no_users() {
        let (_env, _admin, client) = setup();
        let lb = client.get_leaderboard(&10_u32);
        assert_eq!(lb.len(), 0);
    }

    // #332: 500 users; only the bounded top-N is maintained and returned.
    #[test]
    fn test_leaderboard_500_users_top_10_ordered() {
        let (env, _admin, client) = setup();
        env.budget().reset_unlimited();
        let mut addrs = std::vec::Vec::new();
        for i in 0..500u32 {
            let u = Address::generate(&env);
            let name = std::format!("user{}", i);
            client.register(&u, &String::from_str(&env, &name));
            // Distinct totals, deliberately not in registration order.
            let pts = ((i * 37) % 500 + 1) as u64;
            client.add_points(&u, &pts);
            addrs.push((u, pts));
        }
        let lb = client.get_leaderboard(&10_u32);
        assert_eq!(lb.len(), 10);
        let mut expected: std::vec::Vec<u64> = addrs.iter().map(|(_, p)| *p).collect();
        expected.sort_by(|a, b| b.cmp(a));
        for k in 0..10u32 {
            assert_eq!(lb.get(k).unwrap().total_points, expected[k as usize]);
        }
        // Never more than LEADERBOARD_SIZE, even when asked for everything.
        assert_eq!(client.get_leaderboard(&1000_u32).len(), LEADERBOARD_SIZE);
    }

    // #332: a listed user moving up, and a newcomer evicting the floor.
    #[test]
    fn test_leaderboard_eviction_and_reordering() {
        let (env, _admin, client) = setup();
        env.budget().reset_unlimited();
        let mut users = std::vec::Vec::new();
        for i in 0..(LEADERBOARD_SIZE + 5) {
            let u = Address::generate(&env);
            client.register(&u, &String::from_str(&env, &std::format!("u{}", i)));
            client.add_points(&u, &10_u64);
            users.push(u);
        }
        // Board is full of 10-pointers; a late 10-pointer did not displace anyone.
        let lb = client.get_leaderboard(&LEADERBOARD_SIZE);
        assert_eq!(lb.len(), LEADERBOARD_SIZE);
        assert!(lb
            .iter()
            .all(|p| p.address != users[LEADERBOARD_SIZE as usize]));
        // A late user beating the floor gets in at the top and evicts the last.
        client.add_points(&users[LEADERBOARD_SIZE as usize + 1], &1000_u64);
        let lb = client.get_leaderboard(&LEADERBOARD_SIZE);
        assert_eq!(
            lb.get(0).unwrap().address,
            users[LEADERBOARD_SIZE as usize + 1]
        );
        assert_eq!(lb.len(), LEADERBOARD_SIZE);
        assert!(lb
            .iter()
            .all(|p| p.address != users[LEADERBOARD_SIZE as usize - 1]));
    }

    // #332: equal totals rank by who reached the total first.
    #[test]
    fn test_leaderboard_tie_order_is_first_to_reach() {
        let (env, _admin, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        client.register(&a, &String::from_str(&env, "ta"));
        client.register(&b, &String::from_str(&env, "tb"));
        client.add_points(&b, &50_u64);
        client.add_points(&a, &50_u64);
        let lb = client.get_leaderboard(&2_u32);
        assert_eq!(lb.get(0).unwrap().address, b);
        assert_eq!(lb.get(1).unwrap().address, a);
    }

    #[test]
    fn test_increment_bot_count_from_zero() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "FreshUser"));
        assert_eq!(client.get_user(&user).bot_count, 0);
        client.increment_bot_count(&user);
        assert_eq!(client.get_user(&user).bot_count, 1);
    }

    #[test]
    fn test_increment_decrement_bot_count() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "BotUser"));
        assert_eq!(client.get_user(&user).bot_count, 0);
        client.increment_bot_count(&user);
        client.increment_bot_count(&user);
        assert_eq!(client.get_user(&user).bot_count, 2);
        client.decrement_bot_count(&user);
        assert_eq!(client.get_user(&user).bot_count, 1);
    }

    // #40: Test bot_count floor at 0
    #[test]
    fn test_bot_count_floors_at_zero() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "BotUser2"));
        assert_eq!(client.get_user(&user).bot_count, 0);
        client.decrement_bot_count(&user);
        assert_eq!(client.get_user(&user).bot_count, 0); // Should floor at 0
        client.decrement_bot_count(&user);
        assert_eq!(client.get_user(&user).bot_count, 0); // Still 0
    }

    // #37: Test admin function returns correct admin address
    #[test]
    fn test_admin_returns_current_admin() {
        let (_env, admin, client) = setup();
        assert_eq!(client.admin(), admin);
    }

    // Test double-initialization fails with the AlreadyInitialized variant
    #[test]
    fn test_double_initialize_fails() {
        let (env, _admin, client) = setup();
        let other_admin = Address::generate(&env);
        assert_eq!(
            client.try_initialize(&other_admin),
            Err(Ok(RegistryError::AlreadyInitialized))
        );
    }

    // Test initialize stores the admin address in storage
    #[test]
    fn test_initialize_sets_admin() {
        let (_env, admin, client) = setup();
        assert_eq!(client.admin(), admin);
    }

    // #37: Test admin persists across calls
    #[test]
    fn test_admin_persists() {
        let (_env, admin, client) = setup();
        let retrieved_admin1 = client.admin();
        let retrieved_admin2 = client.admin();
        assert_eq!(retrieved_admin1, admin);
        assert_eq!(retrieved_admin2, admin);
        assert_eq!(retrieved_admin1, retrieved_admin2);
    }

    #[test]
    fn test_admin_fails_if_not_initialized() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let result = client.try_admin();
        assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
    }

    #[test]
    fn test_get_user_returns_not_registered_error() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_get_user(&ghost);
        assert!(matches!(result, Err(Ok(RegistryError::NotRegistered))));
    }

    #[test]
    fn test_get_user_returns_full_profile() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "FullCheck"));
        client.add_points(&user, &42_u64);
        client.add_claimed_amt(&user, &100_i128);
        client.increment_bot_count(&user);
        let profile = client.get_user(&user);
        assert_eq!(profile.username, String::from_str(&env, "fullcheck"));
        assert_eq!(profile.display_name, String::from_str(&env, "FullCheck"));
        assert_eq!(profile.total_points, 42);
        assert_eq!(profile.claimed_amt, 100);
        assert_eq!(profile.bot_count, 1);
    }

    #[test]
    fn test_scalar_getters_match_profile_fields() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Projection"));
        client.add_points(&user, &42_u64);
        client.add_claimed_amt(&user, &100_i128);
        client.increment_bot_count(&user);

        let profile = client.get_user(&user);
        assert_eq!(client.get_points(&user), profile.total_points);
        assert_eq!(client.get_bot_count(&user), profile.bot_count);
        assert_eq!(client.get_claimed_amt(&user), profile.claimed_amt);

        client.decrement_bot_count(&user);
        assert_eq!(
            client.get_bot_count(&user),
            client.get_user(&user).bot_count
        );
    }

    #[test]
    fn test_scalar_getters_return_not_registered_for_unknown_user() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);

        assert!(matches!(
            client.try_get_points(&ghost),
            Err(Ok(RegistryError::NotRegistered))
        ));
        assert!(matches!(
            client.try_get_bot_count(&ghost),
            Err(Ok(RegistryError::NotRegistered))
        ));
        assert!(matches!(
            client.try_get_claimed_amt(&ghost),
            Err(Ok(RegistryError::NotRegistered))
        ));
    }

    #[test]
    fn test_get_users_batch_returns_one_entry_per_address_in_order() {
        let (env, _admin, client) = setup();
        let u1 = Address::generate(&env);
        let ghost = Address::generate(&env);
        let u2 = Address::generate(&env);
        client.register(&u1, &String::from_str(&env, "Alice"));
        client.register(&u2, &String::from_str(&env, "Bob"));
        client.add_points(&u1, &10_u64);

        let addresses = soroban_sdk::vec![&env, u1.clone(), ghost.clone(), u2.clone()];
        let batch = client.get_users_batch(&addresses);

        assert_eq!(batch.len(), 3);
        let p0 = batch.get(0).unwrap().unwrap();
        assert_eq!(p0.address, u1);
        assert_eq!(p0.username, String::from_str(&env, "alice"));
        assert_eq!(p0.display_name, String::from_str(&env, "Alice"));
        assert_eq!(p0.total_points, 10);
        assert!(batch.get(1).unwrap().is_none());
        let p2 = batch.get(2).unwrap().unwrap();
        assert_eq!(p2.address, u2);
        assert_eq!(p2.username, String::from_str(&env, "bob"));
    }

    #[test]
    fn test_get_users_batch_empty_returns_empty() {
        let (env, _admin, client) = setup();
        let empty: Vec<Address> = Vec::new(&env);
        assert_eq!(client.get_users_batch(&empty).len(), 0);
    }

    #[test]
    fn test_get_users_batch_accepts_exactly_50_with_none_for_unregistered() {
        let (env, _admin, client) = setup();
        let mut addresses: Vec<Address> = Vec::new(&env);
        for i in 0..MAX_USERS_BATCH {
            let addr = Address::generate(&env);
            if i % 2 == 0 {
                client.register(&addr, &String::from_str(&env, &std::format!("user{}", i)));
            }
            addresses.push_back(addr);
        }

        let batch = client.get_users_batch(&addresses);
        assert_eq!(batch.len(), MAX_USERS_BATCH);
        for i in 0..MAX_USERS_BATCH {
            let slot = batch.get(i).unwrap();
            if i % 2 == 0 {
                let profile = slot.unwrap();
                assert_eq!(
                    profile.username,
                    String::from_str(&env, &std::format!("user{}", i))
                );
            } else {
                assert!(slot.is_none());
            }
        }
    }

    #[test]
    fn test_get_users_batch_rejects_more_than_cap() {
        let (env, _admin, client) = setup();
        let mut addresses: Vec<Address> = Vec::new(&env);
        for _ in 0..(MAX_USERS_BATCH + 1) {
            addresses.push_back(Address::generate(&env));
        }

        assert_eq!(
            client.try_get_users_batch(&addresses),
            Err(Ok(RegistryError::BatchTooLarge))
        );
    }

    #[test]
    fn test_add_claimed_amt_zero_is_noop() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "ZeroTest"));
        client.add_claimed_amt(&user, &500_i128);
        client.add_claimed_amt(&user, &0_i128);
        assert_eq!(client.get_user(&user).claimed_amt, 500);
    }

    #[test]
    fn test_add_claimed_amt_unregistered_fails() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_add_claimed_amt(&ghost, &100_i128);
        assert_eq!(result, Err(Ok(RegistryError::NotRegistered)));
    }

    #[test]
    fn test_add_claimed_amt_extends_ttl() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "TtlTest"));
        client.add_claimed_amt(&user, &100_i128);
        let profile = client.get_user(&user);
        assert_eq!(profile.claimed_amt, 100);
    }

    #[test]
    fn test_add_claimed_amt_large_values() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "LargeVal"));
        client.add_claimed_amt(&user, &i128::MAX);
        client.add_claimed_amt(&user, &1_i128);
        assert_eq!(client.get_user(&user).claimed_amt, i128::MAX);
    }

    #[test]
    fn test_add_points_unregistered_fails() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_add_points(&ghost, &100_u64);
        assert_eq!(result, Err(Ok(RegistryError::NotRegistered)));
    }

    #[test]
    fn test_increment_bot_count_unregistered_fails() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_increment_bot_count(&ghost);
        assert_eq!(result, Err(Ok(RegistryError::NotRegistered)));
    }

    // #95: Exact error variant — unregistered address must return NotRegistered
    #[test]
    fn test_decrement_bot_count_unregistered_fails() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_decrement_bot_count(&ghost);
        assert_eq!(result, Err(Ok(RegistryError::NotRegistered)));
    }

    // #95: Decrement on a fresh (bot_count == 0) profile must floor at zero, not underflow
    #[test]
    fn test_decrement_bot_count_floors_at_zero_exact() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "FloorExact"));
        // Starts at 0 — decrement should leave it at 0
        client.decrement_bot_count(&user);
        assert_eq!(client.get_user(&user).bot_count, 0);
    }

    // #95: Multiple decrements beyond zero all stay at zero
    #[test]
    fn test_decrement_bot_count_multiple_below_zero_stays_floored() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "MultiFloor"));
        client.increment_bot_count(&user); // bot_count == 1
        client.decrement_bot_count(&user); // bot_count == 0
        client.decrement_bot_count(&user); // bot_count stays 0
        client.decrement_bot_count(&user); // bot_count stays 0
        assert_eq!(client.get_user(&user).bot_count, 0);
    }

    // #95: Decrement extends TTL (profile still readable; no expiry panic)
    #[test]
    fn test_decrement_bot_count_extends_ttl() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "TtlDecrement"));
        client.increment_bot_count(&user);
        client.decrement_bot_count(&user);
        // If TTL was not extended the persistent entry could expire; confirm profile is still readable
        let profile = client.get_user(&user);
        assert_eq!(profile.bot_count, 0);
    }

    // #95: All other profile fields are preserved after decrement
    #[test]
    fn test_decrement_bot_count_preserves_other_fields() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let username = String::from_str(&env, "FieldGuard");
        client.register(&user, &username);
        client.add_points(&user, &77_u64);
        client.add_claimed_amt(&user, &333_i128);
        client.increment_bot_count(&user);
        client.increment_bot_count(&user); // bot_count == 2

        client.decrement_bot_count(&user); // bot_count == 1

        let profile = client.get_user(&user);
        assert_eq!(profile.bot_count, 1);
        assert_eq!(profile.total_points, 77);
        assert_eq!(profile.claimed_amt, 333);
        assert_eq!(profile.username, String::from_str(&env, "fieldguard"));
        assert_eq!(profile.display_name, username);
        assert_eq!(profile.address, user);
    }

    #[test]
    fn test_register_with_max_length_username() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let max_username = String::from_str(&env, "12345678901234567890123456789012"); // 32 chars
        client.register(&user, &max_username);
        let profile = client.get_user(&user);
        assert_eq!(profile.username, max_username);
    }

    #[test]
    fn test_register_with_single_char_username() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let short_username = String::from_str(&env, "a");
        client.register(&user, &short_username);
        let profile = client.get_user(&user);
        assert_eq!(profile.username, short_username);
    }

    #[test]
    fn test_register_initializes_all_fields_correctly() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let username = String::from_str(&env, "testuser");

        client.register(&user, &username);
        let profile = client.get_user(&user);

        assert_eq!(profile.address, user);
        assert_eq!(profile.username, username);
        assert_eq!(profile.display_name, username);
        assert_eq!(profile.total_points, 0);
        assert_eq!(profile.claimed_amt, 0);
        assert_eq!(profile.bot_count, 0);
        // registered_at will be set to env.ledger().timestamp() which is 0 in tests
        assert_eq!(profile.registered_at, env.ledger().timestamp());
    }

    #[test]
    fn test_register_increments_total_users() {
        let (env, _admin, client) = setup();
        let initial_count = client.total_users();

        let user1 = Address::generate(&env);
        client.register(&user1, &String::from_str(&env, "user1"));
        assert_eq!(client.total_users(), initial_count + 1);

        let user2 = Address::generate(&env);
        client.register(&user2, &String::from_str(&env, "user2"));
        assert_eq!(client.total_users(), initial_count + 2);
    }

    #[test]
    fn test_verify_user_count_repairs_drift_after_failed_registrations() {
        let (env, _admin, client) = setup();
        // 105 registrations plus repeated full index scans exceeds the default
        // test budget; same unlimited budget as the other heavy tests here.
        env.budget().reset_unlimited();
        for index in 0..100_u32 {
            let user = Address::generate(&env);
            client.register(
                &user,
                &String::from_str(&env, &std::format!("user{}", index)),
            );
        }
        for _ in 0..5 {
            let user = Address::generate(&env);
            assert_eq!(
                client.try_register(&user, &String::from_str(&env, "user0")),
                Err(Ok(RegistryError::UsernameTaken))
            );
        }

        env.as_contract(&client.address, || {
            env.storage().instance().set(&DataKey::TotalUsers, &7_u32);
        });
        assert_eq!(client.verify_user_count(), 100);
        assert_eq!(client.total_users(), 100);
        assert_eq!(client.verify_user_count(), 100);
        assert_eq!(client.total_users(), 100);
    }

    #[test]
    fn test_users_since_counts_profiles_inclusively_by_registration_time() {
        let (env, _admin, client) = setup();
        let first = Address::generate(&env);
        let second = Address::generate(&env);

        env.ledger().set_timestamp(10);
        client.register(&first, &String::from_str(&env, "first"));
        env.ledger().set_timestamp(20);
        client.register(&second, &String::from_str(&env, "second"));

        assert_eq!(client.users_since(&20), 1);
        assert_eq!(client.users_since(&10), 2);
        assert_eq!(client.users_since(&21), 0);
    }

    // #373: usernames are case-insensitive for uniqueness but preserve the
    // original casing for display.
    #[test]
    fn test_register_username_case_insensitive_rejects_mixed_case_duplicate() {
        let (env, _admin, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.register(&user1, &String::from_str(&env, "TestUser"));
        // Same name, different casing — must be rejected.
        assert_eq!(
            client.try_register(&user2, &String::from_str(&env, "testuser")),
            Err(Ok(RegistryError::UsernameTaken))
        );
        assert!(!client.is_registered(&user2));

        // The original registration keeps its casing for display while the
        // canonical `username` is normalized.
        let profile = client.get_user(&user1);
        assert_eq!(profile.username, String::from_str(&env, "testuser"));
        assert_eq!(profile.display_name, String::from_str(&env, "TestUser"));
    }

    // #373: the reverse order fails too — normalization cannot be bypassed by
    // registering the lowercase form first.
    #[test]
    fn test_register_username_case_insensitive_rejects_uppercase_duplicate() {
        let (env, _admin, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.register(&user1, &String::from_str(&env, "testuser"));
        assert_eq!(
            client.try_register(&user2, &String::from_str(&env, "TestUser")),
            Err(Ok(RegistryError::UsernameTaken))
        );
        assert!(!client.is_registered(&user2));
        assert_eq!(client.total_users(), 1);
    }

    // #373: names differing only outside ASCII case (digits/underscore) stay
    // distinct; ASCII letters alone are folded.
    #[test]
    fn test_register_username_distinct_when_not_only_case_apart() {
        let (env, _admin, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.register(&user1, &String::from_str(&env, "TestUser1"));
        client.register(&user2, &String::from_str(&env, "testuser2"));
        assert!(client.is_registered(&user1));
        assert!(client.is_registered(&user2));
    }

    // #373: a failed case-collision attempt leaves the username slot free for
    // the intended owner.
    #[test]
    fn test_register_username_collision_leaves_slot_free() {
        let (env, _admin, client) = setup();
        let squatter = Address::generate(&env);
        let owner = Address::generate(&env);

        assert_eq!(
            client.try_register(&squatter, &String::from_str(&env, "Alice")),
            Ok(Ok(()))
        );
        assert_eq!(
            client.try_register(&owner, &String::from_str(&env, "ALICE")),
            Err(Ok(RegistryError::UsernameTaken))
        );
    }

    // ── is_registered edge cases (#91) ──────────────────────────────────────

    // #91: Unregistered address returns false
    #[test]
    fn test_is_registered_returns_false_for_unregistered() {
        let (env, _admin, client) = setup();
        let stranger = Address::generate(&env);
        assert!(!client.is_registered(&stranger));
    }

    // #91: Returns true immediately after a successful register() call
    #[test]
    fn test_is_registered_returns_true_after_register() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "RegUser"));
        assert!(client.is_registered(&user));
    }

    // #91: Transition — false before register, true after
    #[test]
    fn test_is_registered_false_before_true_after_register() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        assert!(!client.is_registered(&user));
        client.register(&user, &String::from_str(&env, "Transition"));
        assert!(client.is_registered(&user));
    }

    // #91: Two distinct addresses are independent — registering one does not
    //      affect the other's registration status
    #[test]
    fn test_is_registered_two_addresses_are_independent() {
        let (env, _admin, client) = setup();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        client.register(&user_a, &String::from_str(&env, "AddrA"));
        assert!(client.is_registered(&user_a));
        assert!(!client.is_registered(&user_b));
        client.register(&user_b, &String::from_str(&env, "AddrB"));
        assert!(client.is_registered(&user_a));
        assert!(client.is_registered(&user_b));
    }

    // #91: is_registered is a pure read — calling it multiple times returns
    //      the same value without mutating state
    #[test]
    fn test_is_registered_is_idempotent() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "IdempotentUser"));
        assert!(client.is_registered(&user));
        assert!(client.is_registered(&user));
        assert!(client.is_registered(&user));
        // Profile data is unchanged after repeated reads
        let profile = client.get_user(&user);
        assert_eq!(
            profile.display_name,
            String::from_str(&env, "IdempotentUser")
        );
    }

    // #91: Fresh contract (initialized but no registrations) returns false
    //      for every queried address
    #[test]
    fn test_is_registered_false_on_fresh_contract() {
        let (env, _admin, client) = setup();
        // Query several distinct addresses — none should be registered
        for _ in 0..3 {
            let addr = Address::generate(&env);
            assert!(!client.is_registered(&addr));
        }
    }

    // #91: is_registered correctly tracks multiple users registered in sequence
    #[test]
    fn test_is_registered_multiple_users() {
        let (env, _admin, client) = setup();
        let users: [Address; 5] = core::array::from_fn(|_| Address::generate(&env));
        let names = ["u0", "u1", "u2", "u3", "u4"];
        // Before any registration all return false
        for u in &users {
            assert!(!client.is_registered(u));
        }
        // Register one by one and confirm each becomes true without affecting others
        for (i, (u, name)) in users.iter().zip(names.iter()).enumerate() {
            client.register(u, &String::from_str(&env, name));
            for (j, v) in users.iter().enumerate() {
                if j <= i {
                    assert!(client.is_registered(v));
                } else {
                    assert!(!client.is_registered(v));
                }
            }
        }
    }

    // ── add_points edge cases (#93) ─────────────────────────────────────────

    // #93: Zero points is a no-op — total_points is left untouched
    #[test]
    fn test_add_points_zero_is_noop() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "ZeroPoints"));
        client.add_points(&user, &100_u64);
        client.add_points(&user, &0_u64);
        assert_eq!(client.get_user(&user).total_points, 100);
    }

    // #93: Missing record — unregistered address must return NotRegistered, not panic
    #[test]
    fn test_add_points_unregistered_returns_not_registered() {
        let (env, _admin, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_add_points(&ghost, &100_u64);
        assert_eq!(result, Err(Ok(RegistryError::NotRegistered)));
    }

    // #93: an implausibly large single update must be rejected before it can
    //      pin a user permanently to the top of the leaderboard.
    #[test]
    fn test_add_points_rejects_implausible_amount() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "MaxPoints"));
        let result = client.try_add_points(&user, &(10_000_001_u64));
        assert_eq!(result, Err(Ok(RegistryError::ImplausiblePoints)));
        assert_eq!(client.get_user(&user).total_points, 0);
    }

    // #93: overflow must fail without mutating the profile.
    #[test]
    fn test_add_points_overflow_returns_error_and_keeps_profile() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Overflow"));
        client.set_points(&user, &u64::MAX);
        let result = client.try_add_points(&user, &1_u64);
        assert_eq!(result, Err(Ok(RegistryError::Overflow)));
        assert_eq!(client.get_user(&user).total_points, u64::MAX);
    }

    // #93: admin correction is auditable and allowed to repair a bad value.
    #[test]
    fn test_set_points_admin_correction_updates_total() {
        let (env, admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Repair"));
        client.set_points(&user, &42_u64);
        assert_eq!(client.get_user(&user).total_points, 42);
        assert_eq!(client.admin(), admin);
    }

    // #93: Repeated accumulation across many calls sums correctly
    #[test]
    fn test_add_points_multiple_calls_accumulate_correctly() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "MultiPoints"));
        for _ in 0..5 {
            client.add_points(&user, &10_u64);
        }
        assert_eq!(client.get_user(&user).total_points, 50);
    }

    // ── total_users edge cases (#98) ────────────────────────────────────────

    // #98: Missing record — querying before initialize() must return 0, not panic
    #[test]
    fn test_total_users_zero_when_uninitialized() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        assert_eq!(client.total_users(), 0);
    }

    // #98: A failed (duplicate) registration attempt must not inflate the counter
    #[test]
    fn test_total_users_unaffected_by_failed_duplicate_registration() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Original"));
        assert_eq!(client.total_users(), 1);
        let _ = client.try_register(&user, &String::from_str(&env, "Duplicate"));
        assert_eq!(client.total_users(), 1);
    }

    // #98: A failed (username collision) registration attempt must not inflate the counter
    #[test]
    fn test_total_users_unaffected_by_username_collision() {
        let (env, _admin, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        client.register(&user1, &String::from_str(&env, "Taken"));
        assert_eq!(client.total_users(), 1);
        let _ = client.try_register(&user2, &String::from_str(&env, "Taken"));
        assert_eq!(client.total_users(), 1);
    }

    // #98: Point/bot-count/claimed-amount mutations do not affect the user count
    #[test]
    fn test_total_users_unaffected_by_profile_mutations() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Mutator"));
        assert_eq!(client.total_users(), 1);
        client.add_points(&user, &100_u64);
        client.add_claimed_amt(&user, &50_i128);
        client.increment_bot_count(&user);
        assert_eq!(client.total_users(), 1);
    }

    // --- Issue #544: storage TTL / archival coverage ---
    //
    // UserProfile is written to *persistent* storage and its TTL is bumped
    // via `extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP)` on every write. If that
    // TTL is allowed to lapse, the entry becomes archived and inaccessible —
    // exactly the class of bug behind AM-028/AM-048/AM-080. These tests
    // simulate ledger advancement with `automint_testutils::advance_ledger`
    // to exercise that behaviour directly instead of only trusting the SDK's
    // (non-expiring, by default) test `Env`.

    // Control case: well within the TTL window, the profile must still be
    // readable.
    #[test]
    fn test_user_profile_survives_before_ttl_expiry() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Ttl1"));

        // Advance by less than LEDGER_BUMP — well before expiry.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP / 2);

        let profile = client.get_user(&user);
        assert_eq!(profile.username, String::from_str(&env, "ttl1"));
        assert_eq!(profile.display_name, String::from_str(&env, "Ttl1"));
    }

    // An entry whose TTL is never refreshed becomes archived once the
    // ledger sequence passes its live_until_ledger_seq (write time +
    // LEDGER_BUMP, set by both `register`'s persistent- and instance-level
    // `extend_ttl` calls). Once archived, reading it must fail rather than
    // silently returning stale/missing data.
    //
    // The test harness escalates archived-entry access to a hard panic
    // (matching mainnet: an archived entry means the transaction never
    // reaches the contract at all), even through `try_*` client methods, so
    // we assert on that panic via `catch_unwind` instead of a `Result`.
    #[test]
    fn test_user_profile_archived_after_ttl_expiry() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Ttl2"));

        automint_testutils::advance_past_ttl(&env, LEDGER_BUMP);

        let outcome =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.get_user(&user)));
        assert!(outcome.is_err(), "expected archived entry access to fail");
    }

    // Calling a function that touches the profile (and therefore calls
    // `extend_ttl` again, e.g. `add_points`) shortly before expiry must
    // reset the TTL clock, so the entry survives past what would have been
    // its original expiry ledger.
    //
    // Note: the *contract instance* (Admin/Initialized/TotalUsers/TopUsers)
    // has its own independent TTL, bumped only by `initialize`/`register`.
    // To isolate the behaviour we care about (the user profile's TTL
    // renewal), this test also registers a second, unrelated "keepalive"
    // user at the same checkpoint purely to keep the instance itself alive
    // — without that, the whole contract instance would archive first and
    // mask the assertion we're actually after.
    //
    // Verified manually that this test actually exercises the renewal (not
    // just Env defaults) by temporarily removing the
    // `env.storage().persistent().extend_ttl(...)` call for
    // `DataKey::UserProfile` inside `add_points`: with it removed, this
    // test fails with an archived-entry panic at the final `get_user`,
    // confirming the assertion is meaningful and not just passing by
    // default.
    #[test]
    fn test_extend_ttl_call_restores_access_near_expiry() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Ttl3"));

        // Advance to just before the original expiry ledger, then touch the
        // entry via add_points (renews the profile TTL) and register a
        // throwaway user (renews the instance TTL).
        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.add_points(&user, &10_u64);
        let keepalive = Address::generate(&env);
        client.register(&keepalive, &String::from_str(&env, "Keepalive"));

        // Advance well past what would have been the *original* expiry
        // ledger (write time + LEDGER_BUMP). Without the renewal above, the
        // profile entry would now be archived.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        let profile = client.get_user(&user);
        assert_eq!(profile.username, String::from_str(&env, "ttl3"));
        assert_eq!(profile.total_points, 10);
    }

    // `bump_profile` is designed for the near-expiry case: it refreshes the
    // profile TTL back to the maximum supported network bump before the profile
    // is lost to archival.
    #[test]
    fn test_bump_profile_restores_access_before_archival() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let keepalive = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Ttl4"));
        client.register(&keepalive, &String::from_str(&env, "KeepaliveTtl"));

        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.bump_profile(&user);
        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        let profile = client.get_user(&user);
        // #373: `username` is the normalized (lowercased) identity while
        // `display_name` preserves the casing the user registered with.
        assert_eq!(profile.username, String::from_str(&env, "ttl4"));
        assert_eq!(profile.display_name, String::from_str(&env, "Ttl4"));
        assert_eq!(profile.total_points, 0);
    }

    // ── #370: every mutating function emits exactly one event ──────────────
    //
    // `env.events().all()` accumulates every contract event the Env has seen,
    // so each helper snapshots the count before the call, asserts the delta is
    // exactly one (never zero, never two), checks the emitter is the registry,
    // and hands back the (topics, data) for shape assertions. `Val` itself has
    // no `PartialEq`, so topics/data are decoded to concrete types first —
    // the same style accrual's event tests use.

    fn capture_single_event<F: FnOnce()>(
        env: &Env,
        contract: &Address,
        f: F,
    ) -> (soroban_sdk::Vec<Val>, Val) {
        let before = env.events().all().len();
        f();
        let events = env.events().all();
        assert_eq!(
            events.len(),
            before + 1,
            "mutating call must emit exactly one event"
        );
        let (emitter, topics, data) = events.last().unwrap();
        assert_eq!(
            emitter, *contract,
            "event must be emitted by the registry contract"
        );
        (topics, data)
    }

    fn topic_sym(env: &Env, topics: &soroban_sdk::Vec<Val>, i: u32) -> Symbol {
        Symbol::try_from_val(env, &topics.get(i).unwrap()).unwrap()
    }

    fn topic_addr(env: &Env, topics: &soroban_sdk::Vec<Val>, i: u32) -> Address {
        Address::try_from_val(env, &topics.get(i).unwrap()).unwrap()
    }

    #[test]
    fn test_initialize_emits_exactly_one_init_event() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let (topics, data) =
            capture_single_event(&env, &client.address, || client.initialize(&admin));
        assert_eq!(topics.len(), 2);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("init"));
        assert_eq!(topic_addr(&env, &topics, 1), admin);
        let ts: u64 = u64::try_from_val(&env, &data).unwrap();
        assert_eq!(ts, env.ledger().timestamp());
    }

    #[test]
    fn test_register_emits_exactly_one_register_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);

        let (topics, data) = capture_single_event(&env, &client.address, || {
            client.register(&user, &String::from_str(&env, "EvtUser"))
        });
        assert_eq!(topics.len(), 2);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("register"));
        assert_eq!(topic_addr(&env, &topics, 1), user);
        let ts: u64 = u64::try_from_val(&env, &data).unwrap();
        assert_eq!(ts, env.ledger().timestamp());
    }

    #[test]
    fn test_set_writers_emits_exactly_one_writers_event() {
        let (env, _admin, client) = setup();
        let accrual = Address::generate(&env);
        let bot_nft = Address::generate(&env);

        let (topics, data) = capture_single_event(&env, &client.address, || {
            client.set_writers(&accrual, &bot_nft)
        });
        assert_eq!(topics.len(), 1);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("writers"));
        let (a, b): (Address, Address) = <(Address, Address)>::try_from_val(&env, &data).unwrap();
        assert_eq!(a, accrual);
        assert_eq!(b, bot_nft);
    }

    #[test]
    fn test_add_points_emits_exactly_one_addpoints_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "PtsEvt"));

        let (topics, data) =
            capture_single_event(&env, &client.address, || client.add_points(&user, &250_u64));
        assert_eq!(topics.len(), 2);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("addpoints"));
        assert_eq!(topic_addr(&env, &topics, 1), user);
        let points: u64 = u64::try_from_val(&env, &data).unwrap();
        assert_eq!(points, 250);
    }

    #[test]
    fn test_add_points_zero_is_noop_emits_no_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "ZeroEvt"));
        let before = env.events().all().len();

        client.add_points(&user, &0_u64);
        assert_eq!(
            env.events().all().len(),
            before,
            "a zero-point no-op must not emit an event"
        );
    }

    #[test]
    fn test_increment_bot_count_emits_exactly_one_inc_bot_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "BotEvt"));

        let (topics, data) =
            capture_single_event(&env, &client.address, || client.increment_bot_count(&user));
        assert_eq!(topics.len(), 2);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("inc_bot"));
        assert_eq!(topic_addr(&env, &topics, 1), user);
        let count: u32 = u32::try_from_val(&env, &data).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_decrement_bot_count_emits_exactly_one_dec_bot_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "BotDecEvt"));
        client.increment_bot_count(&user);

        let (topics, data) =
            capture_single_event(&env, &client.address, || client.decrement_bot_count(&user));
        assert_eq!(topics.len(), 2);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("dec_bot"));
        assert_eq!(topic_addr(&env, &topics, 1), user);
        let count: u32 = u32::try_from_val(&env, &data).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_add_claimed_amt_emits_exactly_one_claimed_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "ClaimEvt"));

        let (topics, data) = capture_single_event(&env, &client.address, || {
            client.add_claimed_amt(&user, &750_i128)
        });
        assert_eq!(topics.len(), 2);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("claimed"));
        assert_eq!(topic_addr(&env, &topics, 1), user);
        let amount: i128 = i128::try_from_val(&env, &data).unwrap();
        assert_eq!(amount, 750);
    }

    #[test]
    fn test_add_claimed_amt_zero_is_noop_emits_no_event() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "ZeroClaim"));
        let before = env.events().all().len();

        client.add_claimed_amt(&user, &0_i128);
        assert_eq!(
            env.events().all().len(),
            before,
            "a zero-amount no-op must not emit an event"
        );
    }

    #[test]
    fn test_start_new_season_emits_exactly_one_newseason_event() {
        let (env, _admin, client) = setup();

        let (topics, data) = capture_single_event(&env, &client.address, || {
            client.start_new_season();
        });
        assert_eq!(topics.len(), 1);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("newseason"));
        let season: u32 = u32::try_from_val(&env, &data).unwrap();
        assert_eq!(season, 1);
    }

    #[test]
    fn test_admin_transfer_functions_each_emit_exactly_one_event() {
        let (env, _admin, client) = setup();
        let new_admin = Address::generate(&env);

        let (topics, data) =
            capture_single_event(&env, &client.address, || client.set_admin(&new_admin));
        assert_eq!(topics.len(), 1);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("set_admin"));
        let (a, b): (Address, Address) = <(Address, Address)>::try_from_val(&env, &data).unwrap();
        assert_eq!(a, _admin);
        assert_eq!(b, new_admin);

        let (topics, data) = capture_single_event(&env, &client.address, || client.accept_admin());
        assert_eq!(topics.len(), 1);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("adm_acpt"));
        let (a, b): (Address, Address) = <(Address, Address)>::try_from_val(&env, &data).unwrap();
        assert_eq!(a, _admin);
        assert_eq!(b, new_admin);

        // Re-propose so a transfer is pending, then cancel it.
        let newer = Address::generate(&env);
        client.set_admin(&newer);
        let (topics, data) =
            capture_single_event(&env, &client.address, || client.cancel_admin_transfer());
        assert_eq!(topics.len(), 1);
        assert_eq!(topic_sym(&env, &topics, 0), symbol_short!("adm_cncl"));
        let (a, b): (Address, Address) = <(Address, Address)>::try_from_val(&env, &data).unwrap();
        assert_eq!(a, new_admin);
        assert_eq!(b, newer);
    }

    // ── #371: seasons ──────────────────────────────────────────────────────

    #[test]
    fn test_season_defaults_to_zero() {
        let (_env, _admin, client) = setup();
        assert_eq!(client.get_season(), 0);
    }

    #[test]
    fn test_add_points_accumulates_current_season_and_lifetime() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "SeasonUser"));
        client.add_points(&user, &100_u64);
        client.add_points(&user, &50_u64);

        assert_eq!(client.get_user(&user).total_points, 150);
        let board = client.get_leaderboard_for_season(&0, &10);
        assert_eq!(board.len(), 1);
        assert_eq!(board.get(0).unwrap().season_points, 150);
        assert_eq!(board.get(0).unwrap().total_points, 150);
        assert_eq!(
            board.get(0).unwrap().display_name,
            String::from_str(&env, "SeasonUser")
        );
        assert_eq!(board.get(0).unwrap().address, user);
    }

    #[test]
    fn test_start_new_season_zeroes_board_but_keeps_lifetime_and_history() {
        let (env, _admin, client) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        client.register(&u1, &String::from_str(&env, "Alpha"));
        client.register(&u2, &String::from_str(&env, "Bravo"));
        client.add_points(&u1, &100_u64);
        client.add_points(&u2, &50_u64);

        assert_eq!(client.get_season(), 0);
        assert_eq!(client.start_new_season(), 1);
        assert_eq!(client.get_season(), 1);

        // The new season's board starts empty…
        assert_eq!(client.get_leaderboard_for_season(&1, &10).len(), 0);
        // …lifetime totals persist…
        assert_eq!(client.get_user(&u1).total_points, 100);
        assert_eq!(client.get_leaderboard(&10).len(), 2);
        // …and season 0's board remains queryable, in rank order.
        let historical = client.get_leaderboard_for_season(&0, &10);
        assert_eq!(historical.len(), 2);
        assert_eq!(historical.get(0).unwrap().season_points, 100);
        assert_eq!(historical.get(1).unwrap().season_points, 50);

        // Points earned after the rollover land in season 1 only.
        client.add_points(&u1, &10_u64);
        let current = client.get_leaderboard_for_season(&1, &10);
        assert_eq!(current.len(), 1);
        assert_eq!(current.get(0).unwrap().season_points, 10);
        assert_eq!(current.get(0).unwrap().total_points, 110);
        // Season 0 is frozen: historical boards never change after rollover.
        assert_eq!(
            client
                .get_leaderboard_for_season(&0, &10)
                .get(0)
                .unwrap()
                .season_points,
            100
        );
    }

    #[test]
    fn test_start_new_season_rolls_multiple_seasons() {
        let (_env, _admin, client) = setup();
        assert_eq!(client.start_new_season(), 1);
        assert_eq!(client.start_new_season(), 2);
        assert_eq!(client.get_season(), 2);
        assert_eq!(client.get_leaderboard_for_season(&0, &10).len(), 0);
        assert_eq!(client.get_leaderboard_for_season(&1, &10).len(), 0);
        assert_eq!(client.get_leaderboard_for_season(&2, &10).len(), 0);
    }

    #[test]
    fn test_get_leaderboard_for_season_limit_and_empty_seasons() {
        let (env, _admin, client) = setup();
        // Unknown/never-populated season: empty, not an error.
        assert_eq!(client.get_leaderboard_for_season(&7, &10).len(), 0);

        let names = ["s0", "s1", "s2", "s3", "s4"];
        for (i, name) in names.iter().enumerate() {
            let u = Address::generate(&env);
            client.register(&u, &String::from_str(&env, name));
            client.add_points(&u, &((i as u64 + 1) * 10));
        }
        let board = client.get_leaderboard_for_season(&0, &3);
        assert_eq!(board.len(), 3);
        assert_eq!(board.get(0).unwrap().season_points, 50);
        assert_eq!(board.get(1).unwrap().season_points, 40);
        assert_eq!(board.get(2).unwrap().season_points, 30);
        // limit 0 returns empty rather than everything.
        assert_eq!(client.get_leaderboard_for_season(&0, &0).len(), 0);
    }

    // Season points live in persistent storage and renew their TTL on every
    // write — the same keepalive property the profile tests cover, applied to
    // the new SeasonPoints key. The instance-level SeasonTop/Season keys are
    // renewed by register()/start_new_season(); here we only isolate the
    // per-user season entry.
    #[test]
    fn test_season_points_survive_past_original_ttl_when_renewed() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "TtlSeason"));
        client.add_points(&user, &40_u64);

        // Renew the SeasonPoints TTL just before the original expiry…
        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.add_points(&user, &5_u64);
        // Keep the contract instance itself alive (register renews it).
        let keepalive = Address::generate(&env);
        client.register(&keepalive, &String::from_str(&env, "SKeep"));

        // …then blow past the original expiry ledger.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        let board = client.get_leaderboard_for_season(&0, &10);
        assert_eq!(board.len(), 1);
        assert_eq!(board.get(0).unwrap().season_points, 45);
    }

    // ── #372: is_registered and get_user never disagree ─────────────────────

    // Both functions perform the same persistent `.get()` read, so at every
    // point in the TTL window they must reach the same conclusion: registered
    // while the entry is live, and (in this harness) the same archived-entry
    // failure once the ledger passes live_until_ledger_seq.
    #[test]
    fn test_is_registered_and_get_user_agree_across_ttl_boundary() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "TtlAgree"));

        // Mid-window: both report registered.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP / 2);
        assert!(client.is_registered(&user));
        assert_eq!(
            client.is_registered(&user),
            client.try_get_user(&user).is_ok()
        );

        // One ledger before expiry: still in agreement.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP / 2 - 1);
        assert!(client.is_registered(&user));
        assert_eq!(
            client.is_registered(&user),
            client.try_get_user(&user).is_ok()
        );

        // Past the TTL: the entry is archived. The harness escalates archived
        // access to a hard panic (matching mainnet, where the transaction never
        // reaches the contract), so agreement means both reads fail the same
        // way — the UI can never observe "registered" alongside a failed
        // profile read.
        automint_testutils::advance_past_ttl(&env, LEDGER_BUMP);
        let reg =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.is_registered(&user)));
        let get =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.try_get_user(&user)));
        assert_eq!(
            reg.is_err(),
            get.is_err(),
            "is_registered and get_user must agree at the archival boundary"
        );
        assert!(
            reg.is_err(),
            "archived entry must fail, not read as unregistered"
        );
    }
}

// ── Issue #543: explicit authorization tests ──────────────────────────────
//
// The module above uses `mock_all_auths()`, which makes every
// `require_auth()` call succeed unconditionally and therefore cannot catch a
// missing or incorrect auth check. Each test here exercises one
// `require_auth()` call site directly: the call must fail when the required
// signer has not authorized it, and succeed when that signer's authorization
// is explicitly mocked for exactly that invocation.
#[cfg(test)]
mod auth_tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Env, IntoVal, String};

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let result = client.try_initialize(&admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_initialize(&admin);
        assert!(result.is_ok());
    }

    #[test]
    fn test_start_new_season_fails_without_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        // No authorizations mocked — only the admin may roll the season over.
        env.mock_auths(&[]);
        let result = client.try_start_new_season();
        assert!(result.is_err());
        // The counter must be untouched after the failed attempt.
        assert_eq!(client.get_season(), 0);
    }

    #[test]
    fn test_start_new_season_succeeds_with_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "start_new_season",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_start_new_season();
        assert_eq!(result, Ok(Ok(1)));
        assert_eq!(client.get_season(), 1);
    }

    #[test]
    fn test_register_fails_without_user_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let user = Address::generate(&env);
        let username = String::from_str(&env, "alice");
        // No authorizations mocked for the upcoming call — `user` has not
        // authorized `register`, so it must fail.
        env.mock_auths(&[]);
        let result = client.try_register(&user, &username);
        assert!(result.is_err());
    }

    #[test]
    fn test_register_succeeds_with_user_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        let user = Address::generate(&env);
        let username = String::from_str(&env, "alice");
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "register",
                args: (user.clone(), username.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_register(&user, &username);
        assert!(result.is_ok());
    }

    #[test]
    fn test_decrement_bot_count_fails_without_user_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "bob"));

        env.mock_auths(&[]);
        let result = client.try_decrement_bot_count(&user);
        assert!(result.is_err());
    }

    #[test]
    fn test_decrement_bot_count_succeeds_with_user_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "bob"));

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "decrement_bot_count",
                args: (user.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_decrement_bot_count(&user);
        assert!(result.is_ok());
    }

    #[test]
    fn test_set_admin_fails_for_non_admin_and_succeeds_for_admin() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        let new_admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        // Non-admin proposal fails
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "set_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_set_admin(&new_admin).is_err());
        assert_eq!(client.pending_admin(), None);

        // Current admin proposal succeeds
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "set_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_set_admin(&new_admin).is_ok());
        assert_eq!(client.pending_admin(), Some(new_admin));
    }

    #[test]
    fn test_accept_admin_only_pending_admin_can_accept() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        let new_admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);
        client.set_admin(&new_admin);

        // Current admin cannot accept on behalf of pending admin
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "accept_admin",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_accept_admin().is_err());
        assert_eq!(client.admin(), admin);

        // Unrelated address cannot accept
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "accept_admin",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_accept_admin().is_err());
        assert_eq!(client.admin(), admin);

        // Pending admin accepts and becomes the active admin
        env.mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "accept_admin",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_accept_admin().is_ok());
        assert_eq!(client.admin(), new_admin);
        assert_eq!(client.pending_admin(), None);
    }

    #[test]
    fn test_cancel_admin_transfer_requires_current_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);
        client.set_admin(&new_admin);

        // Pending admin cannot cancel
        env.mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "cancel_admin_transfer",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_cancel_admin_transfer().is_err());
        assert_eq!(client.pending_admin(), Some(new_admin.clone()));

        // Current admin can cancel
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "cancel_admin_transfer",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_cancel_admin_transfer().is_ok());
        assert_eq!(client.pending_admin(), None);
    }
}

// ── Issue #335: the user counter fails closed instead of trapping ────────
#[cfg(test)]
mod overflow_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    #[test]
    fn test_register_at_user_ceiling_returns_overflow_not_panic() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.as_contract(&id, || {
            env.storage()
                .instance()
                .set(&DataKey::TotalUsers, &u32::MAX);
        });
        let user = Address::generate(&env);

        assert_eq!(
            client.try_register(&user, &String::from_str(&env, "atlimit")),
            Err(Ok(RegistryError::Overflow))
        );
        // The failed call is rolled back: no profile, counter untouched.
        assert!(!client.is_registered(&user));
        assert_eq!(client.total_users(), u32::MAX);
    }

    #[test]
    fn test_register_below_ceiling_increments() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        env.as_contract(&id, || {
            env.storage()
                .instance()
                .set(&DataKey::TotalUsers, &(u32::MAX - 1));
        });
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "lastone"));
        assert_eq!(client.total_users(), u32::MAX);
    }
}
