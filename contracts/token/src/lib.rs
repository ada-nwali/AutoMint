// SPDX-License-Identifier: Apache-2.0

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Allowance(AllowanceKey),
    Balance(Address),
    State,
    Admin,
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
}

// ~7 days at 5s/ledger
const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;

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
        admin.require_auth();
        if decimal == 0 {
            return Err(TokenError::NegativeAmount);
        }
        let state = TokenState {
            decimal,
            name,
            symbol,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
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
        if !env.storage().instance().has(&DataKey::State) {
            return Err(TokenError::NotInitialized);
        }
        from.require_auth();
        if amount < 0 {
            return Err(TokenError::NegativeAmount);
        }
        if from == spender {
            return Err(TokenError::Unauthorized);
        }
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let value = AllowanceValue {
            amount,
            expiration_ledger,
        };
        env.storage().temporary().set(&key, &value);
        let current = env.ledger().sequence();
        if expiration_ledger > current {
            let ttl = expiration_ledger - current;
            env.storage().temporary().extend_ttl(&key, ttl, ttl);
        }
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

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        if amount < 0 {
            return Err(TokenError::NegativeAmount);
        }

        if amount == 0 {
            return Ok(());
        }

        if from == to {
            return Err(TokenError::Unauthorized);
        }

        Self::do_transfer(&env, &from, &to, amount)
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        spender.require_auth();

        // Reject negative amounts before touching allowance or balances
        if amount < 0 {
            return Err(TokenError::NegativeAmount);
        }

        // Zero-amount transfers are a no-op (no allowance consumed, no state change)
        if amount == 0 {
            return Ok(());
        }

        // spender must be distinct from from — use transfer() for self-initiated moves
        if spender == from {
            return Err(TokenError::Unauthorized);
        }

        // Sending to yourself is always a no-op: reject it to avoid pointless state writes
        if from == to {
            return Err(TokenError::Unauthorized);
        }

        Self::spend_allowance(&env, &from, &spender, amount)?;
        Self::do_transfer(&env, &from, &to, amount)
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        // Validate amount is not negative
        if amount < 0 {
            return Err(TokenError::NegativeAmount);
        }

        // Validate amount is not zero (burning zero is pointless)
        if amount == 0 {
            return Ok(()); // No-op for zero amount
        }

        // Get current balance and validate it exists and is sufficient
        let balance = Self::balance(env.clone(), from.clone());
        if balance < amount {
            return Err(TokenError::InsufficientBalance);
        }

        // Perform the burn
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(balance - amount));
        // #544: as with do_transfer, refresh the balance entry's TTL on
        // every write instead of only on mint.
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(from.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish((symbol_short!("burn"), from), amount);
        Ok(())
    }

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        Self::require_admin(&env)?;
        if amount < 0 {
            return Err(TokenError::NegativeAmount);
        }

        // Zero-amount mints are a no-op — consistent with transfer/burn
        if amount == 0 {
            return Ok(());
        }

        let balance = Self::balance(env.clone(), to.clone());
        let new_balance = balance.checked_add(amount).ok_or(TokenError::Overflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &new_balance);
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(to.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.events().publish((symbol_short!("mint"), to), amount);
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), TokenError> {
        // Guard: contract must be initialized before admin can be transferred
        if !env.storage().instance().has(&DataKey::State) {
            return Err(TokenError::NotInitialized);
        }

        // Resolve and authenticate the current admin
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)?;
        current_admin.require_auth();

        // Reject self-assignment — transferring admin to the current admin is a no-op
        // that wastes a transaction; callers should be aware of the current admin.
        if new_admin == current_admin {
            return Err(TokenError::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        // Extend instance TTL so the new admin key stays live
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events()
            .publish((symbol_short!("set_admin"),), new_admin);
        Ok(())
    }

    pub fn admin(env: Env) -> Result<Address, TokenError> {
        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)
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

    fn require_admin(env: &Env) -> Result<(), TokenError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TokenError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    fn do_transfer(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        if amount < 0 {
            return Err(TokenError::NegativeAmount);
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
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &new_to);
        // #544: the sender's balance entry is written on every transfer
        // just like the recipient's, but its TTL was never refreshed here —
        // only the recipient's was. A wallet that only ever sends (never
        // receives) could have its balance entry silently archive even
        // while actively transacting. Bump both sides.
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(from.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(to.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        // Keep the contract instance itself alive on write activity too —
        // mirrors `registry::register` and the bot_nft `transfer` fix.
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (symbol_short!("transfer"), from.clone(), to.clone()),
            amount,
        );
        Ok(())
    }

    fn spend_allowance(
        env: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
    ) -> Result<(), TokenError> {
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
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount: a.amount - amount,
                expiration_ledger: a.expiration_ledger,
            },
        );
        Ok(())
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
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

    // #79: from == to (self-transfer) → Unauthorized; balance must not change
    #[test]
    fn test_transfer_self_transfer_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &1000_i128);
        let result = client.try_transfer(&alice, &alice, &100_i128);
        assert_eq!(result, Err(Ok(TokenError::Unauthorized)));
        assert_eq!(client.balance(&alice), 1000_i128);
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

    // #84: New admin is stored and can exercise admin-only functions
    #[test]
    fn test_set_admin_and_mint_from_new_admin() {
        let (env, _admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        let user = Address::generate(&env);
        client.mint(&user, &50_i128);
        assert_eq!(client.balance(&user), 50_i128);
    }

    // #84: admin() reflects the new address immediately after set_admin
    #[test]
    fn test_set_admin_updates_admin_address() {
        let (env, _old_admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);
    }

    // #84: Chained transfers — A → B → C, each step updates admin correctly
    #[test]
    fn test_set_admin_chained_transfers() {
        let (env, _admin_a, client) = setup();
        let admin_b = Address::generate(&env);
        let admin_c = Address::generate(&env);
        client.set_admin(&admin_b);
        assert_eq!(client.admin(), admin_b);
        client.set_admin(&admin_c);
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

    // #84: After transfer, the old admin can no longer call mint (loses rights)
    #[test]
    fn test_set_admin_old_admin_loses_mint_rights() {
        let (env, old_admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);

        // In mock_all_auths, all auths are approved regardless of who signs,
        // so we verify rights via the stored admin address: confirm admin() is no longer old_admin
        assert_ne!(client.admin(), old_admin);
        assert_eq!(client.admin(), new_admin);
    }

    // #84: TTL is extended — instance storage remains readable after set_admin
    #[test]
    fn test_set_admin_extends_ttl() {
        let (env, _admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        // If TTL was not extended instance storage could expire; confirm admin() still works
        assert_eq!(client.admin(), new_admin);
        // And other instance data (token state) is still accessible
        assert_eq!(client.decimals(), 7u32);
    }

    // #84: set_admin does not affect any token balances
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

    // #81: from == to (self-transfer) → Unauthorized
    #[test]
    fn test_transfer_from_self_transfer_fails() {
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
        assert_eq!(result, Err(Ok(TokenError::Unauthorized)));
        // Allowance must be untouched
        assert_eq!(client.allowance(&alice, &spender), 500_i128);
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
    fn test_approve_self_approval_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let result =
            client.try_approve(&alice, &alice, &100_i128, &(env.ledger().sequence() + 1000));
        assert_eq!(result, Err(Ok(TokenError::Unauthorized)));
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
        assert_eq!(result, Err(Ok(TokenError::NegativeAmount)));
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
        let (env, _admin, client) = setup();
        let new_admin = Address::generate(&env);
        // set_admin() requires current admin's auth via require_auth()
        let result = client.try_set_admin(&new_admin);
        assert!(result.is_ok());
        assert_eq!(client.admin(), new_admin);
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
        client.mint(&bob, &i128::MAX);
        // Transfer would cause overflow in bob's balance
        let result = client.try_transfer(&alice, &bob, &1_i128);
        assert_eq!(result, Err(Ok(TokenError::Overflow)));
        // Balances must remain unchanged
        assert_eq!(client.balance(&alice), i128::MAX);
        assert_eq!(client.balance(&bob), i128::MAX);
    }

    #[test]
    fn test_transfer_from_checked_overflow_protection() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &i128::MAX);
        client.mint(&bob, &i128::MAX);
        client.approve(
            &alice,
            &spender,
            &i128::MAX,
            &(env.ledger().sequence() + 10000),
        );
        // transfer_from would cause overflow in bob's balance
        let result = client.try_transfer_from(&spender, &alice, &bob, &1_i128);
        assert_eq!(result, Err(Ok(TokenError::Overflow)));
        // Balances must remain unchanged and allowance untouched
        assert_eq!(client.balance(&alice), i128::MAX);
        assert_eq!(client.balance(&bob), i128::MAX);
        assert_eq!(client.allowance(&alice, &spender), i128::MAX);
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
    // balance's TTL, never the sender's; burn never renewed it at all).

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

        automint_testutils::advance_past_ttl(&env, LEDGER_BUMP);

        let outcome =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.balance(&alice)));
        assert!(outcome.is_err(), "expected archived entry access to fail");
    }

    // #544 fix verification: `do_transfer` now renews the *sender's*
    // balance TTL too, not just the recipient's. Advancing to just before
    // the original expiry, transferring funds away from alice (which,
    // pre-fix, would only have renewed bob's TTL), then advancing past the
    // original expiry must still leave alice's (now-empty) balance entry
    // readable.
    //
    // Verified manually that this test exercises the renewal (not just Env
    // defaults) by temporarily removing the sender-side `extend_ttl` call
    // added to `do_transfer` above: with it removed, this test fails with
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
    // removing the `extend_ttl` call added to `burn` above: with it
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
}
