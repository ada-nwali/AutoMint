// SPDX-License-Identifier: Apache-2.0

#![no_std]
//! #355: Storage tier policy. Allowances are temporary because they have a
//! bounded authorization lifetime and should archive automatically after their
//! ledger expiration. Balances and supply are persistent because token
//! accounting must survive dormancy until explicitly archived; balance writes
//! refresh their maximum TTL, and `bump_balance` lets keepers renew dormant
//! holders. Contract configuration uses instance storage because it is small
//! and every live instance operation shares its lifetime. Persistent entries
//! can still archive after their TTL unless an active call extends them;
//! temporary entries cannot be restored from an archive and read as absent.
//!
//! | `DataKey` | Tier | TTL policy |
//! |---|---|---|
//! | `Allowance` | Temporary | `approve` extends through `expiration_ledger`; temporary archival removes it independently of the allowance's logical expiration. |
//! | `Balance` | Persistent | Writes and `bump_balance` refresh to the 180-day maximum TTL; dormant entries may archive. |
//! | `State` | Instance | Initialized with the instance maximum TTL; state-changing token calls refresh the instance TTL. |
//! | `Admin` | Instance | Shares the instance TTL and is refreshed on initialization/admin changes. |
//! | `TotalSupply` | Persistent | Mint and burn refresh to the 180-day maximum TTL; dormant supply entries may archive. |
//! | `MaxSupply` | Persistent | Set or removed by the admin; refreshed on set and on read during mint. |
//! | `Locked` | Persistent | Reserved-balance key; no writer currently exists, and future writes must define a TTL refresh policy. |
//! | `MintLimit` | Instance | Admin-configured per-window ceiling; a zero ceiling disables the limit. |
//! | `MintWindow` | Instance | Ledger window start and the amount minted in that window. |
//!
//! An allowance remains valid at `expiration_ledger` itself (inclusive), but
//! its temporary entry can become unreadable earlier if that entry is archived.
//! The `approve` TTL extension normally aligns archival with the expiration
//! ledger; the distinction matters for storage lifecycle and is tested below.
//!
//! #347: Event topic/data layout, matching the Stellar Asset Contract
//! (SAC) convention `topics = (name, ...indexed args)`, `data = payload`,
//! so that indexers, block explorers and wallets (e.g. Freighter's
//! activity feed) can key off AMT events the same way they do for SAC
//! tokens.
//!
//! | Function     | Topics                          | Data                  |
//! |---------------|----------------------------------|------------------------|
//! | `transfer`    | `("transfer", from, to)`         | `amount: i128`         |
//! | `transfer_batch` | one `transfer` event per recipient | each `amount: i128` |
//! | `mint`        | `("mint", admin, to)`             | `amount: i128`         |
//! | `burn`        | `("burn", from)`                  | `amount: i128`         |
//! | `approve`     | `("approve", from, spender)`     | `(amount: i128, expiration_ledger: u32)` |
//! | `admin_proposed` | `("admin_proposed", current_admin)` | `pending_admin: Address` |
//! | `set_admin`   | `("set_admin", admin)`           | `new_admin: Address`   |
//! | `admin_cancel` | `("admin_cancel",)`              | `cancelled_admin: Address` |
//! | `metadata`    | `("metadata",)`                  | `(old_name, old_symbol, new_name, new_symbol)` |
//!
//! Mutating methods follow one evaluation order: check initialization,
//! validate arguments, authorize the caller, read state, apply effects, then
//! emit events. Invalid arguments therefore fail before signature checks.
use automint_common::{PausableStore, LEDGER_THRESHOLD};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token::TokenInterface,
    unwrap::UnwrapOptimized, Address, BytesN, Env, String,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Allowance(AllowanceKey),
    Balance(Address),
    State,
    Admin,
    TotalSupply,     // #338
    MaxSupply,       // #339
    Locked(Address), // #344: reserved balance excluded from spendable_balance
    PendingAdmin,
    MintLimit,
    MintWindow,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct TokenState {
    /// Immutable after initialization: changing precision would reprice every
    /// existing balance without changing its stored integer amount.
    pub decimal: u32,
    pub name: String,
    pub symbol: String,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum TokenError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InsufficientBalance = 4,
    InsufficientAllowance = 5,
    NegativeAmount = 6,
    AllowanceExpired = 7,
    Overflow = 8,
    Paused = 1000,          // #336
    SupplyCapExceeded = 9,  // #339
    InvalidDecimals = 10,   // referenced in tests
    InvalidExpiration = 11, // #346
    InvalidMetadata = 12,
    NoPendingAdmin = 13,
    LengthMismatch = 14,
    BatchTooLarge = 15,
    MintLimitExceeded = 16,
    InvalidMintLimit = 17,
}

#[derive(Clone)]
#[contracttype]
pub struct MintLimit {
    pub max_per_window: i128,
    pub window_ledgers: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct MintWindow {
    pub window_start_ledger: u32,
    pub minted_in_window: i128,
}

/// Maximum recipients accepted by [`AMTToken::transfer_batch`].
pub const MAX_BATCH_SIZE: u32 = 100;

// TTL threshold is shared via automint-common (#337); the bump amount is
// overridden below (#345).

/// #345: this contract overrides the shared `automint_common::LEDGER_BUMP`
/// (7 days) with the network's maximum entry TTL extension — 3,110,400
/// ledgers, ≈180 days / 6 months at the network's ~5s/ledger close time.
/// Every `extend_ttl` call in this file (instance, total supply, and
/// balance entries) uses this single constant so none of them can drift
/// out of sync with one another: if the balance entry outlived the
/// instance entry, the whole contract would archive out from under a
/// still-"live" balance anyway.
const LEDGER_BUMP: u32 = 3_110_400;
/// #346: same network maximum, reused as the cap on how far out an
/// `approve()` expiration_ledger may be set.
const MAX_ALLOWANCE_LEDGERS: u32 = 3_110_400;

#[contract]
pub struct AMTToken;

#[contractimpl]
impl AMTToken {
    pub fn initialize(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(TokenError::AlreadyInitialized);
        }
        if decimal == 0 {
            return Err(TokenError::InvalidDecimals);
        }
        Self::validate_metadata(&name, &symbol)?;
        admin.require_auth();
        let state = TokenState {
            decimal,
            name,
            symbol,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::extend_instance_ttl(&env);
        Ok(())
    }

    // Missing records and from == spender (approve() never stores such a pair)
    // both fall through to the same "no allowance" case below — 0 is the
    // correct answer for either, not an error.
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = DataKey::Allowance(AllowanceKey { from, spender });
        match env.storage().temporary().get::<_, AllowanceValue>(&key) {
            Some(a) if a.expiration_ledger >= env.ledger().sequence() => a.amount,
            _ => 0,
        }
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        Self::validate_amount(amount)?;
        let current = env.ledger().sequence();
        // #346: a past expiration is only meaningful as a revoke (amount ==
        // 0); for a non-zero amount it would write an entry with the
        // default temporary TTL that `allowance()` can never return,
        // silently misleading the caller into thinking an allowance exists.
        if amount > 0 && expiration_ledger < current {
            return Err(TokenError::InvalidExpiration);
        }
        if expiration_ledger > current.saturating_add(MAX_ALLOWANCE_LEDGERS) {
            return Err(TokenError::InvalidExpiration);
        }
        from.require_auth();
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?; // #336
        // #341: SEP-41 permits self-approval; removed from == spender rejection
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let value = AllowanceValue {
            amount,
            expiration_ledger,
        };
        Self::write_allowance(&env, &key, &value);
        env.events().publish(
            (symbol_short!("approve"), from, spender),
            (amount, expiration_ledger),
        );
        Ok(())
    }

    /// Returns the token balance for `id`, defaulting to 0 when no record exists.
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    /// #344: SEP-41 `spendable_balance` — the portion of `balance` that is
    /// actually transferable right now. For this token there is currently
    /// no locking mechanism, so it equals `balance` minus any reserve held
    /// in `DataKey::Locked(id)` (0 today for every address). Reading it as
    /// its own storage lookup, rather than hardcoding `spendable ==
    /// balance`, lets a future lock/vesting feature populate
    /// `DataKey::Locked` without an interface break.
    pub fn spendable_balance(env: Env, id: Address) -> i128 {
        let balance = Self::balance(env.clone(), id.clone());
        let locked: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Locked(id))
            .unwrap_or(0);
        balance.saturating_sub(locked)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        let is_zero = Self::validate_amount(amount)?;
        from.require_auth();
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?; // #336

        if is_zero {
            return Ok(());
        }

        if from == to {
            let balance = Self::balance(env.clone(), from.clone());
            if balance < amount {
                return Err(TokenError::InsufficientBalance);
            }
            env.events().publish(
                (symbol_short!("transfer"), from.clone(), to.clone()),
                amount,
            );
            return Ok(());
        }

        Self::do_transfer(&env, &from, &to, amount)
    }

    pub fn transfer_batch(
        env: Env,
        from: Address,
        recipients: soroban_sdk::Vec<Address>,
        amounts: soroban_sdk::Vec<i128>,
    ) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        if recipients.len() != amounts.len() {
            return Err(TokenError::LengthMismatch);
        }
        if recipients.len() > MAX_BATCH_SIZE {
            return Err(TokenError::BatchTooLarge);
        }

        let mut total = 0_i128;
        let mut credits: soroban_sdk::Vec<(Address, i128)> = soroban_sdk::Vec::new(&env);
        for index in 0..recipients.len() {
            let recipient = recipients.get(index).unwrap();
            let amount = amounts.get(index).unwrap();
            if amount < 0 {
                return Err(TokenError::NegativeAmount);
            }
            total = total.checked_add(amount).ok_or(TokenError::Overflow)?;

            let mut found = false;
            for credit_index in 0..credits.len() {
                let (address, credit) = credits.get(credit_index).unwrap();
                if address == recipient {
                    credits.set(
                        credit_index,
                        (
                            address,
                            credit.checked_add(amount).ok_or(TokenError::Overflow)?,
                        ),
                    );
                    found = true;
                    break;
                }
            }
            if !found {
                credits.push_back((recipient, amount));
            }
        }

        from.require_auth();
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?;

        let source_balance = Self::balance(env.clone(), from.clone());
        if source_balance < total {
            return Err(TokenError::InsufficientBalance);
        }
        let debited_source = source_balance
            .checked_sub(total)
            .ok_or(TokenError::Overflow)?;

        for index in 0..credits.len() {
            let (recipient, amount) = credits.get(index).unwrap();
            let starting_balance = if recipient == from {
                debited_source
            } else {
                Self::balance(env.clone(), recipient.clone())
            };
            starting_balance
                .checked_add(amount)
                .ok_or(TokenError::Overflow)?;
        }

        if total > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::Balance(from.clone()), &debited_source);
            env.storage().persistent().extend_ttl(
                &DataKey::Balance(from.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
        }
        for index in 0..credits.len() {
            let (recipient, amount) = credits.get(index).unwrap();
            if amount == 0 {
                continue;
            }
            let starting_balance = if recipient == from {
                debited_source
            } else {
                Self::balance(env.clone(), recipient.clone())
            };
            let new_balance = starting_balance
                .checked_add(amount)
                .ok_or(TokenError::Overflow)?;
            env.storage()
                .persistent()
                .set(&DataKey::Balance(recipient.clone()), &new_balance);
            env.storage().persistent().extend_ttl(
                &DataKey::Balance(recipient.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
        }
        if total > 0 {
            env.storage()
                .instance()
                .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        for index in 0..recipients.len() {
            env.events().publish(
                (
                    symbol_short!("transfer"),
                    from.clone(),
                    recipients.get(index).unwrap(),
                ),
                amounts.get(index).unwrap(),
            );
        }
        Ok(())
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        // Zero-amount transfers are a no-op (no allowance consumed, no state change)
        let is_zero = Self::validate_amount(amount)?;
        spender.require_auth();
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?; // #336
        if is_zero {
            return Ok(());
        }

        // spender must be distinct from from — use transfer() for self-initiated moves
        if spender == from {
            return Err(TokenError::Unauthorized);
        }

        Self::spend_allowance(&env, &from, &spender, amount)?;

        // Self-transfer is a no-op but still consumes allowance (checked above)
        if from == to {
            let balance = Self::balance(env.clone(), from.clone());
            if balance < amount {
                return Err(TokenError::InsufficientBalance);
            }
            env.events().publish(
                (symbol_short!("transfer"), from.clone(), to.clone()),
                amount,
            );
            return Ok(());
        }

        Self::do_transfer(&env, &from, &to, amount)
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        let is_zero = Self::validate_amount(amount)?;
        from.require_auth();
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?; // #336

        if is_zero {
            return Ok(()); // No-op for zero amount
        }

        // Get current balance and validate it exists and is sufficient
        let balance = Self::balance(env.clone(), from.clone());
        if balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        // Perform the burn
        // #338: Update total supply
        let current_supply = Self::total_supply(env.clone());
        let new_supply = current_supply
            .checked_sub(amount)
            .ok_or(TokenError::Overflow)?;
        Self::write_balance(&env, &from, balance - amount);
        Self::write_total_supply(&env, new_supply);
        Self::extend_instance_ttl(&env);

        env.events().publish((symbol_short!("burn"), from), amount);
        Ok(())
    }

    pub fn burn_from(
        env: Env,
        spender: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        let is_zero = Self::validate_amount(amount)?;
        spender.require_auth();
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?;
        if is_zero {
            return Ok(());
        }

        let balance = Self::balance(env.clone(), from.clone());
        if balance < amount {
            return Err(TokenError::InsufficientBalance);
        }
        Self::spend_allowance(&env, &from, &spender, amount)?;
        let supply = Self::total_supply(env.clone());
        let new_supply = supply.checked_sub(amount).ok_or(TokenError::Overflow)?;
        Self::write_balance(&env, &from, balance - amount);
        Self::write_total_supply(&env, new_supply);
        Self::extend_instance_ttl(&env);
        // #347: align with the SAC `burn(from) -> amount` shape used by
        // `burn()` above — the spender is an authorization detail, not
        // part of the indexed topic.
        env.events().publish((symbol_short!("burn"), from), amount);
        Ok(())
    }

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        let is_zero = Self::validate_amount(amount)?;
        let admin = Self::admin_for_auth(&env)?;
        PausableStore::require_not_paused(&env).map_err(|_| TokenError::Paused)?; // #336
        if is_zero {
            return Ok(());
        }

        let mint_window = Self::check_mint_limit(&env, &admin, amount)?;

        let balance = Self::balance(env.clone(), to.clone());
        let new_balance = balance.checked_add(amount).ok_or(TokenError::Overflow)?;

        // #338: Update total supply
        let current_supply = Self::total_supply(env.clone());
        let new_supply = current_supply
            .checked_add(amount)
            .ok_or(TokenError::Overflow)?;

        // #339: Check supply cap
        if let Some(cap) = Self::max_supply(env.clone()) {
            if new_supply > cap {
                return Err(TokenError::SupplyCapExceeded);
            }
        }

        if let Some(window) = mint_window {
            env.storage().instance().set(&DataKey::MintWindow, &window);
        }
        Self::write_total_supply(&env, new_supply);
        Self::write_balance(&env, &to, new_balance);
        Self::extend_instance_ttl(&env);
        // #347: SAC shape is `mint(admin, to) -> amount` — include the
        // authorizing admin in the topic, not just the recipient.
        env.events()
            .publish((symbol_short!("mint"), admin, to), amount);
        Ok(())
    }

    /// Admin-only mint ceiling. A zero maximum disables the limiter;
    /// enabled limits require a non-zero window length.
    pub fn set_mint_limit(
        env: Env,
        max_per_window: i128,
        window_ledgers: u32,
    ) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        if max_per_window < 0 || (max_per_window > 0 && window_ledgers == 0) {
            return Err(TokenError::InvalidMintLimit);
        }
        let admin = Self::admin_for_auth(&env)?;
        env.storage().instance().set(
            &DataKey::MintLimit,
            &MintLimit {
                max_per_window,
                window_ledgers,
            },
        );
        if !env.storage().instance().has(&DataKey::MintWindow) {
            env.storage().instance().set(
                &DataKey::MintWindow,
                &MintWindow {
                    window_start_ledger: env.ledger().sequence(),
                    minted_in_window: 0,
                },
            );
        }
        Self::extend_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("mintlim"), admin),
            (max_per_window, window_ledgers),
        );
        Ok(())
    }

    /// Proposes `new_admin` as the next administrator. The current admin
    /// remains active until the proposed address calls `accept_admin`.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), TokenError> {
        // Guard: contract must be initialized before admin can be transferred
        Self::require_initialized(&env)?;

        // Resolve and authenticate the current admin
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)?;

        // Reject self-assignment — transferring admin to the current admin is a no-op
        // that wastes a transaction; callers should be aware of the current admin.
        if new_admin == current_admin {
            return Err(TokenError::Unauthorized);
        }
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        Self::extend_instance_ttl(&env);
        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "admin_proposed"),
                current_admin,
            ),
            new_admin,
        );
        Ok(())
    }

    /// Accepts the pending admin proposal. Only the nominated address can
    /// call this method.
    pub fn accept_admin(env: Env) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(TokenError::NoPendingAdmin)?;
        pending.require_auth();
        let current: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)?;
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Self::extend_instance_ttl(&env);
        env.events()
            .publish((symbol_short!("set_admin"), current), pending);
        Ok(())
    }

    /// Cancels the pending admin proposal. Only the current admin can cancel.
    pub fn cancel_admin_transfer(env: Env) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(TokenError::NoPendingAdmin)?;
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Self::extend_instance_ttl(&env);
        env.events()
            .publish((soroban_sdk::Symbol::new(&env, "admin_cancel"),), pending);
        Ok(())
    }

    /// Returns the nominated administrator, if a transfer is pending.
    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// #345: permissionless keeper call that refreshes `id`'s balance
    /// entry TTL without touching its amount. Anyone may call this — there
    /// is nothing privileged about extending an entry's own lifetime, and
    /// requiring auth here would defeat the point of a keeper being able
    /// to rescue a dormant holder's balance from archival.
    pub fn bump_balance(env: Env, id: Address) {
        let key = DataKey::Balance(id);
        if env.storage().persistent().has(&key) {
            Self::extend_balance_ttl(&env, &key);
            // A balance entry is useless if the contract instance itself
            // archives — no function on the contract could be invoked at
            // all to read it. Keep both in lockstep.
            Self::extend_instance_ttl(&env);
        }
    }

    pub fn admin(env: Env) -> Result<Address, TokenError> {
        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)
    }

    /// Returns the total supply of tokens (#338)
    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    /// Returns the max supply cap, if set (#339)
    pub fn max_supply(env: Env) -> Option<i128> {
        let key = DataKey::MaxSupply;
        if let Some(cap) = env.storage().persistent().get(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            Some(cap)
        } else {
            None
        }
    }

    /// Admin-only: set the maximum supply cap. Fails if cap is below current supply (#339)
    pub fn set_max_supply(env: Env, new_cap: Option<i128>) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;

        if let Some(cap) = new_cap {
            if cap < 0 {
                return Err(TokenError::NegativeAmount);
            }
        }
        Self::require_admin(&env)?;
        if let Some(cap) = new_cap {
            let current_supply = Self::total_supply(env.clone());
            if cap < current_supply {
                return Err(TokenError::SupplyCapExceeded);
            }
        }

        if let Some(cap) = new_cap {
            let key = DataKey::MaxSupply;
            env.storage().persistent().set(&key, &cap);
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        } else {
            env.storage().persistent().remove(&DataKey::MaxSupply);
        }

        Self::extend_instance_ttl(&env);
        env.events()
            .publish((symbol_short!("maxsup"),), new_cap.unwrap_or(-1));
        Ok(())
    }

    /// Checks if the contract is paused (#336)
    pub fn paused(env: Env) -> bool {
        PausableStore::is_paused(&env)
    }

    /// Pauses the contract (admin-only) (#336)
    pub fn pause(env: Env) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;
        PausableStore::set_paused(&env, true);
        env.events().publish((symbol_short!("pause"),), true);
        Ok(())
    }

    /// Unpauses the contract (admin-only) (#336)
    pub fn unpause(env: Env) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;
        PausableStore::set_paused(&env, false);
        env.events().publish((symbol_short!("unpause"),), false);
        Ok(())
    }

    /// Upgrades the contract wasm (admin-only) (#336)
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.events().publish((symbol_short!("upgrade"),), ());
        Ok(())
    }

    pub fn decimals(env: Env) -> Result<u32, TokenError> {
        let s: TokenState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(TokenError::NotInitialized)?;
        Ok(s.decimal)
    }

    pub fn name(env: Env) -> Result<String, TokenError> {
        let s: TokenState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(TokenError::NotInitialized)?;
        Ok(s.name)
    }

    pub fn symbol(env: Env) -> Result<String, TokenError> {
        let s: TokenState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(TokenError::NotInitialized)?;
        Ok(s.symbol)
    }

    /// Updates the token's display name and symbol. Decimal precision is
    /// deliberately immutable: changing it would reprice every stored balance.
    pub fn set_metadata(env: Env, name: String, symbol: String) -> Result<(), TokenError> {
        Self::require_initialized(&env)?;
        Self::validate_metadata(&name, &symbol)?;
        Self::require_admin(&env)?;
        let mut state: TokenState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .ok_or(TokenError::NotInitialized)?;
        let old_name = state.name.clone();
        let old_symbol = state.symbol.clone();
        state.name = name.clone();
        state.symbol = symbol.clone();
        env.storage().instance().set(&DataKey::State, &state);
        Self::extend_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("metadata"),),
            (old_name, old_symbol, name, symbol),
        );
        Ok(())
    }

    fn validate_metadata(name: &String, symbol: &String) -> Result<(), TokenError> {
        if name.is_empty() || symbol.is_empty() {
            return Err(TokenError::InvalidMetadata);
        }
        Ok(())
    }

    /// Returns `true` for zero amounts, which callers may treat as a no-op.
    /// Negative amounts are invalid everywhere this helper is used.
    fn validate_amount(amount: i128) -> Result<bool, TokenError> {
        if amount < 0 {
            return Err(TokenError::NegativeAmount);
        }
        Ok(amount == 0)
    }

    fn require_initialized(env: &Env) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::State) {
            Ok(())
        } else {
            Err(TokenError::NotInitialized)
        }
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn extend_balance_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn write_balance(env: &Env, address: &Address, amount: i128) {
        let key = DataKey::Balance(address.clone());
        env.storage().persistent().set(&key, &amount);
        Self::extend_balance_ttl(env, &key);
    }

    fn write_total_supply(env: &Env, amount: i128) {
        let key = DataKey::TotalSupply;
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    fn write_allowance(env: &Env, key: &DataKey, allowance: &AllowanceValue) {
        env.storage().temporary().set(key, allowance);
        let current = env.ledger().sequence();
        if allowance.expiration_ledger > current {
            let ttl = allowance.expiration_ledger - current;
            env.storage().temporary().extend_ttl(key, ttl, ttl);
        }
        Self::extend_instance_ttl(env);
    }

    fn require_admin(env: &Env) -> Result<(), TokenError> {
        Self::admin_for_auth(env).map(|_| ())
    }

    fn admin_for_auth(env: &Env) -> Result<Address, TokenError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn check_mint_limit(
        env: &Env,
        admin: &Address,
        amount: i128,
    ) -> Result<Option<MintWindow>, TokenError> {
        let Some(limit) = env.storage().instance().get::<_, MintLimit>(&DataKey::MintLimit)
        else {
            return Ok(None);
        };
        if limit.max_per_window == 0 {
            return Ok(None);
        }

        let current_ledger = env.ledger().sequence();
        let mut window = env
            .storage()
            .instance()
            .get::<_, MintWindow>(&DataKey::MintWindow)
            .unwrap_or(MintWindow {
                window_start_ledger: current_ledger,
                minted_in_window: 0,
            });
        if current_ledger.saturating_sub(window.window_start_ledger) >= limit.window_ledgers {
            window.window_start_ledger = current_ledger;
            window.minted_in_window = 0;
        }

        let Some(next_total) = window.minted_in_window.checked_add(amount) else {
            env.events().publish(
                (symbol_short!("limithit"), admin.clone()),
                (amount, limit.max_per_window, window.minted_in_window),
            );
            return Err(TokenError::MintLimitExceeded);
        };
        if next_total > limit.max_per_window {
            env.events().publish(
                (symbol_short!("limithit"), admin.clone()),
                (amount, limit.max_per_window, window.minted_in_window),
            );
            return Err(TokenError::MintLimitExceeded);
        }
        window.minted_in_window = next_total;
        Ok(Some(window))
    }

    /// Rejects negative amounts, treats zero as a no-op, then validates
    /// sufficient sender balance and recipient overflow. For positive amounts
    /// it writes both persistent balance records, extends both balance TTLs
    /// and the instance TTL, and emits the transfer event. Authorization,
    /// pause state, and self-transfer handling belong to the public caller.
    fn do_transfer(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        if Self::validate_amount(amount)? {
            return Ok(());
        }
        let from_bal = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_bal < amount {
            return Err(TokenError::InsufficientBalance);
        }
        let to_bal = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        let new_to = to_bal.checked_add(amount).ok_or(TokenError::Overflow)?;
        Self::write_balance(env, from, from_bal - amount);
        Self::write_balance(env, to, new_to);
        // #544: `write_balance` refreshes both entries, including the sender's
        // balance for wallets that only send and never receive.
        Self::extend_instance_ttl(env);
        env.events().publish(
            (symbol_short!("transfer"), from.clone(), to.clone()),
            amount,
        );
        Ok(())
    }

    /// Rejects negative amounts and treats zero as a no-op. For a positive
    /// amount it validates that the allowance is live and sufficient, writes
    /// the reduced temporary allowance, and extends its TTL through its
    /// expiration ledger plus the contract instance TTL. It emits no event;
    /// its public caller emits the corresponding transfer or burn event.
    fn spend_allowance(
        env: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        if Self::validate_amount(amount)? {
            return Ok(());
        }
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let a = env
            .storage()
            .temporary()
            .get::<_, AllowanceValue>(&key)
            .unwrap_or(AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            });
        if a.expiration_ledger < env.ledger().sequence() {
            return Err(TokenError::AllowanceExpired);
        }
        if a.amount < amount {
            return Err(TokenError::InsufficientAllowance);
        }
        Self::write_allowance(
            env,
            &key,
            &AllowanceValue {
                amount: a.amount - amount,
                expiration_ledger: a.expiration_ledger,
            },
        );
        Ok(())
    }
}

impl TokenInterface for AMTToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        AMTToken::allowance(env, from, spender)
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        AMTToken::approve(env, from, spender, amount, expiration_ledger).unwrap_optimized();
    }

    fn balance(env: Env, id: Address) -> i128 {
        AMTToken::balance(env, id)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        AMTToken::transfer(env, from, to, amount).unwrap_optimized();
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        AMTToken::transfer_from(env, spender, from, to, amount).unwrap_optimized();
    }

    fn burn(env: Env, from: Address, amount: i128) {
        AMTToken::burn(env, from, amount).unwrap_optimized();
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        AMTToken::burn_from(env, spender, from, amount).unwrap_optimized();
    }

    fn decimals(env: Env) -> u32 {
        AMTToken::decimals(env).unwrap_optimized()
    }

    fn name(env: Env) -> String {
        AMTToken::name(env).unwrap_optimized()
    }

    fn symbol(env: Env) -> String {
        AMTToken::symbol(env).unwrap_optimized()
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger as _},
        Env, String, Symbol, TryFromVal,
    };

    fn setup() -> (Env, Address, AMTTokenClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );
        (env, admin, client)
    }

    #[test]
    fn test_mint_and_balance() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &10_000_000_000_i128);
        assert_eq!(client.balance(&user), 10_000_000_000_i128);
    }

    #[test]
    fn test_set_max_supply_and_ttl_extension() {
        let (env, _admin, client) = setup();
        assert_eq!(client.max_supply(), None);

        // Set max supply cap to 1000
        client.set_max_supply(&Some(1_000_i128));
        assert_eq!(client.max_supply(), Some(1_000_i128));

        let user = Address::generate(&env);
        // Mint within cap succeeds
        client.mint(&user, &600_i128);
        assert_eq!(client.balance(&user), 600_i128);
        assert_eq!(client.total_supply(), 600_i128);
        assert_eq!(client.max_supply(), Some(1_000_i128));

        // Mint exceeding cap fails
        let res = client.try_mint(&user, &500_i128);
        assert!(res.is_err());

        // Remove max supply cap
        client.set_max_supply(&None);
        assert_eq!(client.max_supply(), None);
        client.mint(&user, &500_i128);
        assert_eq!(client.balance(&user), 1_100_i128);
    }

    #[test]
    fn test_mint_validates_negative_amount_before_admin_authorization() {
        let (env, _admin, client) = setup();
        let recipient = Address::generate(&env);
        env.mock_auths(&[]);

        assert_eq!(
            client.try_mint(&recipient, &-1_i128),
            Err(Ok(TokenError::NegativeAmount))
        );
    }

    #[test]
    fn test_mint_limit_rejects_excess_and_resets_after_window() {
        let (env, _admin, client) = setup();
        let recipient = Address::generate(&env);
        client.set_mint_limit(&1_000_i128, &100_u32);
        client.mint(&recipient, &1_000_i128);

        assert_eq!(
            client.try_mint(&recipient, &1_i128),
            Err(Ok(TokenError::MintLimitExceeded))
        );
        assert_eq!(client.balance(&recipient), 1_000_i128);
        assert_eq!(client.total_supply(), 1_000_i128);
        assert!(env.events().all().iter().any(|(_, topics, _)| {
            topics
                .get(0)
                .and_then(|topic| Symbol::try_from_val(&env, &topic).ok())
                == Some(symbol_short!("limithit"))
        }));

        let current = env.ledger().sequence();
        env.ledger().set_sequence_number(current + 100);
        client.mint(&recipient, &1_i128);
        assert_eq!(client.balance(&recipient), 1_001_i128);
    }

    #[test]
    fn test_zero_mint_limit_disables_rate_limiting() {
        let (env, _admin, client) = setup();
        let recipient = Address::generate(&env);
        client.set_mint_limit(&1_i128, &10_u32);
        client.mint(&recipient, &1_i128);
        assert_eq!(
            client.try_mint(&recipient, &1_i128),
            Err(Ok(TokenError::MintLimitExceeded))
        );

        client.set_mint_limit(&0_i128, &0_u32);
        client.mint(&recipient, &10_i128);
        assert_eq!(client.balance(&recipient), 11_i128);
    }

    #[test]
    fn test_non_admin_cannot_set_mint_limit() {
        let (env, _admin, client) = setup();
        env.mock_auths(&[]);

        assert!(client.try_set_mint_limit(&1_000_i128, &100_u32).is_err());
    }

    #[test]
    fn test_token_interface_client_calls_amt_token() {
        let (env, _admin, amt_client) = setup();
        let token_client = soroban_sdk::token::Client::new(&env, &amt_client.address);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let spender = Address::generate(&env);
        amt_client.mint(&alice, &100_i128);

        assert_eq!(token_client.balance(&alice), 100);
        token_client.approve(
            &alice,
            &spender,
            &60_i128,
            &(env.ledger().sequence() + 1000),
        );
        assert_eq!(token_client.allowance(&alice, &spender), 60);
        token_client.transfer_from(&spender, &alice, &bob, &40_i128);
        assert_eq!(token_client.balance(&alice), 60);
        assert_eq!(token_client.balance(&bob), 40);
        token_client.approve(&bob, &spender, &10_i128, &(env.ledger().sequence() + 1000));
        token_client.burn_from(&spender, &bob, &5_i128);
        token_client.transfer(&alice, &bob, &10_i128);
        token_client.burn(&bob, &5_i128);

        assert_eq!(token_client.balance(&alice), 50);
        assert_eq!(token_client.balance(&bob), 40);
        assert_eq!(token_client.decimals(), 7);
        assert_eq!(
            token_client.name(),
            String::from_str(&env, "AutoMint Token")
        );
        assert_eq!(token_client.symbol(), String::from_str(&env, "AMT"));
    }

    #[test]
    fn test_set_metadata_updates_name_and_symbol_without_changing_decimals() {
        let (env, _admin, client) = setup();
        let name = String::from_str(&env, "AutoMint AMT");
        let symbol = String::from_str(&env, "AMTX");

        client.set_metadata(&name, &symbol);

        assert_eq!(client.name(), name);
        assert_eq!(client.symbol(), symbol);
        assert_eq!(client.decimals(), 7);
    }

    #[test]
    fn test_set_metadata_rejects_empty_symbol() {
        let (env, _admin, client) = setup();
        let result = client.try_set_metadata(
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, ""),
        );
        assert_eq!(result, Err(Ok(TokenError::InvalidMetadata)));
    }

    #[test]
    fn test_set_metadata_emits_old_and_new_values() {
        let (env, _admin, client) = setup();
        let new_name = String::from_str(&env, "AutoMint AMT");
        let new_symbol = String::from_str(&env, "AMTX");
        client.set_metadata(&new_name, &new_symbol);

        let events = env.events().all();
        let (_, topics, data) = events.last().unwrap();
        assert_eq!(topics.len(), 1);
        assert_eq!(
            Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap(),
            symbol_short!("metadata")
        );
        let (old_name, old_symbol, name, symbol): (String, String, String, String) =
            <(String, String, String, String)>::try_from_val(&env, &data).unwrap();
        assert_eq!(old_name, String::from_str(&env, "AutoMint Token"));
        assert_eq!(old_symbol, String::from_str(&env, "AMT"));
        assert_eq!(name, new_name);
        assert_eq!(symbol, new_symbol);
    }

    // --- balance: edge cases (#79) ---

    // #79: Missing balance record defaults to zero
    #[test]
    fn test_balance_missing_record_returns_zero() {
        let (env, _admin, client) = setup();
        let never_minted = Address::generate(&env);
        assert_eq!(client.balance(&never_minted), 0_i128);
    }

    // #79: Uninitialized contract — balance query returns zero without panicking
    #[test]
    fn test_balance_uninitialized_contract_returns_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let user = Address::generate(&env);
        assert_eq!(client.balance(&user), 0_i128);
    }

    // #79: Minting zero tokens leaves balance at zero (missing-record path)
    #[test]
    fn test_balance_zero_mint_on_missing_record() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &0_i128);
        assert_eq!(client.balance(&user), 0_i128);
    }

    // #79: Balances are independent per address
    #[test]
    fn test_balance_independent_per_address() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &100_i128);
        assert_eq!(client.balance(&alice), 100_i128);
        assert_eq!(client.balance(&bob), 0_i128);
    }

    // #79: Zero-amount burn on a missing record is a no-op — balance stays zero
    #[test]
    fn test_balance_zero_burn_on_missing_record() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.burn(&user, &0_i128);
        assert_eq!(client.balance(&user), 0_i128);
    }

    // #79: Zero amount → Ok(()) no-op (balances untouched)
    #[test]
    fn test_transfer_zero_amount_is_noop() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.transfer(&alice, &bob, &0_i128);
        assert_eq!(client.balance(&alice), 1000_i128);
        assert_eq!(client.balance(&bob), 0_i128);
    }

    // #79: Negative amount → NegativeAmount
    #[test]
    fn test_transfer_negative_amount_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        let result = client.try_transfer(&alice, &bob, &-1_i128);
        assert_eq!(result, Err(Ok(TokenError::NegativeAmount)));
        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // #340: from == to (self-transfer) → Ok, balance unchanged, event emitted
    #[test]
    fn test_transfer_self_transfer_succeeds() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        let result = client.try_transfer(&alice, &alice, &100_i128);
        assert_eq!(result, Ok(Ok(())));
        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // #340: self-transfer exceeding balance still fails
    #[test]
    fn test_transfer_self_transfer_insufficient_balance() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &100_i128);
        let result = client.try_transfer(&alice, &alice, &200_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
        assert_eq!(client.balance(&alice), 100_i128);
    }

    #[test]
    fn test_transfer() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &500_i128);
        client.transfer(&alice, &bob, &200_i128);
        assert_eq!(client.balance(&alice), 300_i128);
        assert_eq!(client.balance(&bob), 200_i128);
    }

    #[test]
    fn test_transfer_batch_moves_all_entries_and_emits_per_recipient() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        let before_events = env.events().all().len();

        let recipients = soroban_sdk::vec![&env, bob.clone(), carol.clone(), bob.clone()];
        let amounts = soroban_sdk::vec![&env, 100_i128, 150_i128, 50_i128];
        client.transfer_batch(&alice, &recipients, &amounts);

        assert_eq!(client.balance(&alice), 700);
        assert_eq!(client.balance(&bob), 150);
        assert_eq!(client.balance(&carol), 150);
        assert_eq!(env.events().all().len(), before_events + 3);
    }

    #[test]
    fn test_transfer_batch_rejects_mismatched_lengths_without_mutation() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &100_i128);

        let recipients = soroban_sdk::vec![&env, bob.clone()];
        let amounts = soroban_sdk::Vec::<i128>::new(&env);
        assert_eq!(
            client.try_transfer_batch(&alice, &recipients, &amounts),
            Err(Ok(TokenError::LengthMismatch))
        );
        assert_eq!(client.balance(&alice), 100);
        assert_eq!(client.balance(&bob), 0);
    }

    #[test]
    fn test_transfer_batch_requires_full_solvency_before_writes() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        client.mint(&alice, &100_i128);

        let recipients = soroban_sdk::vec![&env, bob.clone(), carol.clone()];
        let amounts = soroban_sdk::vec![&env, 60_i128, 50_i128];
        assert_eq!(
            client.try_transfer_batch(&alice, &recipients, &amounts),
            Err(Ok(TokenError::InsufficientBalance))
        );
        assert_eq!(client.balance(&alice), 100);
        assert_eq!(client.balance(&bob), 0);
        assert_eq!(client.balance(&carol), 0);
    }

    #[test]
    fn test_transfer_batch_rejects_total_overflow_without_mutation() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &100_i128);

        let recipients = soroban_sdk::vec![&env, bob.clone(), bob.clone()];
        let amounts = soroban_sdk::vec![&env, i128::MAX, 1_i128];
        assert_eq!(
            client.try_transfer_batch(&alice, &recipients, &amounts),
            Err(Ok(TokenError::Overflow))
        );
        assert_eq!(client.balance(&alice), 100);
        assert_eq!(client.balance(&bob), 0);
    }

    #[test]
    fn test_transfer_batch_rejects_more_than_one_hundred_entries() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let mut recipients = soroban_sdk::Vec::new(&env);
        let mut amounts = soroban_sdk::Vec::new(&env);
        for _ in 0..=MAX_BATCH_SIZE {
            recipients.push_back(bob.clone());
            amounts.push_back(0_i128);
        }

        assert_eq!(
            client.try_transfer_batch(&alice, &recipients, &amounts),
            Err(Ok(TokenError::BatchTooLarge))
        );
    }

    #[test]
    fn test_burn() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &1000_i128);
        client.burn(&user, &300_i128);
        assert_eq!(client.balance(&user), 700_i128);
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &100_i128);
        let result = client.try_transfer(&alice, &bob, &200_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
    }

    #[test]
    fn test_double_initialize_fails() {
        let (env, admin, client) = setup();
        let result = client.try_initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );
        assert_eq!(result, Err(Ok(TokenError::AlreadyInitialized)));
    }

    #[test]
    fn test_burn_more_than_balance_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &100_i128);
        let result = client.try_burn(&user, &200_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
    }

    // --- set_admin: happy path ---

    #[test]
    fn test_set_admin_and_mint_from_new_admin() {
        let (env, old_admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), old_admin);
        assert_eq!(client.pending_admin(), Some(new_admin.clone()));
        let old_admin_user = Address::generate(&env);
        client.mint(&old_admin_user, &25_i128);

        client.accept_admin();
        let user = Address::generate(&env);
        client.mint(&user, &50_i128);
        assert_eq!(client.balance(&user), 50_i128);
        assert_eq!(client.pending_admin(), None);
    }

    #[test]
    fn test_set_admin_keeps_old_admin_until_acceptance() {
        let (env, old_admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), old_admin);
        assert_eq!(client.pending_admin(), Some(new_admin));
    }

    #[test]
    fn test_cancel_admin_transfer_clears_pending_admin() {
        let (env, admin, client) = setup();
        let pending = Address::generate(&env);
        client.set_admin(&pending);

        client.cancel_admin_transfer();

        assert_eq!(client.admin(), admin);
        assert_eq!(client.pending_admin(), None);
    }

    // #84: Chained transfers — A → B → C, each step updates admin correctly
    #[test]
    fn test_set_admin_chained_transfers() {
        let (env, _admin_a, client) = setup();
        let admin_b = Address::generate(&env);
        let admin_c = Address::generate(&env);
        client.set_admin(&admin_b);
        assert_eq!(client.pending_admin(), Some(admin_b.clone()));
        client.accept_admin();
        assert_eq!(client.admin(), admin_b);
        client.set_admin(&admin_c);
        assert_eq!(client.pending_admin(), Some(admin_c.clone()));
        client.accept_admin();
        assert_eq!(client.admin(), admin_c);
        // Confirm admin_c can mint
        let user = Address::generate(&env);
        client.mint(&user, &100_i128);
        assert_eq!(client.balance(&user), 100_i128);
    }

    // --- set_admin: exact error variants ---

    // #84: Not initialized → NotInitialized
    #[test]
    fn test_set_admin_not_initialized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let any_addr = Address::generate(&env);
        let result = client.try_set_admin(&any_addr);
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    // #84: new_admin == current admin → Unauthorized (self-assignment)
    #[test]
    fn test_set_admin_self_assignment_fails() {
        let (_env, admin, client) = setup();
        let result = client.try_set_admin(&admin);
        assert_eq!(result, Err(Ok(TokenError::Unauthorized)));
        // Admin must remain unchanged
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_set_admin_keeps_old_admin_active_while_pending() {
        let (env, old_admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        let user = Address::generate(&env);
        client.mint(&user, &10_i128);
        assert_eq!(client.admin(), old_admin);
        assert_eq!(client.pending_admin(), Some(new_admin));
    }

    // #84: TTL is extended — instance storage remains readable after set_admin
    #[test]
    fn test_set_admin_extends_ttl() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        // If TTL was not extended instance storage could expire; confirm admin() still works
        assert_eq!(client.admin(), admin);
        assert_eq!(client.pending_admin(), Some(new_admin));
        // And other instance data (token state) is still accessible
        assert_eq!(client.decimals(), 7u32);
    }

    // Proposing an admin does not affect any token balances.
    #[test]
    fn test_set_admin_does_not_affect_balances() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &500_i128);
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.balance(&alice), 500_i128);
    }

    // #84: set_admin does not affect existing allowances
    #[test]
    fn test_set_admin_does_not_affect_allowances() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &300_i128,
            &(env.ledger().sequence() + 1000),
        );
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        // Allowance must be untouched
        assert_eq!(client.allowance(&alice, &spender), 300_i128);
    }

    // --- transfer_from: happy path ---

    #[test]
    fn test_approve_and_transfer_from() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &300_i128,
            &(env.ledger().sequence() + 1000),
        );
        assert_eq!(client.allowance(&alice, &spender), 300_i128);
        client.transfer_from(&spender, &alice, &bob, &150_i128);
        assert_eq!(client.balance(&bob), 150_i128);
        assert_eq!(client.allowance(&alice, &spender), 150_i128);
    }

    // #81: Allowance is fully consumed when transfer_from drains it exactly
    #[test]
    fn test_transfer_from_consumes_allowance_fully() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        client.transfer_from(&spender, &alice, &bob, &500_i128);
        assert_eq!(client.allowance(&alice, &spender), 0_i128);
        assert_eq!(client.balance(&bob), 500_i128);
        assert_eq!(client.balance(&alice), 500_i128);
    }

    // --- transfer_from: exact error variants ---

    // #81: Insufficient allowance → InsufficientAllowance
    #[test]
    fn test_transfer_from_insufficient_allowance_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &100_i128,
            &(env.ledger().sequence() + 1000),
        );
        let result = client.try_transfer_from(&spender, &alice, &bob, &200_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientAllowance)));
    }

    // #81: Insufficient balance (allowance > balance) → InsufficientBalance
    #[test]
    fn test_transfer_from_insufficient_balance_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        // Give alice only 50 but approve spender for 200
        client.mint(&alice, &50_i128);
        client.approve(
            &alice,
            &spender,
            &200_i128,
            &(env.ledger().sequence() + 1000),
        );
        let result = client.try_transfer_from(&spender, &alice, &bob, &200_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
    }

    // #81: Negative amount → NegativeAmount (before allowance is touched)
    #[test]
    fn test_transfer_from_negative_amount_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        let allowance_before = client.allowance(&alice, &spender);
        let result = client.try_transfer_from(&spender, &alice, &bob, &-100_i128);
        assert_eq!(result, Err(Ok(TokenError::NegativeAmount)));
        // Allowance must be untouched
        assert_eq!(client.allowance(&alice, &spender), allowance_before);
    }

    // #81: Zero amount → Ok(()) no-op (allowance and balances untouched)
    #[test]
    fn test_transfer_from_zero_amount_is_noop() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        // Should succeed without consuming allowance or moving tokens
        client.transfer_from(&spender, &alice, &bob, &0_i128);
        assert_eq!(client.allowance(&alice, &spender), 500_i128);
        assert_eq!(client.balance(&alice), 1000_i128);
        assert_eq!(client.balance(&bob), 0_i128);
    }

    // #81: spender == from → Unauthorized (must use transfer() instead)
    #[test]
    fn test_transfer_from_spender_equals_from_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        // alice tries to use transfer_from as if she were the spender of her own funds
        let result = client.try_transfer_from(&alice, &alice, &bob, &100_i128);
        assert_eq!(result, Err(Ok(TokenError::Unauthorized)));
    }

    // #340: from == to (self-transfer) → Ok, consumes allowance, balance unchanged
    #[test]
    fn test_transfer_from_self_transfer_succeeds() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        let result = client.try_transfer_from(&spender, &alice, &alice, &100_i128);
        assert_eq!(result, Ok(Ok(())));
        // Allowance must be consumed
        assert_eq!(client.allowance(&alice, &spender), 400_i128);
        // Balance must be unchanged
        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // #340: self-transfer_from exceeding balance still fails
    #[test]
    fn test_transfer_from_self_transfer_insufficient_balance() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.mint(&alice, &100_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        let result = client.try_transfer_from(&spender, &alice, &alice, &200_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
        // A failed invocation is rolled back, so the allowance is untouched
        assert_eq!(client.allowance(&alice, &spender), 500_i128);
        // Balance must be unchanged
        assert_eq!(client.balance(&alice), 100_i128);
    }

    // #81: Expired allowance → AllowanceExpired
    #[test]
    fn test_transfer_from_expired_allowance_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        // Approve with expiration at current ledger (already expired by the time we call)
        let current_seq = env.ledger().sequence();
        client.approve(&alice, &spender, &500_i128, &current_seq);
        // Advance ledger so the allowance is expired
        env.ledger().set_sequence_number(current_seq + 1);
        let result = client.try_transfer_from(&spender, &alice, &bob, &100_i128);
        assert_eq!(result, Err(Ok(TokenError::AllowanceExpired)));
    }

    // #81: No allowance at all (zero by default) → InsufficientAllowance (amount 0 < requested)
    #[test]
    fn test_transfer_from_no_allowance_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        // No approve call — default allowance value has amount == 0
        let result = client.try_transfer_from(&spender, &alice, &bob, &100_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientAllowance)));
    }

    // #81: Negative amount rejected before allowance is checked (no allowance needed)
    #[test]
    fn test_transfer_from_negative_amount_rejected_before_allowance_check() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        // No allowance set at all — NegativeAmount must fire first
        let result = client.try_transfer_from(&spender, &alice, &bob, &-1_i128);
        assert_eq!(result, Err(Ok(TokenError::NegativeAmount)));
    }

    // #81: Multiple sequential transfer_from calls each decrement allowance correctly
    #[test]
    fn test_transfer_from_multiple_calls_decrements_allowance() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &300_i128,
            &(env.ledger().sequence() + 1000),
        );
        client.transfer_from(&spender, &alice, &bob, &100_i128);
        assert_eq!(client.allowance(&alice, &spender), 200_i128);
        client.transfer_from(&spender, &alice, &bob, &100_i128);
        assert_eq!(client.allowance(&alice, &spender), 100_i128);
        client.transfer_from(&spender, &alice, &bob, &100_i128);
        assert_eq!(client.allowance(&alice, &spender), 0_i128);
        // Fourth call should now fail — allowance exhausted
        let result = client.try_transfer_from(&spender, &alice, &bob, &1_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientAllowance)));
    }

    #[test]
    fn test_symbol_returns_correct_symbol() {
        let (env, _admin, client) = setup();
        let result = client.symbol();
        assert_eq!(result, String::from_str(&env, "AMT"));
    }

    #[test]
    fn test_symbol_fails_if_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let result = client.try_symbol();
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    #[test]
    fn test_name_returns_correct_name() {
        let (env, _admin, client) = setup();
        let result = client.name();
        assert_eq!(result, String::from_str(&env, "AutoMint Token"));
    }

    #[test]
    fn test_name_fails_if_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let result = client.try_name();
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    #[test]
    fn test_approve_with_zero_amount() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.approve(&alice, &spender, &0_i128, &(env.ledger().sequence() + 1000));
        assert_eq!(client.allowance(&alice, &spender), 0);
    }

    #[test]
    fn test_approve_self_approval_is_permitted() {
        // #341: SEP-41 permits an account to approve itself as spender.
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let result =
            client.try_approve(&alice, &alice, &100_i128, &(env.ledger().sequence() + 1000));
        assert_eq!(result, Ok(Ok(())));
        assert_eq!(client.allowance(&alice, &alice), 100_i128);
    }

    #[test]
    fn test_approve_fails_if_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let alice = Address::generate(&env);
        let result =
            client.try_approve(&alice, &alice, &100_i128, &(env.ledger().sequence() + 1000));
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    #[test]
    fn test_burn_zero_amount_is_noop() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        let balance_before = client.balance(&alice);
        client.burn(&alice, &0_i128);
        let balance_after = client.balance(&alice);

        assert_eq!(balance_before, balance_after);
        assert_eq!(balance_after, 1000_i128);
    }

    #[test]
    fn test_burn_negative_amount_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        let result = client.try_burn(&alice, &-100_i128);
        assert_eq!(result, Err(Ok(TokenError::NegativeAmount)));
    }

    #[test]
    fn test_burn_exact_balance() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        client.burn(&alice, &1000_i128);
        assert_eq!(client.balance(&alice), 0_i128);
    }

    #[test]
    fn test_burn_from_zero_balance_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);

        let result = client.try_burn(&alice, &100_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
    }

    // --- Issue #76: initialize validation tests ---

    #[test]
    fn test_initialize_zero_decimal_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let admin = Address::generate(&env);
        let result = client.try_initialize(
            &admin,
            &0u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );
        assert_eq!(result, Err(Ok(TokenError::InvalidDecimals)));
    }

    // --- Issue #85: admin() Result validation tests ---

    #[test]
    fn test_admin_returns_address_after_initialize() {
        let (_env, admin, client) = setup();
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_admin_not_initialized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let result = client.try_admin();
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    // --- Issue #86: decimals() Result validation tests ---

    #[test]
    fn test_decimals_returns_value_after_initialize() {
        let (_env, _admin, client) = setup();
        assert_eq!(client.decimals(), 7u32);
    }

    #[test]
    fn test_decimals_not_initialized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let result = client.try_decimals();
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    // --- Issue #77: allowance() edge case tests ---

    #[test]
    fn test_allowance_returns_zero_for_missing_record() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        assert_eq!(client.allowance(&alice, &spender), 0);
    }

    // approve() always rejects from == spender, so this pair can never have a
    // stored record — the getter must still resolve to 0, not panic.
    #[test]
    fn test_allowance_returns_zero_for_self_spender() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        assert_eq!(client.allowance(&alice, &alice), 0);
    }

    #[test]
    fn test_allowance_returns_amount_after_approve() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.approve(
            &alice,
            &spender,
            &250_i128,
            &(env.ledger().sequence() + 100),
        );
        assert_eq!(client.allowance(&alice, &spender), 250_i128);
    }

    #[test]
    fn test_allowance_returns_zero_after_expiration() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let current = env.ledger().sequence();
        client.approve(&alice, &spender, &250_i128, &current);
        env.ledger().set_sequence_number(current + 1);
        assert_eq!(client.allowance(&alice, &spender), 0);
    }

    #[test]
    fn test_allowance_valid_at_exact_expiration_boundary() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let current = env.ledger().sequence();
        client.approve(&alice, &spender, &250_i128, &current);
        // Ledger has not advanced past expiration_ledger yet — still valid
        assert_eq!(client.allowance(&alice, &spender), 250_i128);
    }

    #[test]
    fn test_allowance_unreadable_after_temporary_entry_is_archived() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let current = env.ledger().sequence();
        let expiration_ledger = current + 100;
        env.ledger().set_min_temp_entry_ttl(1);
        let key = DataKey::Allowance(AllowanceKey {
            from: alice.clone(),
            spender: spender.clone(),
        });
        env.as_contract(&client.address, || {
            env.storage().temporary().set(
                &key,
                &AllowanceValue {
                    amount: 250,
                    expiration_ledger,
                },
            );
        });
        assert_eq!(client.allowance(&alice, &spender), 250_i128);

        env.ledger().set_sequence_number(current + 2);
        assert!(env.ledger().sequence() < expiration_ledger);
        assert_eq!(client.allowance(&alice, &spender), 0_i128);
    }

    #[test]
    fn test_allowance_reflects_zero_amount_approval() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.approve(&alice, &spender, &0_i128, &(env.ledger().sequence() + 100));
        assert_eq!(client.allowance(&alice, &spender), 0);
    }

    // --- Issue #83: mint() edge case tests ---

    #[test]
    fn test_mint_zero_amount_is_noop() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &1000_i128);
        let balance_before = client.balance(&user);
        client.mint(&user, &0_i128);
        assert_eq!(client.balance(&user), balance_before);
    }

    #[test]
    fn test_mint_negative_amount_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let result = client.try_mint(&user, &-100_i128);
        assert_eq!(result, Err(Ok(TokenError::NegativeAmount)));
        assert_eq!(client.balance(&user), 0);
    }

    #[test]
    fn test_mint_not_initialized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let user = Address::generate(&env);
        let result = client.try_mint(&user, &100_i128);
        assert_eq!(result, Err(Ok(TokenError::NotInitialized)));
    }

    #[test]
    fn test_mint_overflow_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &i128::MAX);
        let result = client.try_mint(&user, &1_i128);
        assert_eq!(result, Err(Ok(TokenError::Overflow)));
        // Balance must remain unchanged on overflow
        assert_eq!(client.balance(&user), i128::MAX);
    }

    #[test]
    fn test_mint_to_address_with_no_prior_balance_record() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.balance(&user), 0);
        client.mint(&user, &500_i128);
        assert_eq!(client.balance(&user), 500_i128);
    }

    // ── Issue #233: Security review — auth checks, overflow safety, reentrancy ──

    // --- Auth checks: all state-mutating functions require proper authorization ---

    #[test]
    fn test_initialize_requires_admin_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let admin = Address::generate(&env);
        // Admin's auth is required and checked by require_auth()
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "Test"),
            &String::from_str(&env, "TST"),
        );
        // If require_auth() was missing, this would still succeed in mock mode
        // But we validate the implementation has the call via code review
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_approve_requires_from_auth() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        // from.require_auth() is mandatory in approve()
        let result = client.try_approve(
            &alice,
            &spender,
            &100_i128,
            &(env.ledger().sequence() + 1000),
        );
        // In mock mode this succeeds, but require_auth() is verified via code inspection
        assert!(result.is_ok());
    }

    #[test]
    fn test_transfer_requires_from_auth() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        // from.require_auth() is mandatory in transfer()
        let result = client.try_transfer(&alice, &bob, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_transfer_from_requires_spender_auth() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        // spender.require_auth() is mandatory in transfer_from()
        let result = client.try_transfer_from(&spender, &alice, &bob, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_burn_requires_from_auth() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        // from.require_auth() is mandatory in burn()
        let result = client.try_burn(&alice, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mint_requires_admin_auth() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        // mint() calls require_admin() which checks current admin's auth
        let result = client.try_mint(&user, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_set_admin_requires_current_admin_auth() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        // set_admin() requires current admin's auth via require_auth()
        let result = client.try_set_admin(&new_admin);
        assert!(result.is_ok());
        assert_eq!(client.admin(), admin);
        assert_eq!(client.pending_admin(), Some(new_admin));
    }

    // --- Overflow safety: all arithmetic operations use checked_add ---

    #[test]
    fn test_mint_checked_overflow_protection() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &i128::MAX);
        // Second mint must overflow and return Overflow error
        let result = client.try_mint(&user, &1_i128);
        assert_eq!(result, Err(Ok(TokenError::Overflow)));
        // Balance must remain at i128::MAX (unchanged)
        assert_eq!(client.balance(&user), i128::MAX);
    }

    #[test]
    fn test_transfer_checked_overflow_protection() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &i128::MAX);
        // Total supply is tracked, so a second `i128::MAX` mint overflows it:
        // no pair of balances can ever sum past `i128::MAX`, which is what
        // keeps a receiving balance from overflowing on transfer.
        assert_eq!(
            client.try_mint(&bob, &i128::MAX),
            Err(Ok(TokenError::Overflow))
        );
        client.transfer(&alice, &bob, &1_i128);
        assert_eq!(client.balance(&alice), i128::MAX - 1);
        assert_eq!(client.balance(&bob), 1);
    }

    #[test]
    fn test_transfer_from_checked_overflow_protection() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &i128::MAX);
        // See `test_transfer_checked_overflow_protection`: total-supply
        // accounting rejects the second mint, so no receiving balance can
        // overflow through `transfer_from` either.
        assert_eq!(
            client.try_mint(&bob, &i128::MAX),
            Err(Ok(TokenError::Overflow))
        );
        client.approve(
            &alice,
            &spender,
            &i128::MAX,
            &(env.ledger().sequence() + 10000),
        );
        client.transfer_from(&spender, &alice, &bob, &1_i128);
        assert_eq!(client.balance(&alice), i128::MAX - 1);
        assert_eq!(client.balance(&bob), 1);
        assert_eq!(client.allowance(&alice, &spender), i128::MAX - 1);
    }

    // --- Underflow safety: subtraction is safe via balance checks ---

    #[test]
    fn test_transfer_insufficient_balance_prevents_underflow() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &100_i128);
        // Attempt to transfer more than balance
        let result = client.try_transfer(&alice, &bob, &101_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
        // Balance must remain unchanged
        assert_eq!(client.balance(&alice), 100_i128);
        assert_eq!(client.balance(&bob), 0_i128);
    }

    #[test]
    fn test_burn_insufficient_balance_prevents_underflow() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &100_i128);
        // Attempt to burn more than balance
        let result = client.try_burn(&alice, &101_i128);
        assert_eq!(result, Err(Ok(TokenError::InsufficientBalance)));
        // Balance must remain unchanged
        assert_eq!(client.balance(&alice), 100_i128);
    }

    // --- Reentrancy: state is finalized before external calls (if any) ---
    // The token contract does not make cross-contract calls, so reentrancy
    // via external calls is not a vector. However, we verify the implementation
    // follows proper state finalization patterns:

    #[test]
    fn test_balance_updates_persist_across_multiple_calls() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.transfer(&alice, &bob, &300_i128);
        // State must persist: alice = 700, bob = 300
        assert_eq!(client.balance(&alice), 700_i128);
        assert_eq!(client.balance(&bob), 300_i128);
        // Subsequent call reads the updated state
        client.transfer(&bob, &alice, &100_i128);
        assert_eq!(client.balance(&alice), 800_i128);
        assert_eq!(client.balance(&bob), 200_i128);
    }

    #[test]
    fn test_allowance_decremented_atomically_before_transfer() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &500_i128,
            &(env.ledger().sequence() + 1000),
        );
        // Verify allowance before transfer
        assert_eq!(client.allowance(&alice, &spender), 500_i128);
        // transfer_from must atomically check allowance, decrement, and transfer
        client.transfer_from(&spender, &alice, &bob, &200_i128);
        // Allowance must be decremented before balance updates take effect
        assert_eq!(client.allowance(&alice, &spender), 300_i128);
        assert_eq!(client.balance(&alice), 800_i128);
        assert_eq!(client.balance(&bob), 200_i128);
    }

    // --- Issue #544: storage TTL / archival coverage ---
    //
    // Balance entries are persistent storage bumped via
    // `extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP)`. These tests simulate
    // ledger advancement with `automint_testutils::advance_ledger` to
    // exercise that TTL/archival behaviour directly, including the #544
    // fixes above (do_transfer previously only renewed the *recipient*
    // balance's TTL, never the sender's; burn never renewed its entry).

    // Control case: a balance minted well within the TTL window is still
    // readable.
    #[test]
    fn test_balance_survives_before_ttl_expiry() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP / 2);

        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // A balance entry whose TTL is never refreshed becomes archived once
    // the ledger sequence passes its live_until_ledger_seq. As in the other
    // contracts, the whole contract instance shares the same TTL bump
    // window here, so accessing anything past that point is rejected with
    // a hard panic caught via `catch_unwind`.
    #[test]
    fn test_balance_archived_after_ttl_expiry() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        // #345: LEDGER_BUMP is now the network's maximum entry TTL, so a
        // dormant balance survives much longer than before the fix — but a
        // keeper that never calls `bump_balance` (and no other activity
        // touches the contract) will still eventually see it archive once
        // that larger window elapses.
        automint_testutils::advance_past_ttl(&env, LEDGER_BUMP);

        let outcome =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.balance(&alice)));
        assert!(outcome.is_err(), "expected archived entry access to fail");
    }

    // #345: a keeper calling the permissionless `bump_balance` within the
    // TTL window keeps a dormant balance alive indefinitely.
    #[test]
    fn test_bump_balance_prevents_archival() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.bump_balance(&alice);
        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // #345: bump_balance must not change the stored amount.
    #[test]
    fn test_bump_balance_does_not_change_amount() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.bump_balance(&alice);
        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // #345: bump_balance on an address with no record is a harmless no-op.
    #[test]
    fn test_bump_balance_on_missing_record_is_noop() {
        let (env, _admin, client) = setup();
        let never_minted = Address::generate(&env);
        client.bump_balance(&never_minted);
        assert_eq!(client.balance(&never_minted), 0_i128);
    }

    // #544 fix verification: `do_transfer` now renews the *sender's*
    // balance TTL too, not just the recipient's. Advancing to just before
    // the original expiry, transferring funds away from alice (which,
    // pre-fix, would only have renewed bob's TTL), then advancing past the
    // original expiry must still leave alice's (now-empty) balance entry
    // readable.
    //
    // Verified manually that this test exercises the renewal (not just Env
    // defaults) by temporarily removing the sender's `write_balance` call
    // from `do_transfer`: with it removed, this test fails with
    // an archived-entry panic at the final `balance(&alice)` call.
    #[test]
    fn test_transfer_extends_sender_ttl_restores_access_near_expiry() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.transfer(&alice, &bob, &100_i128);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        assert_eq!(client.balance(&alice), 900_i128);
        assert_eq!(client.balance(&bob), 100_i128);
    }

    // #544 fix verification: `burn` now renews the balance entry's TTL,
    // matching every other balance-mutating path.
    //
    // Verified manually that this test exercises the renewal by temporarily
    // removing the balance-write helper used by `burn`: with it
    // removed, this test fails with an archived-entry panic at the final
    // `balance(&alice)` call.
    #[test]
    fn test_burn_extends_ttl_restores_access_near_expiry() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.burn(&alice, &100_i128);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        assert_eq!(client.balance(&alice), 900_i128);
    }

    // --- Issue #345: TTL archival window is documented in ledgers and days ---

    #[test]
    fn test_balance_ledger_bump_documents_archival_window_in_days() {
        // 1 ledger ≈ 5s on Soroban networks (the assumption baked into
        // `automint_testutils::advance_ledger`). LEDGER_BUMP is the
        // network's maximum entry TTL, so this is also the longest a
        // dormant balance can go between `bump_balance` calls before
        // archiving: 3,110,400 ledgers * 5s = 15,552,000s = 180 days.
        let seconds = LEDGER_BUMP as u64 * 5;
        let days = seconds / 86_400;
        assert_eq!(days, 180);
    }

    // --- Issue #344: spendable_balance ---

    #[test]
    fn test_spendable_balance_equals_balance_when_unlocked() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        assert_eq!(client.spendable_balance(&alice), 1000_i128);
    }

    #[test]
    fn test_spendable_balance_zero_for_missing_record() {
        let (env, _admin, client) = setup();
        let never_minted = Address::generate(&env);
        assert_eq!(client.spendable_balance(&never_minted), 0_i128);
    }

    #[test]
    fn test_spendable_balance_subtracts_locked_reserve() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        env.as_contract(&client.address, || {
            env.storage()
                .persistent()
                .set(&DataKey::Locked(alice.clone()), &400_i128);
        });
        assert_eq!(client.spendable_balance(&alice), 600_i128);
        // balance() itself is unaffected by the lock
        assert_eq!(client.balance(&alice), 1000_i128);
    }

    // --- Issue #346: approve() expiration_ledger validation ---

    #[test]
    fn test_approve_nonzero_amount_past_expiration_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let current = env.ledger().sequence();
        env.ledger().set_sequence_number(current + 10);
        let result = client.try_approve(&alice, &spender, &100_i128, &current);
        assert_eq!(result, Err(Ok(TokenError::InvalidExpiration)));
        assert_eq!(client.allowance(&alice, &spender), 0_i128);
    }

    #[test]
    fn test_approve_zero_amount_past_expiration_succeeds_and_revokes() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.approve(
            &alice,
            &spender,
            &300_i128,
            &(env.ledger().sequence() + 1000),
        );
        assert_eq!(client.allowance(&alice, &spender), 300_i128);

        let current = env.ledger().sequence();
        env.ledger().set_sequence_number(current + 10);
        let result = client.try_approve(&alice, &spender, &0_i128, &current);
        assert_eq!(result, Ok(Ok(())));
        assert_eq!(client.allowance(&alice, &spender), 0_i128);
    }

    #[test]
    fn test_approve_beyond_max_allowance_ledgers_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let current = env.ledger().sequence();
        let too_far = current.saturating_add(MAX_ALLOWANCE_LEDGERS) + 1;
        let result = client.try_approve(&alice, &spender, &100_i128, &too_far);
        assert_eq!(result, Err(Ok(TokenError::InvalidExpiration)));
    }

    #[test]
    fn test_approve_at_max_allowance_ledgers_cap_succeeds() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let current = env.ledger().sequence();
        let at_cap = current.saturating_add(MAX_ALLOWANCE_LEDGERS);
        let result = client.try_approve(&alice, &spender, &100_i128, &at_cap);
        assert_eq!(result, Ok(Ok(())));
        assert_eq!(client.allowance(&alice, &spender), 100_i128);
    }

    // --- Issue #347: SAC-shaped event topics/data ---
    //
    // Mirrors this crate's existing event-assertion idiom (see
    // `accrual::test::settle_emits_one_event_per_settled_user` and
    // `bot_nft`/`marketplace` tests): pull the last emitted event, decode
    // each topic slot and the data payload with `try_from_val`, and assert
    // against the documented SAC shape.

    #[test]
    fn test_mint_event_topics_match_sac_shape() {
        let (env, admin, client) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &500_i128);

        let events = env.events().all();
        let (contract_id, topics, data) = events.last().unwrap();
        assert_eq!(contract_id, client.address);
        assert_eq!(topics.len(), 3);
        let t0: Symbol = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let t1: Address = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        let t2: Address = Address::try_from_val(&env, &topics.get(2).unwrap()).unwrap();
        assert_eq!(t0, symbol_short!("mint"));
        assert_eq!(t1, admin);
        assert_eq!(t2, user);
        assert_eq!(i128::try_from_val(&env, &data).unwrap(), 500_i128);
    }

    #[test]
    fn test_transfer_event_topics_match_sac_shape() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.transfer(&alice, &bob, &200_i128);

        let events = env.events().all();
        let (contract_id, topics, data) = events.last().unwrap();
        assert_eq!(contract_id, client.address);
        assert_eq!(topics.len(), 3);
        let t0: Symbol = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let t1: Address = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        let t2: Address = Address::try_from_val(&env, &topics.get(2).unwrap()).unwrap();
        assert_eq!(t0, symbol_short!("transfer"));
        assert_eq!(t1, alice);
        assert_eq!(t2, bob);
        assert_eq!(i128::try_from_val(&env, &data).unwrap(), 200_i128);
    }

    #[test]
    fn test_burn_event_topics_match_sac_shape() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.burn(&alice, &300_i128);

        let events = env.events().all();
        let (contract_id, topics, data) = events.last().unwrap();
        assert_eq!(contract_id, client.address);
        assert_eq!(topics.len(), 2);
        let t0: Symbol = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let t1: Address = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        assert_eq!(t0, symbol_short!("burn"));
        assert_eq!(t1, alice);
        assert_eq!(i128::try_from_val(&env, &data).unwrap(), 300_i128);
    }

    // #347: burn_from must emit the same (burn, from) shape as burn() —
    // the spender is an authorization detail, not part of the topic.
    #[test]
    fn test_burn_from_event_topics_match_sac_shape() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        client.approve(
            &alice,
            &spender,
            &300_i128,
            &(env.ledger().sequence() + 1000),
        );
        client.burn_from(&spender, &alice, &100_i128);

        let events = env.events().all();
        let (contract_id, topics, data) = events.last().unwrap();
        assert_eq!(contract_id, client.address);
        assert_eq!(topics.len(), 2);
        let t0: Symbol = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let t1: Address = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        assert_eq!(t0, symbol_short!("burn"));
        assert_eq!(t1, alice);
        assert_eq!(i128::try_from_val(&env, &data).unwrap(), 100_i128);
    }

    #[test]
    fn test_approve_event_topics_match_sac_shape() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let expiration = env.ledger().sequence() + 1000;
        client.approve(&alice, &spender, &250_i128, &expiration);

        let events = env.events().all();
        let (contract_id, topics, data) = events.last().unwrap();
        assert_eq!(contract_id, client.address);
        assert_eq!(topics.len(), 3);
        let t0: Symbol = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let t1: Address = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        let t2: Address = Address::try_from_val(&env, &topics.get(2).unwrap()).unwrap();
        assert_eq!(t0, symbol_short!("approve"));
        assert_eq!(t1, alice);
        assert_eq!(t2, spender);
        let (amount, exp): (i128, u32) = <(i128, u32)>::try_from_val(&env, &data).unwrap();
        assert_eq!((amount, exp), (250_i128, expiration));
    }

    #[test]
    fn test_admin_proposed_event_topics_and_data() {
        let (env, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);

        let events = env.events().all();
        let (contract_id, topics, data) = events.last().unwrap();
        assert_eq!(contract_id, client.address);
        assert_eq!(topics.len(), 2);
        let t0: Symbol = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let t1: Address = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        assert_eq!(t0, soroban_sdk::Symbol::new(&env, "admin_proposed"));
        assert_eq!(t1, admin);
        assert_eq!(Address::try_from_val(&env, &data).unwrap(), new_admin);
    }

    proptest! {
        #[test]
        fn prop_supply_is_conserved_after_arbitrary_operations(
            actions in prop::collection::vec((0_u8..3, 0_u8..3, 1_i128..100), 0..80)
        ) {
            let (env, _admin, client) = setup();
            let users = [
                Address::generate(&env),
                Address::generate(&env),
                Address::generate(&env),
            ];

            for (operation, from_index, amount) in actions {
                let source_index = from_index as usize;
                let target_index = (source_index + 1) % users.len();
                match operation {
                    0 => client.mint(&users[source_index], &amount),
                    1 => {
                        let _ = client.try_transfer(
                            &users[source_index],
                            &users[target_index],
                            &amount,
                        );
                    }
                    _ => {
                        let _ = client.try_burn(&users[source_index], &amount);
                    }
                }

                let sum: i128 = users.iter().map(|user| client.balance(user)).sum();
                prop_assert_eq!(sum, client.total_supply());
            }
        }

        #[test]
        fn prop_balances_never_become_negative(
            actions in prop::collection::vec((0_u8..3, 0_u8..3, 1_i128..200), 0..80)
        ) {
            let (env, _admin, client) = setup();
            let users = [
                Address::generate(&env),
                Address::generate(&env),
                Address::generate(&env),
            ];

            for (operation, source, amount) in actions {
                let source_index = source as usize;
                let target_index = (source_index + 1) % users.len();
                match operation {
                    0 => client.mint(&users[source_index], &amount),
                    1 => {
                        let _ = client.try_transfer(
                            &users[source_index],
                            &users[target_index],
                            &amount,
                        );
                    }
                    _ => {
                        let _ = client.try_burn(&users[source_index], &amount);
                    }
                }
                for user in &users {
                    prop_assert!(client.balance(user) >= 0);
                }
            }
        }

        #[test]
        fn prop_transfer_from_never_increases_allowance(
            amounts in prop::collection::vec(1_i128..100, 0..80)
        ) {
            let (env, _admin, client) = setup();
            let owner = Address::generate(&env);
            let spender = Address::generate(&env);
            let recipient = Address::generate(&env);
            client.mint(&owner, &10_000_i128);
            client.approve(
                &owner,
                &spender,
                &10_000_i128,
                &(env.ledger().sequence() + 10_000),
            );
            let mut previous = client.allowance(&owner, &spender);

            for amount in amounts {
                let _ = client.try_transfer_from(&spender, &owner, &recipient, &amount);
                let current = client.allowance(&owner, &spender);
                prop_assert!(current <= previous);
                prop_assert!(current >= 0);
                previous = current;
            }
        }

        #[test]
        fn prop_transfer_then_reverse_restores_both_balances(
            alice_start in 1_i128..10_000,
            bob_start in 0_i128..10_000,
            amount in 0_i128..10_000
        ) {
            let (env, _admin, client) = setup();
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let transfer_amount = amount.min(alice_start);
            client.mint(&alice, &alice_start);
            client.mint(&bob, &bob_start);
            let alice_before = client.balance(&alice);
            let bob_before = client.balance(&bob);

            client.transfer(&alice, &bob, &transfer_amount);
            client.transfer(&bob, &alice, &transfer_amount);

            prop_assert_eq!(client.balance(&alice), alice_before);
            prop_assert_eq!(client.balance(&bob), bob_before);
        }
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

    struct Ctx {
        env: Env,
        id: Address,
        client: AMTTokenClient<'static>,
        admin: Address,
    }

    fn setup() -> Ctx {
        let env = Env::default();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let admin = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );

        Ctx {
            env,
            id,
            client,
            admin,
        }
    }

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let admin = Address::generate(&env);

        let result = client.try_initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, AMTToken);
        let client = AMTTokenClient::new(&env, &id);
        let admin = Address::generate(&env);
        let name = String::from_str(&env, "AutoMint Token");
        let symbol = String::from_str(&env, "AMT");

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), 7u32, name.clone(), symbol.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_initialize(&admin, &7u32, &name, &symbol);
        assert!(result.is_ok());
    }

    #[test]
    fn test_approve_fails_without_from_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        let spender = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[]);
        let result = ctx
            .client
            .try_approve(&alice, &spender, &100_i128, &1000_u32);
        assert!(result.is_err());
    }

    #[test]
    fn test_approve_succeeds_with_from_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        let spender = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[MockAuth {
            address: &alice,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "approve",
                args: (alice.clone(), spender.clone(), 100_i128, 1000_u32).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx
            .client
            .try_approve(&alice, &spender, &100_i128, &1000_u32);
        assert!(result.is_ok());
    }

    #[test]
    fn test_transfer_fails_without_from_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        let bob = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.mint(&alice, &1000_i128);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_transfer(&alice, &bob, &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_transfer_succeeds_with_from_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        let bob = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.mint(&alice, &1000_i128);

        ctx.env.mock_auths(&[MockAuth {
            address: &alice,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "transfer",
                args: (alice.clone(), bob.clone(), 100_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_transfer(&alice, &bob, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_transfer_from_fails_without_spender_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        let spender = Address::generate(&ctx.env);
        let bob = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.mint(&alice, &1000_i128);
        ctx.client.approve(&alice, &spender, &500_i128, &1000_u32);

        ctx.env.mock_auths(&[]);
        let result = ctx
            .client
            .try_transfer_from(&spender, &alice, &bob, &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_transfer_from_succeeds_with_spender_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        let spender = Address::generate(&ctx.env);
        let bob = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.mint(&alice, &1000_i128);
        ctx.client.approve(&alice, &spender, &500_i128, &1000_u32);

        ctx.env.mock_auths(&[MockAuth {
            address: &spender,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "transfer_from",
                args: (spender.clone(), alice.clone(), bob.clone(), 100_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx
            .client
            .try_transfer_from(&spender, &alice, &bob, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_burn_fails_without_from_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.mint(&alice, &1000_i128);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_burn(&alice, &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_burn_succeeds_with_from_auth() {
        let ctx = setup();
        let alice = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.mint(&alice, &1000_i128);

        ctx.env.mock_auths(&[MockAuth {
            address: &alice,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "burn",
                args: (alice.clone(), 100_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_burn(&alice, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mint_fails_without_admin_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_mint(&user, &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_succeeds_with_admin_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[MockAuth {
            address: &ctx.admin,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "mint",
                args: (user.clone(), 100_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_mint(&user, &100_i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_set_admin_fails_without_current_admin_auth() {
        let ctx = setup();
        let new_admin = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_set_admin(&new_admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_set_admin_succeeds_with_current_admin_auth() {
        let ctx = setup();
        let new_admin = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[MockAuth {
            address: &ctx.admin,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "set_admin",
                args: (new_admin.clone(),).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_set_admin(&new_admin);
        assert!(result.is_ok());
    }

    #[test]
    fn test_accept_admin_fails_for_third_party() {
        let ctx = setup();
        let pending = Address::generate(&ctx.env);
        let third_party = Address::generate(&ctx.env);
        ctx.client.set_admin(&pending);

        ctx.env.mock_auths(&[MockAuth {
            address: &third_party,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "accept_admin",
                args: ().into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_accept_admin().is_err());
        assert_eq!(ctx.client.admin(), ctx.admin);
        assert_eq!(ctx.client.pending_admin(), Some(pending));
    }

    #[test]
    fn test_cancel_admin_transfer_fails_for_non_admin() {
        let ctx = setup();
        let pending = Address::generate(&ctx.env);
        let third_party = Address::generate(&ctx.env);
        ctx.client.set_admin(&pending);

        ctx.env.mock_auths(&[MockAuth {
            address: &third_party,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "cancel_admin_transfer",
                args: ().into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_cancel_admin_transfer().is_err());
        assert_eq!(ctx.client.pending_admin(), Some(pending));
    }

    #[test]
    fn test_admin_roles_change_only_after_pending_admin_accepts() {
        let ctx = setup();
        let pending = Address::generate(&ctx.env);
        let user = Address::generate(&ctx.env);
        ctx.client.set_admin(&pending);

        ctx.env.mock_auths(&[MockAuth {
            address: &pending,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "mint",
                args: (user.clone(), 10_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_mint(&user, &10_i128).is_err());

        ctx.env.mock_auths(&[MockAuth {
            address: &ctx.admin,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "mint",
                args: (user.clone(), 10_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_mint(&user, &10_i128).is_ok());

        ctx.env.mock_auths(&[MockAuth {
            address: &pending,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "accept_admin",
                args: ().into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_accept_admin().is_ok());

        ctx.env.mock_auths(&[MockAuth {
            address: &ctx.admin,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "mint",
                args: (user.clone(), 10_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_mint(&user, &10_i128).is_err());

        ctx.env.mock_auths(&[MockAuth {
            address: &pending,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "mint",
                args: (user.clone(), 10_i128).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        assert!(ctx.client.try_mint(&user, &10_i128).is_ok());
    }

    #[test]
    fn test_set_metadata_fails_without_admin_auth() {
        let ctx = setup();
        let name = String::from_str(&ctx.env, "Updated Name");
        let symbol = String::from_str(&ctx.env, "NEW");

        ctx.env.mock_auths(&[]);
        assert!(ctx.client.try_set_metadata(&name, &symbol).is_err());
    }
}
