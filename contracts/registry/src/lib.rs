// SPDX-License-Identifier: Apache-2.0

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
    Username(String),
    // Global storage
    UserList,
    TotalUsers,
    Admin,
    Initialized,
    // Authorized writer set (accrual + bot_nft) for #318 gating.
    Writers,
}

// #39: Define UserProfile struct
#[derive(Clone, Debug)]
#[contracttype]
pub struct UserProfile {
    pub address: Address,
    pub username: String,
    pub total_points: u64,
    pub claimed_amt: i128,
    pub registered_at: u64,
    pub bot_count: u32,
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
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::TotalUsers, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::UserList, &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

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
            return Err(RegistryError::UsernameTaken);
        }

        // Check for username uniqueness
        if env
            .storage()
            .persistent()
            .has(&DataKey::Username(username.clone()))
        {
            return Err(RegistryError::UsernameTaken);
        }

        // Create new user profile with initial values
        let profile = UserProfile {
            address: user.clone(),
            username: username.clone(),
            total_points: 0,
            claimed_amt: 0,
            registered_at: env.ledger().timestamp(),
            bot_count: 0,
        };

        // Store user profile
        env.storage()
            .persistent()
            .set(&DataKey::UserProfile(user.clone()), &profile);

        // Store username mapping
        env.storage()
            .persistent()
            .set(&DataKey::Username(username), &user);

        // Extend TTL for user profile
        env.storage().persistent().extend_ttl(
            &DataKey::UserProfile(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        // Add user to the global user list
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::UserList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(user.clone());
        env.storage().instance().set(&DataKey::UserList, &list);

        // Increment total user counter
        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalUsers)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalUsers, &(total + 1));

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

    pub fn is_registered(env: Env, user: Address) -> bool {
        env.storage().persistent().has(&DataKey::UserProfile(user))
    }

    pub fn get_user(env: Env, user: Address) -> Result<UserProfile, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::UserProfile(user))
            .ok_or(RegistryError::NotRegistered)
    }

    // #318: Configure the authorized writer set. Admin-only, idempotent. Off by
    // default until called, then only the configured addresses may mutate gated
    // fields.
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
        profile.total_points = profile.total_points.saturating_add(points);
        env.storage()
            .persistent()
            .set(&DataKey::UserProfile(user.clone()), &profile);
        env.storage().persistent().extend_ttl(
            &DataKey::UserProfile(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.events()
            .publish((symbol_short!("addpoints"), user), points);
        Ok(())
    }

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
        env.storage()
            .persistent()
            .set(&DataKey::UserProfile(user.clone()), &profile);
        env.storage().persistent().extend_ttl(
            &DataKey::UserProfile(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Ok(())
    }

    pub fn decrement_bot_count(env: Env, user: Address) -> Result<(), RegistryError> {
        user.require_auth();
        let mut profile: UserProfile = env
            .storage()
            .persistent()
            .get(&DataKey::UserProfile(user.clone()))
            .ok_or(RegistryError::NotRegistered)?;
        // Floor at zero — bot_count is a u32, saturating_sub prevents underflow
        profile.bot_count = profile.bot_count.saturating_sub(1);
        env.storage()
            .persistent()
            .set(&DataKey::UserProfile(user.clone()), &profile);
        // Extend TTL so the profile doesn't expire around active bot operations
        env.storage().persistent().extend_ttl(
            &DataKey::UserProfile(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.events()
            .publish((symbol_short!("dec_bot"), user), profile.bot_count);
        Ok(())
    }

    pub fn add_claimed_amt(env: Env, user: Address, amount: i128) -> Result<(), RegistryError> {
        // #318: only the configured accrual writer may mutate claimed amounts.
        Self::require_accrual(&env)?;
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
        env.storage()
            .persistent()
            .set(&DataKey::UserProfile(user.clone()), &profile);
        env.storage().persistent().extend_ttl(
            &DataKey::UserProfile(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Ok(())
    }

    // Bubble sort in-contract — gas bounded by user count
    pub fn get_leaderboard(env: Env, limit: u32) -> Vec<UserProfile> {
        if limit == 0 {
            return Vec::new(&env);
        }
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::UserList)
            .unwrap_or_else(|| Vec::new(&env));
        let mut profiles: Vec<UserProfile> = Vec::new(&env);
        for addr in list.iter() {
            if let Some(p) = env
                .storage()
                .persistent()
                .get::<_, UserProfile>(&DataKey::UserProfile(addr.clone()))
            {
                profiles.push_back(p);
            }
        }
        let n = profiles.len();
        for i in 0..n {
            for j in 0..n.saturating_sub(i).saturating_sub(1) {
                let a = profiles.get(j).unwrap();
                let b = profiles.get(j + 1).unwrap();
                if a.total_points < b.total_points {
                    profiles.set(j, b);
                    profiles.set(j + 1, a);
                }
            }
        }
        let take = limit.min(n) as usize;
        let mut result: Vec<UserProfile> = Vec::new(&env);
        for p in profiles.iter().take(take) {
            result.push_back(p);
        }
        result
    }

    // Missing record (queried before initialize()) correctly defaults to 0 —
    // zero registered users is the true state, not an error.
    pub fn total_users(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalUsers)
            .unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Env, IntoVal, String,
    };

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
        assert_eq!(result, Err(Ok(RegistryError::UsernameTaken)));
    }

    // #40: Test invalid username (too long)
    #[test]
    fn test_long_username_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let long_name = String::from_str(&env, "thisistoolongusernamethatexceedsthelimit");
        let result = client.try_register(&user, &long_name);
        assert_eq!(result, Err(Ok(RegistryError::UsernameTaken)));
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

    // #40: Test add_claimed_amt with negative amounts
    #[test]
    fn test_add_claimed_amt_negative() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "Echo"));
        client.add_claimed_amt(&user, &1000_i128);
        client.add_claimed_amt(&user, &-300_i128);
        assert_eq!(client.get_user(&user).claimed_amt, 700);
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
        assert_eq!(client.get_admin(), admin);
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
        assert_eq!(client.get_admin(), admin);
    }

    // #37: Test admin persists across calls
    #[test]
    fn test_admin_persists() {
        let (_env, admin, client) = setup();
        let retrieved_admin1 = client.get_admin();
        let retrieved_admin2 = client.get_admin();
        assert_eq!(retrieved_admin1, admin);
        assert_eq!(retrieved_admin2, admin);
        assert_eq!(retrieved_admin1, retrieved_admin2);
    }

    #[test]
    fn test_admin_fails_if_not_initialized() {
        let env = Env::default();
        let id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &id);
        let result = client.try_get_admin();
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
        assert_eq!(profile.username, String::from_str(&env, "FullCheck"));
        assert_eq!(profile.total_points, 42);
        assert_eq!(profile.claimed_amt, 100);
        assert_eq!(profile.bot_count, 1);
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
        assert_eq!(profile.username, username);
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
    fn test_register_username_case_sensitive() {
        let (env, _admin, client) = setup();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.register(&user1, &String::from_str(&env, "TestUser"));
        client.register(&user2, &String::from_str(&env, "testuser"));

        // Both should succeed since usernames are case-sensitive
        let profile1 = client.get_user(&user1);
        let profile2 = client.get_user(&user2);
        assert_eq!(profile1.username, String::from_str(&env, "TestUser"));
        assert_eq!(profile2.username, String::from_str(&env, "testuser"));
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
        assert_eq!(profile.username, String::from_str(&env, "IdempotentUser"));
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

    // #93: total_points saturates at u64::MAX instead of overflowing/panicking
    #[test]
    fn test_add_points_saturates_at_max() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.register(&user, &String::from_str(&env, "MaxPoints"));
        client.add_points(&user, &u64::MAX);
        client.add_points(&user, &1_u64);
        assert_eq!(client.get_user(&user).total_points, u64::MAX);
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
        assert_eq!(profile.username, String::from_str(&env, "Ttl1"));
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
    // Note: the *contract instance* (Admin/Initialized/TotalUsers/UserList)
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
        assert_eq!(profile.username, String::from_str(&env, "Ttl3"));
        assert_eq!(profile.total_points, 10);
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
}
