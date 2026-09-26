// SPDX-License-Identifier: Apache-2.0

//! Shared contract scaffolding: TTL constants, storage helpers, admin management,
//! and pausable pattern used across all AutoMint contracts.
//!
//! Created to address #337 (extract duplicated scaffolding) and #336 (pausable pattern).

#![no_std]

use soroban_sdk::{contracttype, contracterror, Address, Env};

/// TTL bump amount: ~7 days at 5s/ledger
pub const LEDGER_BUMP: u32 = 120960;

/// TTL extension threshold
pub const LEDGER_THRESHOLD: u32 = 103680;

/// Extends TTL for a persistent storage key
pub fn extend_persistent<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
}

/// Extends TTL for instance storage
pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}

/// Shared data keys for admin and pause state
#[derive(Clone)]
#[contracttype]
pub enum CommonDataKey {
    Admin,
    Paused,
}

/// Admin storage helper
pub struct AdminStore;

impl AdminStore {
    /// Initializes admin (should be called during contract initialization)
    pub fn init(env: &Env, admin: &Address) {
        env.storage()
            .instance()
            .set(&CommonDataKey::Admin, admin);
    }

    /// Gets the current admin address
    pub fn get(env: &Env) -> Option<Address> {
        env.storage().instance().get(&CommonDataKey::Admin)
    }

    /// Requires that the current admin has authorized the operation
    pub fn require(env: &Env) -> Result<(), CommonError> {
        let admin: Address = Self::get(env).ok_or(CommonError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }
}

/// Pausable pattern helper
pub struct PausableStore;

impl PausableStore {
    /// Checks if the contract is paused
    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&CommonDataKey::Paused)
            .unwrap_or(false)
    }

    /// Sets the pause state (admin-only, enforced by caller)
    pub fn set_paused(env: &Env, paused: bool) {
        env.storage()
            .instance()
            .set(&CommonDataKey::Paused, &paused);
        extend_instance(env);
    }

    /// Returns error if contract is paused
    pub fn require_not_paused(env: &Env) -> Result<(), CommonError> {
        if Self::is_paused(env) {
            Err(CommonError::Paused)
        } else {
            Ok(())
        }
    }
}

/// Common errors shared across contracts
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CommonError {
    /// Contract is paused
    Paused = 1000,
    /// Not initialized
    NotInitialized = 1001,
    /// Unauthorized operation
    Unauthorized = 1002,
}
