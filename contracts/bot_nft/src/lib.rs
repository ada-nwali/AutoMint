// SPDX-License-Identifier: Apache-2.0

#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Bytes, Env, IntoVal, String, Vec,
};

/// The registry entry points bot_nft calls, declared locally rather than
/// depending on `automint-registry`: that dependency links the registry's
/// exported functions (`initialize`, `accept_admin`, ...) into this wasm, and
/// the linker either rejects the duplicate symbols outright (the marketplace
/// wasm link failure) or silently drops ours — bot_nft's own `initialize`
/// export vanished from its wasm this way. Same rationale as accrual's
/// `RegistryInterface` (#346c800 fix). Return types are the unit type so a
/// typed error from the callee surfaces through `try_*` as
/// `soroban_sdk::Error`, whose code is the callee's error discriminant.
#[contractclient(name = "RegistryClient")]
pub trait RegistryInterface {
    fn increment_bot_count(env: Env, user: Address);
    fn decrement_bot_count(env: Env, user: Address);
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum Tier {
    Basic = 0,
    Advanced = 1,
    Premium = 2,
}

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

impl Tier {
    /// Mint price for this legacy tier, in AMT base units (7 decimals).
    pub fn price(self) -> i128 {
        match self {
            Tier::Basic => 0,
            Tier::Advanced => 500_0000000,
            Tier::Premium => 2000_0000000,
        }
    }
}

impl BotTier {
    /// Mint price for this tier, in AMT base units (7 decimals). Basic is
    /// free.
    pub fn price(self) -> i128 {
        match self {
            BotTier::Basic => 0,
            BotTier::Bronze => 500_0000000,
            BotTier::Silver => 2000_0000000,
            BotTier::Gold => 7500_0000000,
            BotTier::Diamond => 25000_0000000,
        }
    }

    /// Display name for this tier, e.g. `"Gold Bot"`.
    pub fn name(self, env: &Env) -> String {
        match self {
            BotTier::Basic => String::from_str(env, "Basic Bot"),
            BotTier::Bronze => String::from_str(env, "Bronze Bot"),
            BotTier::Silver => String::from_str(env, "Silver Bot"),
            BotTier::Gold => String::from_str(env, "Gold Bot"),
            BotTier::Diamond => String::from_str(env, "Diamond Bot"),
        }
    }

    /// Points per hour a bot of this tier contributes to its owner's
    /// accrual rate.
    pub fn rate(self) -> u64 {
        match self {
            BotTier::Basic => 1,
            BotTier::Bronze => 5,
            BotTier::Silver => 25,
            BotTier::Gold => 100,
            BotTier::Diamond => 500,
        }
    }
}

/// Typed tier descriptor returned by `get_tier_info` and `all_tiers`.
#[derive(Clone)]
#[contracttype]
pub struct TierInfo {
    pub name: String,
    pub rate: u64,
    pub price: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct BotNFT {
    pub id: u64,
    pub tier: BotTier,
    pub owner: Address,
    pub minter: Address,
    pub accrual_rate: u64,
    pub minted_at: u64,
    /// Owner-settable nickname (max 24 bytes). None when unset; callers that
    /// need a display name fall back to `tier.name()`.
    pub nickname: Option<String>,
    /// Deterministic variant (0..=7) assigned at mint, used for rarity.
    pub variant: u32,
    /// Deterministic bonus bps (0..500) on top of the tier base accrual rate.
    pub bonus_bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct StoredBotNFT {
    pub id: u64,
    pub tier: BotTier,
    pub owner: Address,
    pub minter: Address,
    pub minted_at: u64,
    pub nickname: Option<String>,
    pub variant: u32,
    pub bonus_bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    NextId,
    Bot(u64),
    UserBots(Address),
    Admin,
    Initialized,
    Registry,
    TierSupply(BotTier),
    TierRate(BotTier),
    /// Optional per-tier mint cap (#385). Stored as u64; absent or 0 means uncapped.
    TierCap(BotTier),
    Marketplace,
    Accrual,
    PaymentToken,
    TierIndex(BotTier),
    /// Single-token approval: maps bot_id -> ApprovalEntry.
    Approval(u64),
    /// Operator approval: maps (owner, operator) -> bool.
    OperatorApproval(Address, Address),
    /// Total supply of all bots (maintained on mint/burn, never transfer)
    Supply,
    /// Base URI for token metadata
    BaseUri,
    /// Count of failed registry syncs
    RegistryFailCount,
}

/// Stored data for a single-token approval.
#[derive(Clone)]
#[contracttype]
pub struct ApprovalEntry {
    /// The approved spender address.
    pub spender: Address,
    /// The ledger sequence number at or after which this approval expires.
    /// Set to `u32::MAX` to indicate no expiry within the contract's lifetime.
    pub expiration_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum BotNFTError {
    AlreadyInitialized = 1,
    NotFound = 2,
    Unauthorized = 3,
    InvalidTier = 4,
    BotNotFound = 5,
    NotOwner = 6,
    InsufficientFunds = 7,
    NotInitialized = 8,
    SupplyCapExceeded = 9,
    BatchTooLarge = 10,
    NicknameTooLong = 11,
    RangeLimitExceeded = 12,
    /// `withdraw` amount was zero or negative.
    InvalidAmount = 13,
    /// `withdraw` amount exceeds the treasury balance of the payment token.
    InsufficientTreasury = 14,
    /// The bot id counter has reached `u64::MAX`; no further bot can be minted.
    Overflow = 15,
    /// The optional per-tier mint cap has been reached; no further mints of this
    /// tier are allowed until the admin raises or removes the cap (#385).
    TierSoldOut = 16,
    /// Admin attempted to lower the cap below the current minted supply (#385).
    CapBelowSupply = 17,
    /// The approval has expired (current ledger >= expiration_ledger).
    ApprovalExpired = 18,
    /// The caller is neither the owner, an approved spender, nor an approved operator.
    NotApproved = 19,
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;
/// Maximum number of bots that may be minted per tier (supply cap).
const MAX_TIER_SUPPLY: u64 = 50;
/// Maximum number of free Basic bots a single account may mint.
const MAX_BASIC_BOTS_PER_ACCOUNT: u64 = 1;
/// Maximum number of recipients in a single admin_mint_batch call.
const MAX_BATCH_SIZE: u64 = 50;
/// Maximum number of bots returned per page when querying by tier (#398).
pub const TIER_PAGE_SIZE: u32 = 10;
/// Maximum number of bots returned by a single `get_user_bots_detailed` call.
/// The cap is enforced contract-side so one simulation stays within the
/// compute budget; callers with more bots paginate via `get_user_bots` +
/// `get_bot` (#483).
const MAX_DETAILED_BOTS: usize = 50;
/// Maximum `limit` accepted by `get_bots_range` (#391).
const MAX_RANGE_LIMIT: u32 = 100;

#[contract]
pub struct BotNFTContract;

#[contractimpl]
impl BotNFTContract {
    /// One-time setup: records the admin, registry and payment-token
    /// addresses, resets the id counter to 1, and seeds the default tier
    /// rates (Basic 1, Bronze 5, Silver 25, Gold 100, Diamond 500).
    ///
    /// Auth: `admin.require_auth()`.
    ///
    /// Errors: `AlreadyInitialized` on a second call.
    pub fn initialize(
        env: Env,
        admin: Address,
        registry: Address,
        payment_token: Address,
    ) -> Result<(), BotNFTError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(BotNFTError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextId, &1u64);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Registry, &registry);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);

        env.storage()
            .instance()
            .set(&DataKey::TierRate(BotTier::Basic), &1u64);
        env.storage()
            .instance()
            .set(&DataKey::TierRate(BotTier::Bronze), &5u64);
        env.storage()
            .instance()
            .set(&DataKey::TierRate(BotTier::Silver), &25u64);
        env.storage()
            .instance()
            .set(&DataKey::TierRate(BotTier::Gold), &100u64);
        env.storage()
            .instance()
            .set(&DataKey::TierRate(BotTier::Diamond), &500u64);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Admin-only: point this contract at the accrual contract. Once set,
    /// every mint and transfer best-effort invokes `sync_rate` on accrual
    /// for the affected users so a rate change never needs a manual
    /// follow-up.
    ///
    /// Auth: admin only.
    ///
    /// Errors: `NotInitialized` when no admin is recorded.
    pub fn set_accrual(env: Env, accrual: Address) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Accrual, &accrual);
        Ok(())
    }

    /// The token contract whose units are charged for paid tier mints and
    /// held in the contract treasury.
    ///
    /// Errors: `NotInitialized`.
    pub fn payment_token(env: Env) -> Result<Address, BotNFTError> {
        env.storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .ok_or(BotNFTError::NotInitialized)
    }

    /// Admin-only: record the marketplace contract so that any transfer out
    /// of an owner (to a destination other than the marketplace itself)
    /// best-effort notifies it via `on_bot_moved`, letting the marketplace
    /// deactivate a listing whose bot moved without a sale.
    ///
    /// Auth: admin only.
    ///
    /// Errors: `NotInitialized` when no admin is recorded.
    pub fn set_marketplace(env: Env, marketplace: Address) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Marketplace, &marketplace);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Admin-only: change the base accrual rate for one tier. The new rate
    /// must be non-zero and within [current/2, current*2], so a typo cannot
    /// silently reprice every bot of that tier. Emits `rate_set` with the
    /// old and new rates.
    ///
    /// Auth: admin only.
    ///
    /// Errors: `NotInitialized`, `InvalidTier` when `rate` is zero,
    /// `Unauthorized` when the change is outside the 2x band.
    pub fn set_tier_rate(env: Env, tier: BotTier, rate: u64) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();

        if rate == 0 {
            return Err(BotNFTError::InvalidTier);
        }

        let old_rate = Self::get_tier_rate_internal(&env, tier);

        let max_allowed = old_rate.saturating_mul(2);
        let min_allowed = old_rate / 2;
        if rate > max_allowed || (min_allowed > 0 && rate < min_allowed) {
            return Err(BotNFTError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::TierRate(tier), &rate);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events()
            .publish((symbol_short!("rate_set"), tier), (old_rate, rate));
        Ok(())
    }

    fn get_tier_rate_internal(env: &Env, tier: BotTier) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TierRate(tier))
            .unwrap_or_else(|| tier.rate())
    }

    // ── Per-tier mint cap (#385) ───────────────────────────────────────────

    /// Admin-only setter for the optional per-tier mint cap.
    ///
    /// `cap == 0` removes the cap (minting becomes unlimited for that tier).
    /// Attempting to set a cap *below* the current minted supply fails with
    /// `CapBelowSupply` to prevent retroactively breaking an active mint.
    pub fn set_tier_cap(env: Env, tier: BotTier, cap: u64) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();

        // Disallow setting a cap that is already exceeded by live supply
        // (except cap == 0, which means "remove cap").
        if cap > 0 {
            let current_supply = Self::read_tier_supply(&env, tier);
            if cap < current_supply {
                return Err(BotNFTError::CapBelowSupply);
            }
        }

        env.storage().instance().set(&DataKey::TierCap(tier), &cap);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish((symbol_short!("cap_set"), tier), cap);
        Ok(())
    }

    /// Return the configured cap for `tier`. 0 means uncapped.
    pub fn tier_cap(env: Env, tier: BotTier) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TierCap(tier))
            .unwrap_or(0)
    }

    /// Return the number of remaining mint slots for `tier`.
    ///
    /// If the tier is uncapped (cap == 0) `u64::MAX` is returned as a
    /// sentinel so callers can display "∞".
    /// Frontend display: `if remaining == u64::MAX { "∞" } else { remaining.to_string() }`
    pub fn tier_remaining(env: Env, tier: BotTier) -> u64 {
        let cap: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TierCap(tier))
            .unwrap_or(0);
        if cap == 0 {
            return u64::MAX; // uncapped sentinel
        }
        let supply = Self::read_tier_supply(&env, tier);
        cap.saturating_sub(supply)
    }

    /// Mint one free Basic bot to `owner`. Each account may claim at most
    /// `MAX_BASIC_BOTS_PER_ACCOUNT` (1) free Basic bot; further mints of
    /// that tier must go through a paid path or an admin grant. Derives the
    /// bot's deterministic variant/bonus, updates tier supply and the
    /// registry count, and best-effort syncs the owner's accrual rate.
    ///
    /// Auth: `owner.require_auth()`.
    ///
    /// Errors: `NotInitialized`, `SupplyCapExceeded` when the account
    /// already has its free Basic bot (or the hard tier cap is reached).
    /// Returns the new bot id.
    pub fn mint_basic(env: Env, owner: Address) -> Result<u64, BotNFTError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(BotNFTError::NotInitialized);
        }
        owner.require_auth();

        // Enforce per-account limit on free Basic bots
        let user_bots = Self::get_user_bots(env.clone(), owner.clone());
        let basic_count = user_bots
            .iter()
            .filter(|bot_id| {
                Self::get_bot(env.clone(), *bot_id)
                    .map(|bot| bot.tier == BotTier::Basic)
                    .unwrap_or(false)
            })
            .count();

        if basic_count as u64 >= MAX_BASIC_BOTS_PER_ACCOUNT {
            return Err(BotNFTError::SupplyCapExceeded);
        }

        Self::do_mint(&env, &owner, BotTier::Basic, false)
    }

    /// Mint a paid-tier bot to `owner`: charge the tier's price in the
    /// payment token (Basic is free, Advanced 5 AMT, Premium 20 AMT), then
    /// mint the corresponding `BotTier`. The token transfer is the payment —
    /// it fails when `owner` cannot cover the price.
    ///
    /// Auth: `owner.require_auth()`.
    ///
    /// Errors: `NotInitialized`, a token transfer failure on insufficient
    /// balance, plus every error `do_mint` can raise (`SupplyCapExceeded`,
    /// `TierSoldOut`, `Overflow`). Returns the new bot id.
    pub fn mint_tier(env: Env, owner: Address, tier: Tier) -> Result<u64, BotNFTError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(BotNFTError::NotInitialized);
        }
        owner.require_auth();

        // Charge the purchase price (transfer fails on insufficient balance).
        let price = tier.price();
        if price > 0 {
            let token = Self::payment_token(env.clone())?;
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&owner, &env.current_contract_address(), &price);
        }

        let bot_tier = match tier {
            Tier::Basic => BotTier::Basic,
            Tier::Advanced => BotTier::Bronze,
            Tier::Premium => BotTier::Silver,
        };
        Self::do_mint(&env, &owner, bot_tier, false)
    }

    /// Admin-only withdrawal of accumulated tier payments (#322).
    ///
    /// `mint_tier` takes the payment token as a per-call argument (no token is
    /// stored yet), so the token to withdraw is passed explicitly. The balance
    /// is checked up front so an over-withdrawal fails before any transfer.
    pub fn withdraw(
        env: Env,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(BotNFTError::InvalidAmount);
        }
        let token_client = token::Client::new(&env, &token);
        let this = env.current_contract_address();
        if amount > token_client.balance(&this) {
            return Err(BotNFTError::InsufficientTreasury);
        }
        token_client.transfer(&this, &to, &amount);

        env.events()
            .publish((symbol_short!("withdraw"),), (admin, to, amount));
        Ok(())
    }

    /// Balance of `token` held by this contract (accumulated tier payments).
    pub fn treasury_balance(env: Env, token: Address) -> i128 {
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }

    /// Admin-controlled mint (no payment) for airdrops / grants. Distinguishable
    /// from a purchase via the `grant` event.
    pub fn admin_mint(env: Env, to: Address, tier: BotTier) -> Result<u64, BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();
        Self::do_mint(&env, &to, tier, true)
    }

    /// Batch admin mint for airdrops. All-or-nothing: if any single mint fails
    /// (e.g. supply cap), the whole batch is rolled back. Capped by MAX_BATCH_SIZE.
    pub fn admin_mint_batch(
        env: Env,
        recipients: Vec<(Address, BotTier)>,
    ) -> Result<Vec<u64>, BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();
        if recipients.len() as u64 > MAX_BATCH_SIZE {
            return Err(BotNFTError::BatchTooLarge);
        }
        let mut ids = Vec::new(&env);
        for (to, tier) in recipients.iter() {
            let id = Self::do_mint(&env, &to, tier, true)?;
            ids.push_back(id);
        }
        Ok(ids)
    }

    /// Mint a bot, derive deterministic traits, track tier supply, and notify
    /// the registry. `is_grant` selects the event topic (`grant` vs `mint`).
    fn do_mint(
        env: &Env,
        owner: &Address,
        tier: BotTier,
        is_grant: bool,
    ) -> Result<u64, BotNFTError> {
        let bot_id = Self::get_next_id(env)?;
        let (variant, bonus_bps) =
            Self::derive_traits(env, bot_id, env.ledger().timestamp(), owner);
        let stored = StoredBotNFT {
            id: bot_id,
            tier,
            owner: owner.clone(),
            minter: owner.clone(),
            minted_at: env.ledger().timestamp(),
            nickname: None,
            variant,
            bonus_bps,
        };

        // Enforce hard-coded per-tier supply cap (MAX_TIER_SUPPLY).
        let supply = Self::read_tier_supply(env, tier).saturating_add(1);
        if supply > MAX_TIER_SUPPLY {
            return Err(BotNFTError::SupplyCapExceeded);
        }

        // Enforce optional admin-configurable per-tier cap (#385).
        // A stored cap of 0 (or absent) means uncapped.
        let opt_cap: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TierCap(tier))
            .unwrap_or(0);
        if opt_cap > 0 && supply > opt_cap {
            return Err(BotNFTError::TierSoldOut);
        }
        env.storage()
            .persistent()
            .set(&DataKey::TierSupply(tier), &supply);
        env.storage().persistent().extend_ttl(
            &DataKey::TierSupply(tier),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        env.storage()
            .persistent()
            .set(&DataKey::Bot(bot_id), &stored);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);

        Self::add_bot_to_user(env, owner, bot_id);
        Self::add_bot_to_tier_index(env, tier, bot_id);
        Self::increment_bot_count(env, owner, bot_id);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        let topic = if is_grant {
            symbol_short!("grant")
        } else {
            symbol_short!("mint")
        };
        env.events().publish((topic, owner.clone()), (bot_id, tier));
        Self::sync_rate(env, owner);
        Ok(bot_id)
    }

    fn sync_rate(env: &Env, user: &Address) {
        if let Some(accrual) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Accrual)
        {
            let mut args = Vec::new(env);
            args.push_back(user.clone().into_val(env));
            let _ = env.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
                &accrual,
                &soroban_sdk::Symbol::new(env, "sync_rate"),
                args,
            );
        }
    }

    /// Transfer `bot_id` from `from` to `to`. A self-transfer (`from ==
    /// to`) is a no-op. Clears any single-token approval, updates the
    /// owner's bot list, best-effort syncs both users' accrual rates, and
    /// best-effort notifies the marketplace via `on_bot_moved` for every
    /// destination except the marketplace itself (escrow deposits).
    ///
    /// Auth: `from.require_auth()`; only the current owner may call it.
    ///
    /// Errors: `BotNotFound`, `NotOwner` when `from` does not own the bot.
    pub fn transfer(env: Env, bot_id: u64, from: Address, to: Address) -> Result<(), BotNFTError> {
        from.require_auth();
        if from == to {
            return Ok(());
        }
        let bot: BotNFT = Self::get_bot(env.clone(), bot_id)?;

        if bot.owner != from {
            return Err(BotNFTError::NotOwner);
        }

        Self::do_transfer(&env, bot_id, &bot, &from, &to)
    }

    // ── Approval model ────────────────────────────────────────────────────────

    /// Grant `spender` the right to transfer exactly one bot (`bot_id`) on
    /// behalf of its owner.  The approval expires at `expiration_ledger`; pass
    /// `u32::MAX` to request no practical expiry.  Passing the zero address
    /// (or any value for which the owner clears by convention) can be done by
    /// setting `expiration_ledger` to the current ledger, which immediately
    /// expires.
    ///
    /// Only the current owner (or an approved operator) may call this.
    /// The single-token approval is cleared automatically by any transfer.
    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        bot_id: u64,
        expiration_ledger: u32,
    ) -> Result<(), BotNFTError> {
        let bot: BotNFT = Self::get_bot(env.clone(), bot_id)?;
        if bot.owner != owner {
            return Err(BotNFTError::NotOwner);
        }
        owner.require_auth();

        if expiration_ledger < env.ledger().sequence() {
            // Immediately-expired approval is treated as a revocation.
            env.storage()
                .persistent()
                .remove(&DataKey::Approval(bot_id));
        } else {
            let entry = ApprovalEntry {
                spender: spender.clone(),
                expiration_ledger,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Approval(bot_id), &entry);
            env.storage().persistent().extend_ttl(
                &DataKey::Approval(bot_id),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
        }
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("approve"), owner, spender),
            (bot_id, expiration_ledger),
        );
        Ok(())
    }

    /// Return the currently-approved spender for `bot_id`, or `None` if there
    /// is no valid (non-expired) approval.
    pub fn get_approved(env: Env, bot_id: u64) -> Option<Address> {
        let entry: ApprovalEntry = env.storage().persistent().get(&DataKey::Approval(bot_id))?;
        if entry.expiration_ledger < env.ledger().sequence() {
            None
        } else {
            Some(entry.spender)
        }
    }

    /// Allow (or disallow) `operator` to transfer any bot owned by `owner`.
    ///
    /// Setting `approved = false` revokes the approval.  Operators are not
    /// subject to per-token expiry — revoke explicitly.
    pub fn set_approval_for_all(
        env: Env,
        owner: Address,
        operator: Address,
        approved: bool,
    ) -> Result<(), BotNFTError> {
        if owner == operator {
            // No-op: an owner is always implicitly their own operator.
            return Ok(());
        }
        owner.require_auth();

        if approved {
            env.storage().persistent().set(
                &DataKey::OperatorApproval(owner.clone(), operator.clone()),
                &true,
            );
            env.storage().persistent().extend_ttl(
                &DataKey::OperatorApproval(owner.clone(), operator.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::OperatorApproval(owner.clone(), operator.clone()));
        }
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events()
            .publish((symbol_short!("op_appr"), owner, operator), approved);
        Ok(())
    }

    /// Return `true` if `operator` is approved to manage all bots owned by `owner`.
    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        if owner == operator {
            return true;
        }
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::OperatorApproval(owner, operator))
            .unwrap_or(false)
    }

    /// Transfer `bot_id` from `from` to `to`, called by an approved `spender`
    /// rather than the owner directly.
    ///
    /// Authorization rules (in order):
    ///  1. `spender` is the current owner  → behaves like `transfer`.
    ///  2. `spender` is an approved operator for `from` → allowed.
    ///  3. `spender` has a valid (non-expired) single-token approval for
    ///     this exact `bot_id` → allowed once; approval is cleared after use.
    ///
    /// The single-token approval is always cleared by a successful transfer.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        bot_id: u64,
    ) -> Result<(), BotNFTError> {
        spender.require_auth();

        if from == to {
            return Ok(());
        }

        let bot: BotNFT = Self::get_bot(env.clone(), bot_id)?;

        if bot.owner != from {
            return Err(BotNFTError::NotOwner);
        }

        // Check authorisation: owner path, operator path, single-token approval.
        if spender != from {
            let is_operator = Self::is_approved_for_all(env.clone(), from.clone(), spender.clone());
            if !is_operator {
                // Fall through to single-token approval check.
                let entry: Option<ApprovalEntry> =
                    env.storage().persistent().get(&DataKey::Approval(bot_id));
                match entry {
                    Some(a) if a.spender == spender => {
                        if a.expiration_ledger < env.ledger().sequence() {
                            // Expired — clean up and reject.
                            env.storage()
                                .persistent()
                                .remove(&DataKey::Approval(bot_id));
                            return Err(BotNFTError::ApprovalExpired);
                        }
                        // Valid single-token approval — will be consumed below.
                    }
                    _ => return Err(BotNFTError::NotApproved),
                }
            }
        }

        Self::do_transfer(&env, bot_id, &bot, &from, &to)
    }

    // ── Internal transfer implementation ──────────────────────────────────────

    /// Shared transfer logic used by both `transfer` and `transfer_from`.
    /// Clears any single-token approval for `bot_id` as part of the transfer.
    fn do_transfer(
        env: &Env,
        bot_id: u64,
        bot: &BotNFT,
        from: &Address,
        to: &Address,
    ) -> Result<(), BotNFTError> {
        let stored = StoredBotNFT {
            id: bot.id,
            tier: bot.tier,
            owner: to.clone(),
            minter: bot.minter.clone(),
            minted_at: bot.minted_at,
            nickname: bot.nickname.clone(),
            variant: bot.variant,
            bonus_bps: bot.bonus_bps,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Bot(bot_id), &stored);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        // ERC-721 §: clear single-token approval on any transfer.
        env.storage()
            .persistent()
            .remove(&DataKey::Approval(bot_id));

        Self::remove_bot_from_user(env, from, bot_id);
        Self::add_bot_to_user(env, to, bot_id);
        Self::sync_rate(env, from);
        Self::sync_rate(env, to);

        if let Some(mkt_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Marketplace)
        {
            if *to != mkt_addr {
                let mut args = Vec::new(env);
                args.push_back(bot_id.into_val(env));
                let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
                    &mkt_addr,
                    &soroban_sdk::Symbol::new(env, "on_bot_moved"),
                    args,
                );
            }
        }

        env.events().publish(
            (symbol_short!("transfer"), from.clone(), to.clone()),
            bot_id,
        );
        Ok(())
    }

    /// Burn a bot, removing it from storage, decrementing tier supply,
    /// removing it from owner's bot list and tier index, and decrementing the owner's
    /// count in the registry contract (#398).
    pub fn burn(env: Env, bot_id: u64, owner: Address) -> Result<(), BotNFTError> {
        owner.require_auth();
        let bot: BotNFT = Self::get_bot(env.clone(), bot_id)?;

        if bot.owner != owner {
            return Err(BotNFTError::NotOwner);
        }

        let supply = Self::read_tier_supply(&env, bot.tier);
        env.storage()
            .persistent()
            .set(&DataKey::TierSupply(bot.tier), &supply.saturating_sub(1));
        env.storage().persistent().extend_ttl(
            &DataKey::TierSupply(bot.tier),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        // Decrement total supply (issue #384)
        let total = Self::total_supply(env.clone()).saturating_sub(1);
        env.storage().instance().set(&DataKey::Supply, &total);

        env.storage().persistent().remove(&DataKey::Bot(bot_id));

        Self::remove_bot_from_user(&env, &owner, bot_id);
        Self::remove_bot_from_tier_index(&env, bot.tier, bot_id);
        Self::decrement_bot_count(&env, &owner, bot_id);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events()
            .publish((symbol_short!("burn"), owner), (bot_id, bot.tier));
        Ok(())
    }

    /// Permissionlessly refresh the persistent storage TTL of a single bot (#397).
    pub fn bump_bot(env: Env, bot_id: u64) -> Result<(), BotNFTError> {
        if !env.storage().persistent().has(&DataKey::Bot(bot_id)) {
            return Err(BotNFTError::BotNotFound);
        }
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Permissionlessly refresh the persistent storage TTL of a user's bot list
    /// and all bots owned by that user (#397).
    pub fn bump_user_bots(env: Env, user: Address) -> Result<(), BotNFTError> {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::UserBots(user.clone()))
        {
            return Err(BotNFTError::NotFound);
        }
        env.storage().persistent().extend_ttl(
            &DataKey::UserBots(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        let bots = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(user))
            .unwrap_or_else(|| Vec::new(&env));
        for bot_id in bots.iter() {
            if env.storage().persistent().has(&DataKey::Bot(bot_id)) {
                env.storage().persistent().extend_ttl(
                    &DataKey::Bot(bot_id),
                    LEDGER_THRESHOLD,
                    LEDGER_BUMP,
                );
            }
        }
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    /// Return a page of bot IDs for a specific tier (#398).
    ///
    /// Paged in buckets of `TIER_PAGE_SIZE` (10). Bounded to guarantee predictable
    /// simulation cost without client-side N+1 filtering.
    pub fn get_bots_by_tier(env: Env, tier: BotTier, page: u32) -> Vec<u64> {
        let list = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::TierIndex(tier))
            .unwrap_or_else(|| Vec::new(&env));
        let start = page.saturating_mul(TIER_PAGE_SIZE) as usize;
        let mut result = Vec::new(&env);
        let len = list.len() as usize;
        if start >= len {
            return result;
        }
        let end = (start + TIER_PAGE_SIZE as usize).min(len);
        for i in start..end {
            if let Some(id) = list.get(i as u32) {
                result.push_back(id);
            }
        }
        result
    }

    /// Full record for one bot, with `accrual_rate` computed as the
    /// current tier base rate plus the stored rarity bonus. Reads the
    /// current layout first and falls back to the pre-`StoredBotNFT`
    /// layout for bots minted before variant/bonus were introduced.
    ///
    /// Errors: `BotNotFound` when the id was never minted or was burned.
    pub fn get_bot(env: Env, bot_id: u64) -> Result<BotNFT, BotNFTError> {
        let stored: StoredBotNFT = match env.storage().persistent().get(&DataKey::Bot(bot_id)) {
            Some(s) => s,
            None => {
                if let Some(b) = env
                    .storage()
                    .persistent()
                    .get::<_, BotNFT>(&DataKey::Bot(bot_id))
                {
                    StoredBotNFT {
                        id: b.id,
                        tier: b.tier,
                        owner: b.owner,
                        minter: b.minter,
                        minted_at: b.minted_at,
                        nickname: b.nickname,
                        variant: b.variant,
                        bonus_bps: b.bonus_bps,
                    }
                } else {
                    return Err(BotNFTError::BotNotFound);
                }
            }
        };

        let base_rate = Self::get_tier_rate_internal(&env, stored.tier);
        let effective_rate =
            base_rate.saturating_add(base_rate.saturating_mul(stored.bonus_bps as u64) / 10000);

        Ok(BotNFT {
            id: stored.id,
            tier: stored.tier,
            owner: stored.owner,
            minter: stored.minter,
            accrual_rate: effective_rate,
            minted_at: stored.minted_at,
            nickname: stored.nickname,
            variant: stored.variant,
            bonus_bps: stored.bonus_bps,
        })
    }

    /// Set or clear the owner-chosen nickname for a bot. Max 24 bytes; pass
    /// an empty string to clear. Only the current owner may rename.
    pub fn rename_bot(env: Env, bot_id: u64, name: String) -> Result<(), BotNFTError> {
        let mut stored: StoredBotNFT = env
            .storage()
            .persistent()
            .get(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)?;
        stored.owner.require_auth();
        if name.len() > 24 {
            return Err(BotNFTError::NicknameTooLong);
        }
        stored.nickname = if name.is_empty() { None } else { Some(name) };
        env.storage()
            .persistent()
            .set(&DataKey::Bot(bot_id), &stored);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    // ─── Issue #384: Supply tracking ───────────────────────────────────

    /// Total supply of all bots (minted minus burned).
    pub fn total_supply(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    /// Supply of bots for a specific tier. Reads the same persistent key
    /// that `mint`/`burn` maintain.
    pub fn tier_supply(env: Env, tier: BotTier) -> u64 {
        Self::read_tier_supply(&env, tier)
    }

    // ─── Issue #381: Token metadata / URI ────────────────────────────────

    /// Set the base URI for token metadata (admin only).
    pub fn set_base_uri(env: Env, base_uri: String) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::BaseUri, &base_uri);
        env.events()
            .publish((symbol_short!("base_uri"),), (admin, base_uri));
        Ok(())
    }

    /// Get the current base URI.
    pub fn base_uri(env: Env) -> Result<String, BotNFTError> {
        env.storage()
            .instance()
            .get(&DataKey::BaseUri)
            .ok_or(BotNFTError::NotFound)
    }

    /// Collection metadata: name, symbol, and base URI.
    pub fn collection_metadata(env: Env) -> Result<(String, String, String), BotNFTError> {
        let base = env
            .storage()
            .instance()
            .get(&DataKey::BaseUri)
            .unwrap_or_else(|| String::from_str(&env, ""));
        Ok((
            String::from_str(&env, "AutoMint Bot"),
            String::from_str(&env, "BOT"),
            base,
        ))
    }

    // ─── Issue #387: Registry management ─────────────────────────────────

    /// Get the current registry address.
    pub fn registry(env: Env) -> Result<Address, BotNFTError> {
        env.storage()
            .instance()
            .get(&DataKey::Registry)
            .ok_or(BotNFTError::NotFound)
    }

    /// Set the registry address (admin only).
    pub fn set_registry(env: Env, registry: Address) -> Result<(), BotNFTError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Registry, &registry);
        env.events()
            .publish((symbol_short!("registry"),), (admin, registry));
        Ok(())
    }

    /// Count of failed registry syncs.
    pub fn registry_fail_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::RegistryFailCount)
            .unwrap_or(0)
    }

    /// Metadata URI for `bot_id`. The traits are derived deterministically
    /// from sha256(bot_id, minted_at, owner); this URI exposes the
    /// derivation inputs (id, minted_at, variant, bonus_bps, owner) as query
    /// parameters so anyone can recompute `variant`/`bonus_bps` and confirm
    /// rarity off-chain.
    ///
    /// Errors: `BotNotFound`.
    pub fn token_uri(env: Env, bot_id: u64) -> Result<String, BotNFTError> {
        let bot: BotNFT = Self::get_bot(env.clone(), bot_id)?;
        let owner_str = bot.owner.to_string();
        let mut buf = Bytes::new(&env);
        buf.append(&Bytes::from_slice(&env, b"ipfs://automint/bot/"));
        Self::append_u64(&mut buf, bot.id);
        buf.append(&Bytes::from_slice(&env, b"/"));
        Self::append_u64(&mut buf, bot.minted_at);
        buf.append(&Bytes::from_slice(&env, b"?variant="));
        Self::append_u64(&mut buf, bot.variant as u64);
        buf.append(&Bytes::from_slice(&env, b"&bonus_bps="));
        Self::append_u64(&mut buf, bot.bonus_bps as u64);
        buf.append(&Bytes::from_slice(&env, b"&owner="));
        let n = owner_str.len() as usize;
        let mut tmp = [0u8; 64];
        owner_str.copy_into_slice(&mut tmp[..n]);
        buf.append(&Bytes::from_slice(&env, &tmp[..n]));
        let len = buf.len() as usize;
        let mut out = [0u8; 256];
        buf.copy_into_slice(&mut out[..len]);
        Ok(String::from_bytes(&env, &out[..len]))
    }

    fn append_u64(buf: &mut Bytes, mut n: u64) {
        if n == 0 {
            buf.push_back(b'0');
            return;
        }
        let mut digits = [0u8; 20];
        let mut i = 0u32;
        while n > 0 {
            digits[i as usize] = b'0' + (n % 10) as u8;
            n /= 10;
            i += 1;
        }
        let mut j = i as i32 - 1;
        while j >= 0 {
            buf.push_back(digits[j as usize]);
            j -= 1;
        }
    }

    /// Bot ids owned by `user`, in ownership order. Empty (not an error)
    /// when the user owns no bots. Paginate detailed records with
    /// `get_user_bots_detailed` or `get_bot`.
    pub fn get_user_bots(env: Env, user: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(user))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Full `BotNFT` records for up to the first `MAX_DETAILED_BOTS` bots
    /// owned by `user`, in ownership order. Replaces the N+1 fan-out of
    /// `get_user_bots` + `get_bot` with a single simulation; the cap is
    /// enforced here, contract-side, and callers paginate past it with the
    /// ID-based getters (#483).
    pub fn get_user_bots_detailed(env: Env, user: Address) -> Vec<BotNFT> {
        Self::get_user_bots_paged(env, user, 0, MAX_DETAILED_BOTS as u32)
    }

    /// Paged `BotNFT` records for bots owned by `user` starting at offset `start`
    /// up to `limit` (capped contract-side at `MAX_DETAILED_BOTS` = 50) (#1443).
    pub fn get_user_bots_paged(
        env: Env,
        user: Address,
        start: u32,
        limit: u32,
    ) -> Vec<BotNFT> {
        let ids = Self::get_user_bots(env.clone(), user);
        let capped_limit = (limit as usize).min(MAX_DETAILED_BOTS);
        let mut bots = Vec::new(&env);
        for id in ids.iter().skip(start as usize).take(capped_limit) {
            if let Ok(bot) = Self::get_bot(env.clone(), id) {
                bots.push_back(bot);
            }
        }
        bots
    }

    /// Sum of the effective accrual rates (tier base + rarity bonus) of
    /// every bot `user` owns. This is the rate accrual reads when starting
    /// or syncing a user, so it must stay consistent with `get_bot`'s
    /// `accrual_rate`. 0 when the user owns no bots.
    pub fn get_user_total_rate(env: Env, user: Address) -> u64 {
        let bot_ids = Self::get_user_bots(env.clone(), user);
        let mut total = 0_u64;
        for id in bot_ids.iter() {
            if let Ok(bot) = Self::get_bot(env.clone(), id) {
                total = total.saturating_add(bot.accrual_rate);
            }
        }
        total
    }

    /// Display name, current base rate and mint price for one tier.
    pub fn get_tier_info(env: Env, tier: BotTier) -> TierInfo {
        TierInfo {
            name: tier.name(&env),
            rate: Self::get_tier_rate_internal(&env, tier),
            price: tier.price(),
        }
    }

    /// Every tier's descriptor, in tier order (Basic .. Diamond).
    pub fn all_tiers(env: Env) -> Vec<TierInfo> {
        let tiers = [
            BotTier::Basic,
            BotTier::Bronze,
            BotTier::Silver,
            BotTier::Gold,
            BotTier::Diamond,
        ];
        let mut result = Vec::new(&env);
        for tier in tiers.iter() {
            result.push_back(TierInfo {
                name: tier.name(&env),
                rate: Self::get_tier_rate_internal(&env, *tier),
                price: tier.price(),
            });
        }
        result
    }

    /// The next bot id that will be assigned. Callers use it as the exclusive
    /// upper bound when paginating with `get_bots_range` (#391).
    pub fn next_id(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(1)
    }

    /// Up to `limit` existing bots whose ids fall in `[start_id, start_id + limit)`,
    /// skipping ids with no stored entry (burned or not yet minted). `limit`
    /// above `MAX_RANGE_LIMIT` (100) returns `RangeLimitExceeded` (#391).
    pub fn get_bots_range(env: Env, start_id: u64, limit: u32) -> Result<Vec<BotNFT>, BotNFTError> {
        if limit > MAX_RANGE_LIMIT {
            return Err(BotNFTError::RangeLimitExceeded);
        }
        let mut bots = Vec::new(&env);
        for offset in 0..limit as u64 {
            let id = start_id.saturating_add(offset);
            if let Ok(bot) = Self::get_bot(env.clone(), id) {
                bots.push_back(bot);
            }
        }
        Ok(bots)
    }

    /// Reserve the next bot id. Returns `Overflow` instead of trapping once
    /// the counter cannot advance, so a mint at the limit fails cleanly.
    fn get_next_id(env: &Env) -> Result<u64, BotNFTError> {
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let next = id.checked_add(1).ok_or(BotNFTError::Overflow)?;
        env.storage().instance().set(&DataKey::NextId, &next);
        Ok(id)
    }

    /// Number of bots minted for a given tier (supply tracking). Reads the
    /// persistent key that `do_mint`/`burn` maintain; the public
    /// `tier_supply` entrypoint reads a different (instance) key.
    fn read_tier_supply(env: &Env, tier: BotTier) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::TierSupply(tier))
            .unwrap_or(0)
    }

    /// Deterministic trait roll: sha256(bot_id, minted_at, owner) -> (variant, bonus_bps).
    /// `variant` is 0..=7 and `bonus_bps` is 0..500, so rarity is verifiable
    /// off-chain from the public inputs.
    fn derive_traits(env: &Env, bot_id: u64, minted_at: u64, owner: &Address) -> (u32, u32) {
        let mut buf = Bytes::new(env);
        buf.extend_from_array(&bot_id.to_be_bytes());
        buf.extend_from_array(&minted_at.to_be_bytes());
        let owner_str = owner.to_string();
        let n = owner_str.len() as usize;
        let mut tmp = [0u8; 64];
        owner_str.copy_into_slice(&mut tmp[..n]);
        buf.append(&Bytes::from_slice(env, &tmp[..n]));
        let hash = env.crypto().sha256(&buf);
        let bytes: [u8; 32] = hash.into();
        let h0 = u64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        let h1 = u64::from_be_bytes([
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
        ]);
        let variant = (h0 % 8) as u32;
        let bonus_bps = (h1 % 500) as u32;
        (variant, bonus_bps)
    }

    fn add_bot_to_user(env: &Env, user: &Address, bot_id: u64) {
        let mut bots = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(user.clone()))
            .unwrap_or_else(|| Vec::new(env));
        bots.push_back(bot_id);
        env.storage()
            .persistent()
            .set(&DataKey::UserBots(user.clone()), &bots);
        // #544: this entry previously only got the network's default
        // minimum persistent TTL at write time and was never explicitly
        // bumped, unlike every other persistent key in this contract — it
        // could silently archive (taking a user's entire bot list with it)
        // well before the 7-day retention window implied by LEDGER_BUMP.
        env.storage().persistent().extend_ttl(
            &DataKey::UserBots(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    fn remove_bot_from_user(env: &Env, user: &Address, bot_id: u64) {
        let bots = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(user.clone()))
            .unwrap_or_else(|| Vec::new(env));
        let mut new_bots = Vec::new(env);
        for id in bots.iter() {
            if id != bot_id {
                new_bots.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserBots(user.clone()), &new_bots);
        // #544: see add_bot_to_user — keep this entry's TTL in step too.
        env.storage().persistent().extend_ttl(
            &DataKey::UserBots(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    /// The admin address recorded at initialization. Required by the
    /// marketplace's `probe_bot_nft` check.
    ///
    /// Errors: `NotInitialized` when no admin is recorded.
    pub fn admin(env: Env) -> Result<Address, BotNFTError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)
    }

    fn add_bot_to_tier_index(env: &Env, tier: BotTier, bot_id: u64) {
        let mut list = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::TierIndex(tier))
            .unwrap_or_else(|| Vec::new(env));
        list.push_back(bot_id);
        env.storage()
            .persistent()
            .set(&DataKey::TierIndex(tier), &list);
        env.storage().persistent().extend_ttl(
            &DataKey::TierIndex(tier),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    fn remove_bot_from_tier_index(env: &Env, tier: BotTier, bot_id: u64) {
        let list = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::TierIndex(tier))
            .unwrap_or_else(|| Vec::new(env));
        let mut new_list = Vec::new(env);
        for id in list.iter() {
            if id != bot_id {
                new_list.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::TierIndex(tier), &new_list);
        env.storage().persistent().extend_ttl(
            &DataKey::TierIndex(tier),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    fn increment_bot_count(env: &Env, user: &Address, bot_id: u64) {
        let registry: Address = match env.storage().instance().get(&DataKey::Registry) {
            Some(r) => r,
            None => {
                Self::bump_registry_fail_count(env);
                env.events().publish(
                    (symbol_short!("regfail"), user.clone()),
                    (bot_id, symbol_short!("unset")),
                );
                return;
            }
        };
        let reg_client = RegistryClient::new(env, &registry);
        // Use the fallible client so a registry-side error (e.g. the owner is
        // not registered yet) is swallowed rather than panicking the flow (#399).
        if reg_client.try_increment_bot_count(user).is_err() {
            Self::bump_registry_fail_count(env);
            env.events().publish(
                (symbol_short!("regfail"), user.clone()),
                (bot_id, symbol_short!("incfail")),
            );
        }
    }

    /// Increment the registry failure counter (issue #387).
    fn bump_registry_fail_count(env: &Env) {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RegistryFailCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::RegistryFailCount, &(count + 1));
    }

    fn decrement_bot_count(env: &Env, user: &Address, bot_id: u64) {
        let registry: Address = match env.storage().instance().get(&DataKey::Registry) {
            Some(r) => r,
            None => {
                env.events().publish(
                    (symbol_short!("regfail"), user.clone()),
                    (bot_id, symbol_short!("unset")),
                );
                return;
            }
        };
        let reg_client = RegistryClient::new(env, &registry);
        if reg_client.try_decrement_bot_count(user).is_err() {
            env.events().publish(
                (symbol_short!("regfail"), user.clone()),
                (bot_id, symbol_short!("decfail")),
            );
        }
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use automint_testutils::{deploy_all, register_user};
    use soroban_sdk::{
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Env, IntoVal, String,
    };

    pub(crate) fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        BotNFTContractClient<'static>,
    ) {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        (
            deployment.env,
            deployment.admin,
            deployment.registry_id,
            deployment.token_id,
            client,
        )
    }

    // #394: admin-controlled mint for airdrops (no payment).
    #[test]
    fn test_admin_mint_grants_bot_without_payment() {
        let (env, _admin, _registry, _token, client) = setup();
        let to = Address::generate(&env);
        let id = client.admin_mint(&to, &BotTier::Gold);
        let bot = client.get_bot(&id);
        assert_eq!(bot.owner, to);
        assert_eq!(bot.tier, BotTier::Gold);
        // #395: effective rate includes the deterministic rarity bonus.
        let base = BotTier::Gold.rate();
        let expected = base + base * bot.bonus_bps as u64 / 10000;
        assert_eq!(bot.accrual_rate, expected);
        assert!(bot.variant <= 7);
        assert!(bot.bonus_bps < 500);
        assert!(client.token_uri(&id).len() > 10);
    }

    // #395: the bonus feeds into get_user_total_rate.
    #[test]
    fn test_trait_bonus_feeds_total_rate() {
        let (env, _admin, _registry, _token, client) = setup();
        let to = Address::generate(&env);
        let id = client.admin_mint(&to, &BotTier::Gold);
        let bot = client.get_bot(&id);
        assert_eq!(client.get_user_total_rate(&to), bot.accrual_rate);
    }

    // #394: batch mint works and is capped in size.
    #[test]
    fn test_admin_mint_batch_works() {
        let (env, _admin, _registry, _token, client) = setup();
        let mut recipients = Vec::new(&env);
        for _ in 0..5 {
            recipients.push_back((Address::generate(&env), BotTier::Silver));
        }
        let ids = client.admin_mint_batch(&recipients);
        assert_eq!(ids.len(), 5);
    }

    #[test]
    fn test_admin_mint_batch_too_large_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let mut recipients = Vec::new(&env);
        for _ in 0..51 {
            recipients.push_back((Address::generate(&env), BotTier::Basic));
        }
        assert!(client.try_admin_mint_batch(&recipients).is_err());
    }

    // #394 + caps: once a tier hits its supply cap, further mints (including a
    // batch) fail entirely.
    #[test]
    fn test_admin_mint_batch_respects_supply_cap() {
        let (env, _admin, _registry, _token, client) = setup();
        for _ in 0..MAX_TIER_SUPPLY {
            client.admin_mint(&Address::generate(&env), &BotTier::Basic);
        }
        let mut recipients = Vec::new(&env);
        for _ in 0..2 {
            recipients.push_back((Address::generate(&env), BotTier::Basic));
        }
        assert!(client.try_admin_mint_batch(&recipients).is_err());
        assert!(client
            .try_admin_mint(&Address::generate(&env), &BotTier::Basic)
            .is_err());
    }

    // #394: admin_mint requires the admin.
    #[test]
    fn test_admin_mint_requires_admin() {
        let env = Env::default();
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let payment_token = Address::generate(&env);
        let registry_id = env.register_contract(None, automint_registry::RegistryContract);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), registry_id.clone(), payment_token.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize(&admin, &registry_id, &payment_token);
        // No admin authorization for the subsequent call -> rejected.
        env.mock_auths(&[]);
        let to = Address::generate(&env);
        assert!(client.try_admin_mint(&to, &BotTier::Basic).is_err());
    }

    pub(crate) fn fund_user(env: &Env, token: &Address, user: &Address, amount: i128) {
        let token_client = automint_token::AMTTokenClient::new(env, token);
        let _ = token_client.mint(user, &amount);
    }

    #[test]
    fn test_mint_basic_assigns_sequential_ids() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let id1 = client.mint_basic(&user);
        let id2 = client.admin_mint(&user, &BotTier::Basic);
        let id3 = client.admin_mint(&user, &BotTier::Basic);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }

    #[test]
    fn test_mint_tier_charges_correct_price() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        fund_user(&env, &token, &user, 100_000_000_000);
        let basic_id = client.mint_tier(&user, &Tier::Basic);
        let advanced_id = client.mint_tier(&user, &Tier::Advanced);
        let premium_id = client.mint_tier(&user, &Tier::Premium);

        let basic_bot = client.get_bot(&basic_id);
        let advanced_bot = client.get_bot(&advanced_id);
        let premium_bot = client.get_bot(&premium_id);

        // Base rate plus the deterministic rarity bonus (see #395).
        assert_eq!(
            basic_bot.accrual_rate,
            1 + 1 * basic_bot.bonus_bps as u64 / 10000
        );
        assert_eq!(
            advanced_bot.accrual_rate,
            5 + 5 * advanced_bot.bonus_bps as u64 / 10000
        );
        assert_eq!(
            premium_bot.accrual_rate,
            25 + 25 * premium_bot.bonus_bps as u64 / 10000
        );

        assert_eq!(basic_bot.nickname, None);
        assert_eq!(advanced_bot.nickname, None);
        assert_eq!(premium_bot.nickname, None);

        assert_eq!(basic_bot.tier, BotTier::Basic);
        assert_eq!(advanced_bot.tier, BotTier::Bronze);
        assert_eq!(premium_bot.tier, BotTier::Silver);

        assert_eq!(basic_bot.minted_at, env.ledger().timestamp());
    }

    #[test]
    fn test_transfer_changes_both_owners_bot_lists() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");

        let bot_id = client.mint_basic(&alice);
        assert_eq!(client.get_user_bots(&alice).len(), 1);
        assert_eq!(client.get_user_bots(&bob).len(), 0);

        client.transfer(&bot_id, &alice, &bob);
        assert_eq!(client.get_user_bots(&alice).len(), 0);
        assert_eq!(client.get_user_bots(&bob).len(), 1);
    }

    #[test]
    fn test_transfer_updates_bot_owner() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");

        let bot_id = client.mint_basic(&alice);
        client.transfer(&bot_id, &alice, &bob);

        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, bob);
    }

    #[test]
    fn test_get_user_bots_multiple() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let id1 = client.mint_basic(&user);
        let id2 = client.admin_mint(&user, &BotTier::Basic);
        let id3 = client.admin_mint(&user, &BotTier::Basic);

        let bots = client.get_user_bots(&user);
        assert_eq!(bots.len(), 3);
        assert_eq!(bots.get(0), Some(id1));
        assert_eq!(bots.get(1), Some(id2));
        assert_eq!(bots.get(2), Some(id3));
    }

    // #483: bulk detail read used by the dashboard instead of an N+1 fan-out.
    #[test]
    fn test_get_user_bots_detailed_returns_full_records() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let id1 = client.mint_basic(&user);
        let id2 = client.admin_mint(&user, &BotTier::Basic);

        let detailed = client.get_user_bots_detailed(&user);
        assert_eq!(detailed.len(), 2);
        assert_eq!(detailed.get(0).map(|bot| bot.id), Some(id1));
        assert_eq!(detailed.get(1).map(|bot| bot.id), Some(id2));
        assert_eq!(
            detailed.get(0).map(|bot| bot.owner.clone()),
            Some(user.clone())
        );
    }

    #[test]
    fn test_get_user_bots_detailed_empty_for_user_with_no_bots() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.get_user_bots_detailed(&user).len(), 0);
    }

    // #483: the result is capped contract-side at MAX_DETAILED_BOTS even
    // when the owner has more bots than the cap.
    #[test]
    fn test_get_user_bots_detailed_caps_at_max() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        // 50 Basic (the per-tier supply cap) plus 1 Bronze = 51 owned bots.
        for _ in 0..MAX_DETAILED_BOTS {
            client.admin_mint(&user, &BotTier::Basic);
        }
        client.admin_mint(&user, &BotTier::Bronze);

        assert_eq!(
            client.get_user_bots(&user).len(),
            MAX_DETAILED_BOTS as u32 + 1
        );
        assert_eq!(
            client.get_user_bots_detailed(&user).len(),
            MAX_DETAILED_BOTS as u32
        );

        // #1443: get_user_bots_paged allows retrieving the remaining bots past the 50 cap
        let paged = client.get_user_bots_paged(&user, &50, &10);
        assert_eq!(paged.len(), 1);
        assert_eq!(paged.get(0).map(|b| b.tier), Some(BotTier::Bronze));
    }

    #[test]
    fn test_get_user_total_rate_sums_owned_bots() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        fund_user(&env, &token, &user, 100_000_000_000);

        let id1 = client.mint_basic(&user);
        let id2 = client.mint_tier(&user, &Tier::Advanced);
        let id3 = client.mint_tier(&user, &Tier::Premium);

        // #395: each bot's effective rate includes its deterministic bonus.
        let expected = client.get_bot(&id1).accrual_rate
            + client.get_bot(&id2).accrual_rate
            + client.get_bot(&id3).accrual_rate;
        assert_eq!(client.get_user_total_rate(&user), expected);
        assert!(expected > 31);
    }

    #[test]
    fn test_double_initialize_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let admin = Address::generate(&env);
        let registry = Address::generate(&env);
        assert_eq!(
            client.try_initialize(&admin, &registry, &Address::generate(&env)),
            Err(Ok(BotNFTError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_initialize_sets_admin() {
        let (_env, admin, _registry, _token, client) = setup();
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_mint_basic_before_init_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let owner = Address::generate(&env);
        assert_eq!(
            client.try_mint_basic(&owner),
            Err(Ok(BotNFTError::NotInitialized))
        );
    }

    #[test]
    fn test_mint_basic_sets_basic_tier_and_owner() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");
        let bot_id = client.mint_basic(&owner);
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, owner);
        assert!(bot.tier == BotTier::Basic);
    }

    #[test]
    fn test_mint_basic_increments_registry_count() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");
        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry);
        assert_eq!(reg_client.get_user(&owner).bot_count, 0);
        client.mint_basic(&owner);
        client.admin_mint(&owner, &BotTier::Basic);
        assert_eq!(reg_client.get_user(&owner).bot_count, 2);
    }

    #[test]
    fn test_mint_basic_unregistered_owner_still_mints() {
        // A registry error (owner not registered) must be swallowed, not
        // panic the mint.
        let (env, _admin, _registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let bot_id = client.mint_basic(&owner);
        assert_eq!(bot_id, 1);
        assert_eq!(client.get_user_bots(&owner).len(), 1);
    }

    #[test]
    fn test_transfer_unauthorized() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");

        let bot_id = client.mint_basic(&alice);
        let result = client.try_transfer(&bot_id, &bob, &charlie);
        assert_eq!(result, Err(Ok(BotNFTError::NotOwner)));
    }

    #[test]
    fn test_transfer_self_transfer_is_noop() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");

        let bot_id = client.mint_basic(&alice);
        let result = client.try_transfer(&bot_id, &alice, &alice);
        assert!(result.is_ok());
        assert_eq!(client.get_user_bots(&alice).len(), 1);
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, alice);
    }

    #[test]
    fn test_transfer_nonexistent_bot_fails() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");

        let result = client.try_transfer(&999, &alice, &bob);
        assert_eq!(result, Err(Ok(BotNFTError::BotNotFound)));
    }

    #[test]
    fn test_get_user_total_rate_empty_user() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.get_user_total_rate(&user), 0);
    }

    #[test]
    fn test_get_user_total_rate_single_bot() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        client.mint_basic(&user);
        assert_eq!(client.get_user_total_rate(&user), 1);
    }

    #[test]
    fn test_get_user_total_rate_after_transfer() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");

        let bot_id = client.mint_basic(&alice);
        assert_eq!(client.get_user_total_rate(&alice), 1);
        assert_eq!(client.get_user_total_rate(&bob), 0);

        client.transfer(&bot_id, &alice, &bob);
        assert_eq!(client.get_user_total_rate(&alice), 0);
        assert_eq!(client.get_user_total_rate(&bob), 1);
    }

    // --- #391: get_bots_range / next_id ---

    #[test]
    fn test_next_id_starts_at_one_before_any_mint() {
        let (_env, _admin, _registry, _token, client) = setup();
        assert_eq!(client.next_id(), 1);
    }

    #[test]
    fn test_get_bots_range_returns_existing_bots_in_order() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        // One free Basic bot per account, so the rest are admin grants.
        client.mint_basic(&user);
        client.admin_mint(&user, &BotTier::Basic);
        client.admin_mint(&user, &BotTier::Basic);
        // IDs 1, 2, 3 now exist.
        let bots = client.get_bots_range(&1, &3);
        assert_eq!(bots.len(), 3);
        assert_eq!(bots.get(0).unwrap().id, 1);
        assert_eq!(bots.get(1).unwrap().id, 2);
        assert_eq!(bots.get(2).unwrap().id, 3);
    }

    #[test]
    fn test_get_bots_range_skips_gaps() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        client.mint_basic(&user); // id=1
        client.admin_mint(&user, &BotTier::Basic); // id=2
        client.admin_mint(&user, &BotTier::Basic); // id=3
                                                   // Ask for ids 1..=5; id 4 and 5 don't exist yet and are skipped.
        let bots = client.get_bots_range(&1, &5);
        assert_eq!(bots.len(), 3);
        assert_eq!(bots.get(0).unwrap().id, 1);
        assert_eq!(bots.get(2).unwrap().id, 3);
    }

    #[test]
    fn test_get_bots_range_empty_when_no_bots_in_window() {
        let (_env, _admin, _registry, _token, client) = setup();
        // start beyond any minted id.
        let bots = client.get_bots_range(&1000, &10);
        assert_eq!(bots.len(), 0);
    }

    #[test]
    fn test_get_bots_range_over_cap_returns_error() {
        let (_env, _admin, _registry, _token, client) = setup();
        let result = client.try_get_bots_range(&1, &101);
        assert!(matches!(result, Err(Ok(BotNFTError::RangeLimitExceeded))));
    }

    #[test]
    fn test_get_bots_range_exactly_at_cap_succeeds() {
        let (_env, _admin, _registry, _token, client) = setup();
        let result = client.try_get_bots_range(&1, &100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_next_id_advances_with_each_mint() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let before = client.next_id();
        client.mint_basic(&user);
        assert_eq!(client.next_id(), before + 1);
    }

    #[test]
    fn test_admin_returns_initialized_admin() {
        let (_env, admin, _registry, _token, client) = setup();
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_admin_fails_if_not_initialized() {
        let env = Env::default();
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let result = client.try_admin();
        assert_eq!(result, Err(Ok(BotNFTError::NotInitialized)));
    }

    #[test]
    fn test_bot_tier_prices() {
        assert_eq!(BotTier::Basic.price(), 0);
        assert_eq!(BotTier::Bronze.price(), 500_0000000);
        assert_eq!(BotTier::Silver.price(), 2000_0000000);
        assert_eq!(BotTier::Gold.price(), 7500_0000000);
        assert_eq!(BotTier::Diamond.price(), 25000_0000000);
    }

    #[test]
    fn test_bot_tier_names() {
        let env = Env::default();
        assert_eq!(
            BotTier::Basic.name(&env),
            String::from_str(&env, "Basic Bot")
        );
        assert_eq!(
            BotTier::Bronze.name(&env),
            String::from_str(&env, "Bronze Bot")
        );
        assert_eq!(
            BotTier::Silver.name(&env),
            String::from_str(&env, "Silver Bot")
        );
        assert_eq!(BotTier::Gold.name(&env), String::from_str(&env, "Gold Bot"));
        assert_eq!(
            BotTier::Diamond.name(&env),
            String::from_str(&env, "Diamond Bot")
        );
    }

    #[test]
    fn test_bot_tier_rates() {
        assert_eq!(BotTier::Basic.rate(), 1);
        assert_eq!(BotTier::Bronze.rate(), 5);
        assert_eq!(BotTier::Silver.rate(), 25);
        assert_eq!(BotTier::Gold.rate(), 100);
        assert_eq!(BotTier::Diamond.rate(), 500);
    }

    #[test]
    fn test_get_tier_info() {
        let (env, _admin, _registry, _token, client) = setup();

        let info = client.get_tier_info(&BotTier::Gold);
        assert_eq!(info.name, String::from_str(&env, "Gold Bot"));
        assert_eq!(info.rate, 100);
        assert_eq!(info.price, 7500_0000000);
    }

    #[test]
    fn test_get_bot_returns_correct_bot() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "botowner");
        let bot_id = client.mint_basic(&user);

        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.id, bot_id);
        assert_eq!(bot.owner, user);
        assert_eq!(bot.accrual_rate, 1);
        assert_eq!(bot.tier, BotTier::Basic);
    }

    #[test]
    fn test_get_bot_nonexistent_id_fails() {
        let (_env, _admin, _registry, _token, client) = setup();
        let result = client.try_get_bot(&999);
        assert!(matches!(result, Err(Ok(BotNFTError::BotNotFound))));
    }

    #[test]
    fn test_get_bot_zero_id_fails() {
        let (_env, _admin, _registry, _token, client) = setup();
        let result = client.try_get_bot(&0);
        assert!(matches!(result, Err(Ok(BotNFTError::BotNotFound))));
    }

    #[test]
    fn test_bot_nft_error_variants() {
        assert_eq!(BotNFTError::AlreadyInitialized as u32, 1);
        assert_eq!(BotNFTError::BotNotFound as u32, 5);
        assert_eq!(BotNFTError::NotOwner as u32, 6);
        assert_eq!(BotNFTError::InsufficientFunds as u32, 7);
        assert_eq!(BotNFTError::NotInitialized as u32, 8);
        assert_eq!(BotNFTError::NicknameTooLong as u32, 11);
    }

    #[test]
    fn test_rename_bot_sets_nickname() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "owner");
        let bot_id = client.mint_basic(&user);

        assert_eq!(client.get_bot(&bot_id).nickname, None);

        client.rename_bot(&bot_id, &String::from_str(&env, "Sparky"));
        assert_eq!(
            client.get_bot(&bot_id).nickname,
            Some(String::from_str(&env, "Sparky"))
        );
    }

    #[test]
    fn test_rename_bot_clears_with_empty_string() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "owner");
        let bot_id = client.mint_basic(&user);

        client.rename_bot(&bot_id, &String::from_str(&env, "Temp"));
        client.rename_bot(&bot_id, &String::from_str(&env, ""));
        assert_eq!(client.get_bot(&bot_id).nickname, None);
    }

    #[test]
    fn test_rename_bot_rejects_oversized_name() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "owner");
        let bot_id = client.mint_basic(&user);

        // 25 bytes — one over the limit.
        let too_long = String::from_str(&env, "AAAAAAAAAAAAAAAAAAAAAAAAA");
        let result = client.try_rename_bot(&bot_id, &too_long);
        assert!(matches!(result, Err(Ok(BotNFTError::NicknameTooLong))));
    }

    #[test]
    fn test_rename_bot_rejects_non_owner() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");
        let bot_id = client.mint_basic(&alice);

        let result = client
            .mock_auths(&[MockAuth {
                address: &bob,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "rename_bot",
                    args: (bot_id, String::from_str(&env, "Hacked")).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_rename_bot(&bot_id, &String::from_str(&env, "Hacked"));
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_tier_basic_is_free() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        let token_client = automint_token::AMTTokenClient::new(&env, &token_id);
        let initial_balance = token_client.balance(&user);
        let bot_id = client.mint_tier(&user, &Tier::Basic);
        let final_balance = token_client.balance(&user);

        // Basic tier should not charge
        assert_eq!(initial_balance, final_balance);
        assert_eq!(bot_id, 1); // First mint in setup uses id 0
    }

    #[test]
    fn test_mint_tier_insufficient_funds() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        // User has 0 balance, cannot mint Advanced tier. mint_tier() calls the
        // token contract's `transfer` (not `try_transfer`), which panics on
        // insufficient balance rather than returning a BotNFTError variant, so
        // this surfaces as a host-level invocation error rather than a typed
        // contract error we can match on. Kept as a plain is_err() check.
        let result = client.try_mint_tier(&user, &Tier::Advanced);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_tier_sequential_ids() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        let bot1 = client.mint_tier(&user, &Tier::Basic);
        let bot2 = client.mint_tier(&user, &Tier::Basic);
        let bot3 = client.mint_tier(&user, &Tier::Basic);

        assert_eq!(bot1, 1); // First mint in setup uses id 0
        assert_eq!(bot2, 2);
        assert_eq!(bot3, 3);
    }

    #[test]
    fn test_mint_tier_updates_user_bot_list() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        let bot_id = client.mint_tier(&user, &Tier::Basic);
        let user_bots = client.get_user_bots(&user);

        assert_eq!(user_bots.len(), 1);
        assert_eq!(user_bots.get(0).unwrap(), bot_id);
    }

    #[test]
    fn test_mint_tier_correct_rate_assignment() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        // Mint basic (free)
        let bot_basic = client.mint_tier(&user, &Tier::Basic);

        // Fund user and mint advanced
        fund_user(&env, &token_id, &user, 500_0000000);
        let bot_advanced = client.mint_tier(&user, &Tier::Advanced);

        // Fund user more and mint premium
        fund_user(&env, &token_id, &user, 2000_0000000);
        let bot_premium = client.mint_tier(&user, &Tier::Premium);

        let basic_nft = client.get_bot(&bot_basic);
        let advanced_nft = client.get_bot(&bot_advanced);
        let premium_nft = client.get_bot(&bot_premium);

        // Base rate plus the deterministic rarity bonus (see #395).
        assert_eq!(
            basic_nft.accrual_rate,
            1 + 1 * basic_nft.bonus_bps as u64 / 10000
        );
        assert_eq!(
            advanced_nft.accrual_rate,
            5 + 5 * advanced_nft.bonus_bps as u64 / 10000
        );
        assert_eq!(
            premium_nft.accrual_rate,
            25 + 25 * premium_nft.bonus_bps as u64 / 10000
        );
    }

    #[test]
    fn test_get_tier_info_all_tiers() {
        let (env, _admin, _registry, _token, client) = setup();

        let basic = client.get_tier_info(&BotTier::Basic);
        assert_eq!(basic.name, String::from_str(&env, "Basic Bot"));
        assert_eq!(basic.rate, 1);
        assert_eq!(basic.price, 0);

        let bronze = client.get_tier_info(&BotTier::Bronze);
        assert_eq!(bronze.name, String::from_str(&env, "Bronze Bot"));
        assert_eq!(bronze.rate, 5);
        assert_eq!(bronze.price, 500_0000000);

        let silver = client.get_tier_info(&BotTier::Silver);
        assert_eq!(silver.name, String::from_str(&env, "Silver Bot"));
        assert_eq!(silver.rate, 25);
        assert_eq!(silver.price, 2000_0000000);

        let gold = client.get_tier_info(&BotTier::Gold);
        assert_eq!(gold.name, String::from_str(&env, "Gold Bot"));
        assert_eq!(gold.rate, 100);
        assert_eq!(gold.price, 7500_0000000);

        let diamond = client.get_tier_info(&BotTier::Diamond);
        assert_eq!(diamond.name, String::from_str(&env, "Diamond Bot"));
        assert_eq!(diamond.rate, 500);
        assert_eq!(diamond.price, 25000_0000000);
    }

    #[test]
    fn test_all_tiers() {
        let (env, _admin, _registry, _token, client) = setup();

        let all = client.all_tiers();
        assert_eq!(all.len(), 5);

        let basic = all.get(0).unwrap();
        assert_eq!(basic.name, String::from_str(&env, "Basic Bot"));
        assert_eq!(basic.rate, 1);
        assert_eq!(basic.price, 0);

        let bronze = all.get(1).unwrap();
        assert_eq!(bronze.name, String::from_str(&env, "Bronze Bot"));
        assert_eq!(bronze.rate, 5);

        let diamond = all.get(4).unwrap();
        assert_eq!(diamond.name, String::from_str(&env, "Diamond Bot"));
        assert_eq!(diamond.rate, 500);
        assert_eq!(diamond.price, 25000_0000000);
    }

    // --- Issue #544: storage TTL / archival coverage ---
    //
    // Each BotNFT is persistent storage bumped via
    // `extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP)` at mint time (and, after
    // the #544 fix above, on every `transfer`). These tests simulate ledger
    // advancement with `automint_testutils::advance_ledger` to exercise
    // that TTL/archival behaviour directly.

    // Control case: a bot minted well within the TTL window is still
    // readable.
    #[test]
    fn test_bot_survives_before_ttl_expiry() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        let bot_id = client.mint_basic(&alice);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP / 2);

        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, alice);
    }

    // A bot whose TTL is never refreshed becomes archived once the ledger
    // sequence passes its live_until_ledger_seq. As in the registry
    // contract, the whole contract instance shares the same TTL bump here
    // (set at `initialize`), so an unrefreshed advance past LEDGER_BUMP
    // archives the instance itself and access is rejected with a hard
    // panic (matching how a real network would never re-enter the
    // contract), caught here via `catch_unwind`.
    #[test]
    fn test_bot_archived_after_ttl_expiry() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        let bot_id = client.mint_basic(&alice);

        automint_testutils::advance_past_ttl(&env, LEDGER_BUMP);

        let outcome =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.get_bot(&bot_id)));
        assert!(outcome.is_err(), "expected archived entry access to fail");
    }

    // #544 fix verification: `transfer` now calls `extend_ttl` on both the
    // bot entry and the contract instance on every ownership change.
    // Advancing to just before the original expiry, transferring the bot
    // (which renews both TTLs), then advancing well past the original
    // expiry ledger must still leave the bot readable under its new owner.
    //
    // Verified manually that this test exercises the renewal (not just Env
    // defaults) by temporarily removing the two `extend_ttl` calls added to
    // `transfer` above: with them removed, this test fails with an
    // archived-entry panic at the final `get_bot` call.
    #[test]
    fn test_transfer_extend_ttl_restores_access_near_expiry() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");
        let bot_id = client.mint_basic(&alice);

        // Advance to just before the original expiry, then transfer —
        // which renews both the bot entry's TTL and the contract
        // instance's TTL.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.transfer(&bot_id, &alice, &bob);

        // Advance well past what would have been the bot's *original*
        // expiry ledger. Without the transfer-time renewal, it would now
        // be archived.
        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, bob);
    }

    // --- Issue #397: permissionless bump_bot and bump_user_bots ---

    #[test]
    fn test_bot_bump_prevents_archival_after_threshold() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        let bot_id = client.mint_basic(&alice);

        // Control case: advancing past TTL without bumping archives the bot entry.
        let env_expired = env.clone();
        automint_testutils::advance_past_ttl(&env_expired, LEDGER_BUMP);
        let expired_outcome =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.get_bot(&bot_id)));
        assert!(
            expired_outcome.is_err(),
            "expected unbumped entry to be archived"
        );

        // Fresh case: advance near expiry, call bump_bot, advance past original expiry -> still accessible.
        let (env2, _admin, registry2, _token, client2) = setup();
        let bob = Address::generate(&env2);
        register_user(&env2, &registry2, &bob, "bob");
        let bot_id2 = client2.mint_basic(&bob);

        automint_testutils::advance_ledger(&env2, LEDGER_BUMP - 1);
        client2.bump_bot(&bot_id2);

        automint_testutils::advance_ledger(&env2, LEDGER_BUMP / 2);
        let bot2 = client2.get_bot(&bot_id2);
        assert_eq!(bot2.owner, bob);

        // Also verify bump_user_bots prevents archival of both the user list and bots.
        let (env3, _admin, registry3, _token, client3) = setup();
        let charlie = Address::generate(&env3);
        register_user(&env3, &registry3, &charlie, "charlie");
        let bot_id3 = client3.mint_basic(&charlie);

        automint_testutils::advance_ledger(&env3, LEDGER_BUMP - 1);
        client3.bump_user_bots(&charlie);

        automint_testutils::advance_ledger(&env3, LEDGER_BUMP / 2);
        let bot_user = client3.get_bot(&bot_id3);
        assert_eq!(bot_user.owner, charlie);
        assert_eq!(client3.get_user_bots(&charlie).len(), 1);
    }

    #[test]
    fn test_bump_bot_nonexistent_fails() {
        let (_env, _admin, _registry, _token, client) = setup();
        let result = client.try_bump_bot(&999);
        assert_eq!(result, Err(Ok(BotNFTError::BotNotFound)));
    }

    #[test]
    fn test_bump_user_bots_nonexistent_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let ghost = Address::generate(&env);
        let result = client.try_bump_user_bots(&ghost);
        assert_eq!(result, Err(Ok(BotNFTError::NotFound)));
    }

    // --- Issue #398: get_bots_by_tier indexing & paging ---

    #[test]
    fn test_get_bots_by_tier_pagination_and_bounds() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "diamond_collector");

        // Mint 25 bots of Diamond tier
        for _ in 0..25 {
            client.admin_mint(&user, &BotTier::Diamond);
        }

        // Page 0: exactly TIER_PAGE_SIZE (10) bots
        let page0 = client.get_bots_by_tier(&BotTier::Diamond, &0);
        assert_eq!(page0.len(), TIER_PAGE_SIZE);
        assert_eq!(page0.get(0), Some(1));
        assert_eq!(page0.get(9), Some(10));

        // Page 1: exactly TIER_PAGE_SIZE (10) bots
        let page1 = client.get_bots_by_tier(&BotTier::Diamond, &1);
        assert_eq!(page1.len(), TIER_PAGE_SIZE);
        assert_eq!(page1.get(0), Some(11));
        assert_eq!(page1.get(9), Some(20));

        // Page 2: remaining 5 bots
        let page2 = client.get_bots_by_tier(&BotTier::Diamond, &2);
        assert_eq!(page2.len(), 5);
        assert_eq!(page2.get(0), Some(21));
        assert_eq!(page2.get(4), Some(25));

        // Page 3: beyond total -> empty
        let page3 = client.get_bots_by_tier(&BotTier::Diamond, &3);
        assert_eq!(page3.len(), 0);
    }

    #[test]
    fn test_tier_index_unaffected_by_transfer() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");

        let id1 = client.admin_mint(&alice, &BotTier::Gold);
        let id2 = client.admin_mint(&alice, &BotTier::Gold);

        let before = client.get_bots_by_tier(&BotTier::Gold, &0);
        assert_eq!(before.len(), 2);
        assert_eq!(before.get(0), Some(id1));
        assert_eq!(before.get(1), Some(id2));

        // Transfer id1 from Alice to Bob
        client.transfer(&id1, &alice, &bob);

        // Tier index is strictly updated on mint and burn, NEVER on transfer
        let after = client.get_bots_by_tier(&BotTier::Gold, &0);
        assert_eq!(after.len(), 2);
        assert_eq!(after.get(0), Some(id1));
        assert_eq!(after.get(1), Some(id2));
    }

    #[test]
    fn test_tier_index_consistent_across_mint_burn_and_transfer() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");

        let b1 = client.admin_mint(&alice, &BotTier::Bronze);
        let b2 = client.admin_mint(&alice, &BotTier::Bronze);
        let b3 = client.admin_mint(&bob, &BotTier::Bronze);

        // Transfer b2 from Alice to Bob
        client.transfer(&b2, &alice, &bob);
        let list_after_transfer = client.get_bots_by_tier(&BotTier::Bronze, &0);
        assert_eq!(list_after_transfer.len(), 3);
        assert_eq!(list_after_transfer.get(0), Some(b1));
        assert_eq!(list_after_transfer.get(1), Some(b2));
        assert_eq!(list_after_transfer.get(2), Some(b3));

        // Burn b2 by Bob
        client.burn(&b2, &bob);

        let list_after_burn = client.get_bots_by_tier(&BotTier::Bronze, &0);
        assert_eq!(list_after_burn.len(), 2);
        assert_eq!(list_after_burn.get(0), Some(b1));
        assert_eq!(list_after_burn.get(1), Some(b3));
        assert!(client.try_get_bot(&b2).is_err());
    }

    #[test]
    fn test_burn_not_owner_fails() {
        let (env, _admin, registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        register_user(&env, &registry, &alice, "alice");
        register_user(&env, &registry, &bob, "bob");

        let id = client.mint_basic(&alice);
        let result = client.try_burn(&id, &bob);
        assert_eq!(result, Err(Ok(BotNFTError::NotOwner)));
    }

    #[test]
    fn test_burn_nonexistent_bot_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let alice = Address::generate(&env);
        let result = client.try_burn(&999, &alice);
        assert_eq!(result, Err(Ok(BotNFTError::BotNotFound)));
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
    use soroban_sdk::{Env, IntoVal};

    fn setup_registry(env: &Env) -> Address {
        let admin = Address::generate(env);
        let registry_id = env.register_contract(None, automint_registry::RegistryContract);
        let reg_client = automint_registry::RegistryContractClient::new(env, &registry_id);
        env.mock_all_auths();
        reg_client.initialize(&admin);
        registry_id
    }

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        env.mock_auths(&[]);
        let result = client.try_initialize(&admin, &registry_id, &Address::generate(&env));
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let payment_token = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), registry_id.clone(), payment_token.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_initialize(&admin, &registry_id, &payment_token);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mint_basic_fails_without_owner_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));

        let owner = Address::generate(&env);
        env.mock_auths(&[]);
        let result = client.try_mint_basic(&owner);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_basic_succeeds_with_owner_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));

        let owner = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "mint_basic",
                args: (owner.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_mint_basic(&owner);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mint_tier_fails_without_owner_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));

        let token_id = env.register_contract(None, automint_token::AMTToken);
        let owner = Address::generate(&env);
        env.mock_auths(&[]);
        let result = client.try_mint_tier(&owner, &Tier::Basic);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_tier_succeeds_with_owner_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));

        let owner = Address::generate(&env);
        // Tier::Basic carries a zero price, so no token transfer is required.
        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "mint_tier",
                args: (owner.clone(), Tier::Basic).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_mint_tier(&owner, &Tier::Basic);
        assert!(result.is_ok());
    }

    #[test]
    fn test_transfer_fails_without_from_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));
        let owner = Address::generate(&env);
        let bot_id = client.mint_basic(&owner);

        let to = Address::generate(&env);
        env.mock_auths(&[]);
        let result = client.try_transfer(&bot_id, &owner, &to);
        assert!(result.is_err());
    }

    #[test]
    fn test_transfer_succeeds_with_from_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));
        let owner = Address::generate(&env);
        let bot_id = client.mint_basic(&owner);

        let to = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "transfer",
                args: (bot_id, owner.clone(), to.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_transfer(&bot_id, &owner, &to);
        assert!(result.is_ok());
    }

    #[test]
    fn test_set_tier_rate_updates_get_user_total_rate_immediately() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));

        let alice = Address::generate(&env);
        let bot_id = client.mint_basic(&alice);
        let bot = client.get_bot(&bot_id);
        let bonus = bot.bonus_bps as u64;

        let rate1 = client.get_user_total_rate(&alice);
        assert_eq!(rate1, 1 + (1 * bonus / 10000));

        // Change Basic tier rate from 1 to 2
        client.set_tier_rate(&BotTier::Basic, &2_u64);

        let rate2 = client.get_user_total_rate(&alice);
        assert_eq!(rate2, 2 + (2 * bonus / 10000));
    }

    #[test]
    fn test_set_tier_rate_bounded_change_enforced() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));

        // Base rate for Basic tier is 1, max allowed 2x is 2. Setting to 5 should fail.
        let result = client.try_set_tier_rate(&BotTier::Basic, &5_u64);
        assert_eq!(result, Err(Ok(BotNFTError::Unauthorized)));
    }

    #[test]
    fn test_burn_fails_without_owner_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));
        let owner = Address::generate(&env);
        let bot_id = client.mint_basic(&owner);

        env.mock_auths(&[]);
        let result = client.try_burn(&bot_id, &owner);
        assert!(result.is_err());
    }

    #[test]
    fn test_burn_succeeds_with_owner_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin, &registry_id, &Address::generate(&env));
        let owner = Address::generate(&env);
        let bot_id = client.mint_basic(&owner);

        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "burn",
                args: (bot_id, owner.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_burn(&bot_id, &owner);
        assert!(result.is_ok());
    }
}

// ── Issue #399: cross-contract registry failure mode tests ────────────────
//
// These tests exercise all failure paths in the Bot NFT <-> Registry interaction:
// 1. mint with no registry configured (DataKey::Registry unset)
// 2. mint where the owner is unregistered in Registry
// 3. transfer between one registered and one unregistered party (both directions)
// 4. registry paused / access restricted mid-flow
// Each scenario asserts:
// - the bot state is correct and operations succeed
// - the registry state is verified
// - the regfail event described in AM-012 is emitted
#[cfg(test)]
mod registry_cross_contract_tests {
    use super::test::{fund_user, setup};
    use super::*;
    use automint_testutils::{deploy_all, register_user};
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Events},
        Address, Env,
    };

    #[contract]
    struct PausedRegistryContract;

    #[contractimpl]
    impl PausedRegistryContract {
        pub fn increment_bot_count(
            _env: Env,
            _user: Address,
        ) -> Result<(), automint_registry::RegistryError> {
            Err(automint_registry::RegistryError::Unauthorized)
        }
    }

    fn assert_regfail_emitted(env: &Env, user: &Address) {
        use soroban_sdk::{Symbol, TryFromVal};
        let regfail_sym = symbol_short!("regfail");
        let all_events = env.events().all();
        let found = all_events.iter().any(|(_, topics, _)| {
            if topics.len() < 2 {
                return false;
            }
            let Ok(t0) = Symbol::try_from_val(env, &topics.get(0).unwrap()) else {
                return false;
            };
            let Ok(t1) = Address::try_from_val(env, &topics.get(1).unwrap()) else {
                return false;
            };
            t0 == regfail_sym && t1 == *user
        });
        assert!(found, "expected regfail event to be emitted for user");
    }

    #[test]
    fn test_mint_no_registry_configured() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        // Initialize BotNFT contract instance without configuring DataKey::Registry
        env.as_contract(&id, || {
            env.storage().instance().set(&DataKey::Admin, &admin);
            env.storage().instance().set(&DataKey::Initialized, &true);
            env.storage().instance().set(&DataKey::NextId, &1u64);
        });

        let bot_id = client.mint_basic(&user);

        // Assert bot state
        assert_eq!(bot_id, 1);
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, user);
        assert_eq!(bot.tier, BotTier::Basic);
        assert_eq!(client.get_user_bots(&user).len(), 1);

        // Assert regfail event was emitted
        assert_regfail_emitted(&env, &user);
    }

    #[test]
    fn test_mint_unregistered_owner() {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        let reg_client = automint_registry::RegistryContractClient::new(
            &deployment.env,
            &deployment.registry_id,
        );
        let user = Address::generate(&deployment.env);

        // Ensure user is unregistered in registry
        assert!(!reg_client.is_registered(&user));

        let bot_id = client.mint_basic(&user);

        // Assert bot state is valid and intact
        assert_eq!(bot_id, 1);
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, user);
        assert_eq!(client.get_user_bots(&user).len(), 1);

        // Assert registry state: user remains unregistered
        assert!(!reg_client.is_registered(&user));

        // Assert regfail event emitted
        assert_regfail_emitted(&deployment.env, &user);
    }

    #[test]
    fn test_transfer_registered_to_unregistered() {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        let reg_client = automint_registry::RegistryContractClient::new(
            &deployment.env,
            &deployment.registry_id,
        );

        let alice = Address::generate(&deployment.env);
        let bob = Address::generate(&deployment.env);

        // Alice is registered, Bob is unregistered
        register_user(&deployment.env, &deployment.registry_id, &alice, "alice");
        assert!(!reg_client.is_registered(&bob));

        let bot_id = client.mint_basic(&alice);
        assert_eq!(reg_client.get_user(&alice).bot_count, 1);

        // Transfer from Alice (registered) to Bob (unregistered)
        client.transfer(&bot_id, &alice, &bob);

        // Assert bot state
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, bob);
        assert_eq!(client.get_user_bots(&alice).len(), 0);
        assert_eq!(client.get_user_bots(&bob).len(), 1);

        // Assert registry state: Alice's mint count remains 1, Bob remains unregistered
        assert_eq!(reg_client.get_user(&alice).bot_count, 1);
        assert!(!reg_client.is_registered(&bob));
    }

    #[test]
    fn test_transfer_unregistered_to_registered() {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        let reg_client = automint_registry::RegistryContractClient::new(
            &deployment.env,
            &deployment.registry_id,
        );

        let bob = Address::generate(&deployment.env);
        let alice = Address::generate(&deployment.env);

        // Bob is unregistered, Alice is registered
        register_user(&deployment.env, &deployment.registry_id, &alice, "alice");
        assert!(!reg_client.is_registered(&bob));

        // Bob mints as unregistered user -> emits regfail
        let bot_id = client.mint_basic(&bob);
        assert_regfail_emitted(&deployment.env, &bob);

        // Transfer from Bob (unregistered) to Alice (registered)
        client.transfer(&bot_id, &bob, &alice);

        // Assert bot state
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, alice);
        assert_eq!(client.get_user_bots(&bob).len(), 0);
        assert_eq!(client.get_user_bots(&alice).len(), 1);

        // Assert registry state: Bob remains unregistered, Alice's mint count remains 0
        assert!(!reg_client.is_registered(&bob));
        assert_eq!(reg_client.get_user(&alice).bot_count, 0);
    }

    #[test]
    fn test_registry_paused_mid_flow() {
        let env = Env::default();
        env.mock_all_auths();
        let paused_reg_id = env.register_contract(None, PausedRegistryContract);

        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin, &paused_reg_id, &Address::generate(&env));

        let alice = Address::generate(&env);

        // Mint bot while registry is paused / returning Unauthorized
        let bot_id = client.mint_basic(&alice);

        // Assert bot state: successfully minted despite registry failure
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, alice);
        assert_eq!(bot.id, bot_id);
        assert_eq!(client.get_user_bots(&alice).len(), 1);

        // Assert regfail event was emitted
        assert_regfail_emitted(&env, &alice);
    }

    // #322: tier payments can be withdrawn by the admin.
    #[test]
    fn test_withdraw_full_treasury_after_priced_mint() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let price = Tier::Advanced.price();
        fund_user(&env, &token, &user, price);
        client.mint_tier(&user, &Tier::Advanced);
        assert_eq!(client.treasury_balance(&token), price);

        client.withdraw(&token, &to, &price);
        assert_eq!(client.treasury_balance(&token), 0);
        let tc = automint_token::AMTTokenClient::new(&env, &token);
        assert_eq!(tc.balance(&to), price);
    }

    #[test]
    fn test_withdraw_rejects_bad_amounts_without_partial_transfer() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let price = Tier::Advanced.price();
        fund_user(&env, &token, &user, price);
        client.mint_tier(&user, &Tier::Advanced);

        assert_eq!(
            client.try_withdraw(&token, &to, &0),
            Err(Ok(BotNFTError::InvalidAmount))
        );
        assert_eq!(
            client.try_withdraw(&token, &to, &-5),
            Err(Ok(BotNFTError::InvalidAmount))
        );
        assert_eq!(
            client.try_withdraw(&token, &to, &(price + 1)),
            Err(Ok(BotNFTError::InsufficientTreasury))
        );
        assert_eq!(client.treasury_balance(&token), price);
        let tc = automint_token::AMTTokenClient::new(&env, &token);
        assert_eq!(tc.balance(&to), 0);
    }

    #[test]
    fn test_withdraw_requires_admin_auth() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let price = Tier::Advanced.price();
        fund_user(&env, &token, &user, price);
        client.mint_tier(&user, &Tier::Advanced);

        // No auths mocked: admin.require_auth() must fail the call.
        env.mock_auths(&[]);
        assert!(client.try_withdraw(&token, &to, &price).is_err());
        assert_eq!(client.treasury_balance(&token), price);
    }
}

// ── Issue #335: id counters fail closed instead of trapping ──────────────
#[cfg(test)]
mod overflow_tests {
    use super::*;
    use automint_testutils::deploy_all;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_mint_basic_at_id_ceiling_returns_overflow_not_panic() {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        let user = Address::generate(&deployment.env);
        // Seed the counter at the ceiling: the id itself is still assignable,
        // but the counter cannot advance past it.
        deployment.env.as_contract(&deployment.bot_nft_id, || {
            deployment
                .env
                .storage()
                .instance()
                .set(&DataKey::NextId, &u64::MAX);
        });

        assert_eq!(client.try_mint_basic(&user), Err(Ok(BotNFTError::Overflow)));
        // Nothing was minted and the counter is untouched.
        assert_eq!(client.get_user_bots(&user).len(), 0);
        assert_eq!(client.next_id(), u64::MAX);
    }

    #[test]
    fn test_admin_mint_at_id_ceiling_returns_overflow() {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        let user = Address::generate(&deployment.env);
        deployment.env.as_contract(&deployment.bot_nft_id, || {
            deployment
                .env
                .storage()
                .instance()
                .set(&DataKey::NextId, &u64::MAX);
        });
        assert_eq!(
            client.try_admin_mint(&user, &BotTier::Gold),
            Err(Ok(BotNFTError::Overflow))
        );
        assert_eq!(client.get_user_bots(&user).len(), 0);
    }

    #[test]
    fn test_ids_below_the_ceiling_still_mint() {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        let user = Address::generate(&deployment.env);
        deployment.env.as_contract(&deployment.bot_nft_id, || {
            deployment
                .env
                .storage()
                .instance()
                .set(&DataKey::NextId, &(u64::MAX - 1));
        });
        assert_eq!(client.mint_basic(&user), u64::MAX - 1);
        assert_eq!(client.next_id(), u64::MAX);
    }
}

// ── Issue #382: Approval and Operator Model Tests ────────────────────────
#[cfg(test)]
mod approval_tests {
    use super::*;
    use automint_testutils::{deploy_all, register_user};
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        BotNFTContractClient<'static>,
    ) {
        let deployment = deploy_all(Env::default());
        let client = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        (
            deployment.env,
            deployment.admin,
            deployment.registry_id,
            deployment.token_id,
            client,
        )
    }

    #[test]
    fn test_approve_and_get_approved() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");

        let bot_id = client.mint_basic(&owner);
        assert_eq!(client.get_approved(&bot_id), None);

        // Approve spender until ledger 1000
        client.approve(&owner, &spender, &bot_id, &1000);
        assert_eq!(client.get_approved(&bot_id), Some(spender));
    }

    #[test]
    fn test_approve_rejects_non_owner() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let non_owner = Address::generate(&env);
        let spender = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");

        let bot_id = client.mint_basic(&owner);
        assert_eq!(
            client.try_approve(&non_owner, &spender, &bot_id, &1000),
            Err(Ok(BotNFTError::NotOwner))
        );
    }

    #[test]
    fn test_transfer_from_approved_spender_once_and_clears_approval() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");
        register_user(&env, &registry, &recipient, "recipient");

        let bot_id = client.mint_basic(&owner);
        client.approve(&owner, &spender, &bot_id, &1000);

        // Spender moves the bot
        client.transfer_from(&spender, &owner, &recipient, &bot_id);
        assert_eq!(client.get_bot(&bot_id).owner, recipient);

        // Single-token approval is cleared
        assert_eq!(client.get_approved(&bot_id), None);

        // Spender cannot move the bot a second time
        let recipient2 = Address::generate(&env);
        register_user(&env, &registry, &recipient2, "recipient2");
        assert_eq!(
            client.try_transfer_from(&spender, &recipient, &recipient2, &bot_id),
            Err(Ok(BotNFTError::NotApproved))
        );
    }

    #[test]
    fn test_operator_approval_can_move_multiple_bots_and_persists() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let operator = Address::generate(&env);
        let recipient = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");
        register_user(&env, &registry, &recipient, "recipient");

        let bot1 = client.mint_basic(&owner);
        let bot2 = client.admin_mint(&owner, &BotTier::Bronze);

        assert!(!client.is_approved_for_all(&owner, &operator));
        client.set_approval_for_all(&owner, &operator, &true);
        assert!(client.is_approved_for_all(&owner, &operator));

        // Operator transfers first bot
        client.transfer_from(&operator, &owner, &recipient, &bot1);
        assert_eq!(client.get_bot(&bot1).owner, recipient);

        // Operator transfers second bot
        client.transfer_from(&operator, &owner, &recipient, &bot2);
        assert_eq!(client.get_bot(&bot2).owner, recipient);

        // Operator approval is still intact
        assert!(client.is_approved_for_all(&owner, &operator));
    }

    #[test]
    fn test_operator_approval_revocation() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let operator = Address::generate(&env);
        let recipient = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");

        let bot_id = client.mint_basic(&owner);
        client.set_approval_for_all(&owner, &operator, &true);
        client.set_approval_for_all(&owner, &operator, &false);
        assert!(!client.is_approved_for_all(&owner, &operator));

        assert_eq!(
            client.try_transfer_from(&operator, &owner, &recipient, &bot_id),
            Err(Ok(BotNFTError::NotApproved))
        );
    }

    #[test]
    fn test_expired_single_token_approval_fails() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");

        let bot_id = client.mint_basic(&owner);
        let curr_seq = env.ledger().sequence();
        let exp_seq = curr_seq + 5;
        client.approve(&owner, &spender, &bot_id, &exp_seq);

        // Advance ledger past expiration
        automint_testutils::advance_ledger(&env, 10);
        assert_eq!(client.get_approved(&bot_id), None);

        assert_eq!(
            client.try_transfer_from(&spender, &owner, &recipient, &bot_id),
            Err(Ok(BotNFTError::ApprovalExpired))
        );
    }

    #[test]
    fn test_direct_transfer_clears_single_token_approval() {
        let (env, _admin, registry, _token, client) = setup();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let new_owner = Address::generate(&env);
        register_user(&env, &registry, &owner, "owner");
        register_user(&env, &registry, &new_owner, "new_owner");

        let bot_id = client.mint_basic(&owner);
        client.approve(&owner, &spender, &bot_id, &1000);
        assert_eq!(client.get_approved(&bot_id), Some(spender));

        // Owner transfers directly
        client.transfer(&bot_id, &owner, &new_owner);
        assert_eq!(client.get_bot(&bot_id).owner, new_owner);
        // Approval must be cleared
        assert_eq!(client.get_approved(&bot_id), None);
    }

    #[test]
    fn test_is_approved_for_all_owner_is_always_true() {
        let (env, _admin, _registry, _token, client) = setup();
        let owner = Address::generate(&env);
        assert!(client.is_approved_for_all(&owner, &owner));
    }
}
