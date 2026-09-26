// SPDX-License-Identifier: Apache-2.0

#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
    Vec, IntoVal,
};

/// The one bot_nft entry point accrual calls. Declared locally rather than
/// depending on `automint-bot-nft`: linking a second contract crate alongside
/// `automint-token` duplicates exported symbols (`admin`, `burn`, `transfer`)
/// and breaks the wasm32v1-none build.
#[contractclient(name = "BotNftClient")]
pub trait BotNftInterface {
    fn get_user_total_rate(env: Env, user: Address) -> u64;
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct AccrualState {
    pub last_claim_ts: u64,
    pub carry_points: u64,
    pub lifetime_points: u64,
    pub rate: u64,
    pub started_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Config,
    Admin,
    Initialized,
    BotNft,
    Registry,
    UserAccrual(Address),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Config {
    pub points_per_amt: u64,
}

/// Most users a single `get_accrual_states` call accepts.
pub const MAX_BATCH_USERS: u32 = 50;

fn read_accrual_state(env: &Env, user: &Address) -> Option<AccrualState> {
    env.storage()
        .persistent()
        .get::<_, UserAccrual>(&DataKey::UserAccrual(user.clone()))
        .map(AccrualState::from)
}

#[derive(Clone)]
#[contracttype]
pub struct UserAccrual {
    pub user: Address,
    pub rate: u64,
    pub last_claim_ts: u64,
    pub carry_points: u64,
    pub lifetime_points: u64,
    pub started_at: u64,
}

impl From<UserAccrual> for AccrualState {
    fn from(a: UserAccrual) -> Self {
        AccrualState {
            last_claim_ts: a.last_claim_ts,
            carry_points: a.carry_points,
            lifetime_points: a.lifetime_points,
            rate: a.rate,
            started_at: a.started_at,
        }
    }
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AccrualError {
    AlreadyInitialized = 1,
    AlreadyStarted = 2,
    NotStarted = 3,
    Unauthorized = 4,
    NotInitialized = 5,
    RegistryCallFailed = 6,
    TokenMintFailed = 7,
    InvalidConfig = 8,
    NoBots = 9,
    TooManyUsers = 10,
    NotRegistered = 11,
}

fn get_reg_err_code(
    res: &Result<
        Result<(), soroban_sdk::ConversionError>,
        Result<automint_registry::RegistryError, soroban_sdk::InvokeError>,
    >,
) -> u32 {
    match res {
        Ok(Ok(())) => 0,
        Err(Ok(e)) => *e as u32,
        _ => 999,
    }
}

fn get_token_err_code(
    res: &Result<
        Result<(), soroban_sdk::ConversionError>,
        Result<automint_token::TokenError, soroban_sdk::InvokeError>,
    >,
) -> u32 {
    match res {
        Ok(Ok(())) => 0,
        Err(Ok(e)) => *e as u32,
        _ => 999,
    }
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;

#[contract]
pub struct AccrualContract;

#[contractimpl]
impl AccrualContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        bot_nft: Address,
        registry: Address,
        points_per_amt: u64,
    ) -> Result<(), AccrualError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(AccrualError::AlreadyInitialized);
        }

        if points_per_amt == 0 {
            return Err(AccrualError::InvalidConfig);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::BotNft, &bot_nft);
        env.storage().instance().set(&DataKey::Registry, &registry);

        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { points_per_amt });

        env.storage().instance().set(&DataKey::Initialized, &true);
        let mut args = Vec::new(&env);
        args.push_back(env.current_contract_address().into_val(&env));
        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
            &bot_nft, &soroban_sdk::Symbol::new(&env, "set_accrual"), args);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        Ok(())
    }

    pub fn sync_rate(env: Env, user: Address) -> Result<u64, AccrualError> {
        let Some(mut accrual) = env.storage().persistent().get::<_, UserAccrual>(&DataKey::UserAccrual(user.clone())) else {
            return Ok(0);
        };
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(accrual.last_claim_ts);
        let settled = elapsed.saturating_mul(accrual.rate) / 3600;
        accrual.carry_points = accrual.carry_points.saturating_add(settled);
        accrual.lifetime_points = accrual.lifetime_points.saturating_add(settled);
        accrual.last_claim_ts = now;
        let bot_nft: Address = env.storage().instance().get(&DataKey::BotNft).ok_or(AccrualError::NotInitialized)?;
        accrual.rate = BotNftClient::new(&env, &bot_nft).get_user_total_rate(&user);
        env.storage().persistent().set(&DataKey::UserAccrual(user.clone()), &accrual);
        env.storage().persistent().extend_ttl(&DataKey::UserAccrual(user), LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(settled)
    }

    /// Starts accruing for `user` at the combined rate of the bots they own,
    /// read from the bot_nft contract — never from the caller (#319).
    ///
    /// The user must already be registered (#415): an unregistered address
    /// would otherwise accrue time it can never claim, failing later inside
    /// `registry.add_points` with no actionable error.
    pub fn start_accrual(env: Env, user: Address) -> Result<(), AccrualError> {
        user.require_auth();
        if env
            .storage()
            .persistent()
            .has(&DataKey::UserAccrual(user.clone()))
        {
            return Err(AccrualError::AlreadyStarted);
        }
        let registry: Address = env
            .storage()
            .instance()
            .get(&DataKey::Registry)
            .ok_or(AccrualError::NotInitialized)?;
        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry);
        if !reg_client.is_registered(&user) {
            return Err(AccrualError::NotRegistered);
        }
        let bot_nft: Address = env
            .storage()
            .instance()
            .get(&DataKey::BotNft)
            .ok_or(AccrualError::NotInitialized)?;
        let rate = BotNftClient::new(&env, &bot_nft).get_user_total_rate(&user);
        if rate == 0 {
            return Err(AccrualError::NoBots);
        }
        let accrual = UserAccrual {
            user: user.clone(),
            rate,
            last_claim_ts: env.ledger().timestamp(),
            carry_points: 0,
            lifetime_points: 0,
            started_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::UserAccrual(user.clone()), &accrual);
        env.storage().persistent().extend_ttl(
            &DataKey::UserAccrual(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.events().publish(
            (symbol_short!("start"), user.clone()),
            env.ledger().timestamp(),
        );
        Ok(())
    }

    pub fn pending_points(env: Env, user: Address) -> Result<u128, AccrualError> {
        let accrual: UserAccrual = env
            .storage()
            .persistent()
            .get(&DataKey::UserAccrual(user))
            .ok_or(AccrualError::NotStarted)?;
        let elapsed = env
            .ledger()
            .timestamp()
            .saturating_sub(accrual.last_claim_ts) as u128;
        Ok(elapsed.saturating_mul(accrual.rate as u128) / 3600)
    }

    /// Seconds until the next AMT token will be earned. Returns 0 if the user
    /// already has enough carry points for the next token or if their rate is 0.
    /// Computed from carry_points, points_per_amt, and accrual rate.
    pub fn seconds_to_next_amt(env: Env, user: Address) -> Result<u64, AccrualError> {
        let accrual: UserAccrual = env
            .storage()
            .persistent()
            .get(&DataKey::UserAccrual(user))
            .ok_or(AccrualError::NotStarted)?;

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(AccrualError::NotInitialized)?;

        if accrual.rate == 0 {
            return Ok(0);
        }

        let points_needed = config
            .points_per_amt
            .saturating_sub(accrual.carry_points);

        if points_needed == 0 {
            return Ok(0);
        }

        let seconds = ((points_needed as u128 * 3600).saturating_add(accrual.rate as u128 - 1))
            / (accrual.rate as u128);
        Ok(seconds as u64)
    }

    pub fn get_accrual_state(env: Env, user: Address) -> Option<AccrualState> {
        read_accrual_state(&env, &user)
    }

    /// Accrual states for up to `MAX_BATCH_USERS` users in one call, in the
    /// same order as `users`. Addresses with no accrual record map to `None`.
    /// Lets a leaderboard poll one simulation instead of one per row (#420).
    pub fn get_accrual_states(
        env: Env,
        users: Vec<Address>,
    ) -> Result<Vec<Option<AccrualState>>, AccrualError> {
        if users.len() > MAX_BATCH_USERS {
            return Err(AccrualError::TooManyUsers);
        }
        let mut states: Vec<Option<AccrualState>> = Vec::new(&env);
        for user in users.iter() {
            states.push_back(read_accrual_state(&env, &user));
        }
        Ok(states)
    }

    pub fn claim(
        env: Env,
        user: Address,
        token_contract: Address,
        registry: Address,
    ) -> Result<i128, AccrualError> {
        user.require_auth();

        let accrual: UserAccrual = env
            .storage()
            .persistent()
            .get(&DataKey::UserAccrual(user.clone()))
            .ok_or(AccrualError::NotStarted)?;

        let current_ts = env.ledger().timestamp();
        let elapsed = current_ts.saturating_sub(accrual.last_claim_ts);
        let pending = elapsed.saturating_mul(accrual.rate) / 3600;

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(AccrualError::NotInitialized)?;

        // Total redeemable carry points
        let updated_carry = accrual.carry_points.saturating_add(pending);

        // Number of AMT tokens to mint
        let amt_to_mint = updated_carry / config.points_per_amt;

        // Carry forward only leftover points
        let remaining_carry = updated_carry % config.points_per_amt;

        // Lifetime points accumulation
        let updated_lifetime = accrual.lifetime_points.saturating_add(pending);

        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry);

        let reg_res = reg_client.try_add_points(&user, &pending);
        if reg_res.is_err() || matches!(&reg_res, Ok(Err(_))) {
            let code = get_reg_err_code(&reg_res);
            env.events()
                .publish((symbol_short!("fail_reg"), user.clone()), code);
            return Err(AccrualError::RegistryCallFailed);
        }

        if amt_to_mint > 0 {
            let token_client = automint_token::AMTTokenClient::new(&env, &token_contract);

            let mint_res = token_client.try_mint(&user, &(amt_to_mint as i128));
            if mint_res.is_err() || matches!(&mint_res, Ok(Err(_))) {
                let code = get_token_err_code(&mint_res);
                env.events()
                    .publish((symbol_short!("fail_mint"), user.clone()), code);
                return Err(AccrualError::TokenMintFailed);
            }

            let claimed_res = reg_client.try_add_claimed_amt(&user, &(amt_to_mint as i128));
            if claimed_res.is_err() || matches!(&claimed_res, Ok(Err(_))) {
                let code = get_reg_err_code(&claimed_res);
                env.events()
                    .publish((symbol_short!("fail_reg"), user.clone()), code);
                return Err(AccrualError::RegistryCallFailed);
            }

            env.events()
                .publish((symbol_short!("mint"), user.clone()), amt_to_mint as i128);
        }

        // Persist state only after all external calls succeed
        let updated_accrual = UserAccrual {
            user: accrual.user,
            rate: accrual.rate,
            last_claim_ts: current_ts,
            carry_points: remaining_carry,
            lifetime_points: updated_lifetime,
            started_at: accrual.started_at,
        };

        env.storage()
            .persistent()
            .set(&DataKey::UserAccrual(user.clone()), &updated_accrual);
        env.storage().persistent().extend_ttl(
            &DataKey::UserAccrual(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("claim"), user),
            (pending, remaining_carry, updated_lifetime),
        );

        Ok(pending as i128)
    }

    pub fn get_accrual_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn config(env: Env) -> Result<Config, AccrualError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(AccrualError::NotInitialized)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use automint_bot_nft::{BotNFTContractClient, BotTier};
    use automint_testutils::{deploy_all, register_user};
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Env};

    /// One hour in seconds. A Basic bot accrues 1 point per hour, so tests
    /// advance time in whole hours to get whole points.
    const HOUR: u64 = 3600;

    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        AccrualContractClient<'static>,
    ) {
        let (env, admin, registry, token, _bot_nft, client) = setup_with_bot_nft();
        (env, admin, registry, token, client)
    }

    fn setup_with_bot_nft() -> (
        Env,
        Address,
        Address,
        Address,
        BotNFTContractClient<'static>,
        AccrualContractClient<'static>,
    ) {
        let deployment = deploy_all(Env::default());
        let client = AccrualContractClient::new(&deployment.env, &deployment.accrual_id);
        let bot_nft = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
        (
            deployment.env,
            deployment.admin,
            deployment.registry_id,
            deployment.token_id,
            bot_nft,
            client,
        )
    }

    static NEXT_AUTO_NAME: std::sync::atomic::AtomicU64 =
        std::sync::atomic::AtomicU64::new(0);

    /// Registers `user` (if not already), mints a free Basic bot (rate 1)
    /// for them, and starts their accrual.
    ///
    /// `start_accrual` requires registration (#415), so the helper registers
    /// first with a unique auto-username; an explicit prior registration by
    /// the caller is kept (`AlreadyRegistered` is ignored).
    fn start_basic(env: &Env, client: &AccrualContractClient, user: &Address) {
        let registry_id: Address = env.as_contract(&client.address, || {
            env.storage().instance().get(&DataKey::Registry).unwrap()
        });
        let reg_client = automint_registry::RegistryContractClient::new(env, &registry_id);
        let n = NEXT_AUTO_NAME.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let auto_name = std::format!("autouser{n}");
        let _ = reg_client.try_register(user, &soroban_sdk::String::from_str(env, &auto_name));
        let bot_nft_id: Address = env.as_contract(&client.address, || {
            env.storage().instance().get(&DataKey::BotNft).unwrap()
        });
        BotNFTContractClient::new(env, &bot_nft_id).mint_basic(user);
        client.start_accrual(user);
    }

    #[test]
    fn test_initialize() {
        let (_env, _admin, _registry, _token, client) = setup();
        let config = client.config();
        assert_eq!(config.points_per_amt, 100);
    }

    #[test]
    fn test_double_initialize_fails() {
        let (_env, _admin, _registry, _token, client) = setup();
        let result = client.try_initialize(
            &_admin,
            &Address::generate(&_env),
            &_registry,
            &100_u64,
        );
        assert_eq!(result, Err(Ok(AccrualError::AlreadyInitialized)));
    }

    #[test]
    fn test_initialize_zero_points_per_amt_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let result = client.try_initialize(
            &admin,
            &Address::generate(&env),
            &Address::generate(&env),
            &0_u64,
        );
        assert_eq!(result, Err(Ok(AccrualError::InvalidConfig)));
    }

    #[test]
    fn test_start_accrual() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_start_accrual_initializes_correctly() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        let start_ts = env.ledger().timestamp();

        start_basic(&env, &client, &user);

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.last_claim_ts, start_ts);
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 0);
        // #418: the state carries everything the dashboard needs in one call.
        assert_eq!(state.rate, 1);
        assert_eq!(state.started_at, start_ts);
    }

    #[test]
    fn test_accrual_state_carries_rate_and_started_at() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        let start_ts = env.ledger().timestamp();
        start_basic(&env, &client, &user);

        // The returned projection matches the stored record's rate and
        // started_at instead of dropping them (#418).
        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.rate, 1);
        assert_eq!(state.started_at, start_ts);

        env.ledger().with_mut(|l| {
            l.timestamp += 10 * HOUR;
        });
        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.rate, 1);
        assert_eq!(state.started_at, start_ts);
    }

    #[test]
    fn test_double_start_accrual_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);
        let result = client.try_start_accrual(&user);
        assert_eq!(result, Err(Ok(AccrualError::AlreadyStarted)));
    }

    #[test]
    fn test_pending_points_calculation() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 100;
            ledger.timestamp += 500 * HOUR;
        });

        let pending = client.pending_points(&user);
        assert!(pending > 0);
    }

    #[test]
    fn test_claim_resets_timestamp() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 50 * HOUR;
        });

        let _pending = client.claim(&user, &token, &registry);
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_claim_below_threshold_mints_nothing() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        // Basic bot = 1 point/hour, so 50h = 50 points < 100 threshold
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 50 * HOUR;
        });

        let pending = client.claim(&user, &token, &registry);
        assert_eq!(pending, 50);
    }

    #[test]
    fn test_claim_accumulates_total_claimed() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        // Basic bot = 1 point/hour, stays below 100 threshold per claim
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 30 * HOUR;
        });

        let pending = client.claim(&user, &token, &registry);
        assert_eq!(pending, 30);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 30 * HOUR;
        });

        let pending2 = client.claim(&user, &token, &registry);
        assert_eq!(pending2, 30);
    }

    #[test]
    fn test_claim_not_started_fails() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        let result = client.try_claim(&user, &token, &registry);
        assert_eq!(result, Err(Ok(AccrualError::NotStarted)));
    }

    #[test]
    fn test_pending_points_uses_hourly_rate() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        // Basic bot = 1 pt/hr, elapsed=3600h → exactly 3600 points
        start_basic(&env, &client, &user);
        env.ledger().with_mut(|l| {
            l.timestamp += 3600 * HOUR;
        });
        assert_eq!(client.pending_points(&user), 3600);
    }

    #[test]
    fn test_accrual_state_read() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);
        // pending_points returns 0 at t=0 (no elapsed)
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_get_accrual_state_returns_none_before_start() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);

        assert!(client.get_accrual_state(&user).is_none());
    }

    #[test]
    fn test_get_accrual_state_returns_started_state() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.last_claim_ts, env.ledger().timestamp());
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 0);
        assert_eq!(state.rate, 1);
        assert_eq!(state.started_at, env.ledger().timestamp());
    }

    #[test]
    fn test_get_accrual_state_after_pending() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        // Advance time so pending_points > 0, but don't claim (avoids cross-contract auth)
        env.ledger().with_mut(|l| {
            l.timestamp += 7200 * HOUR;
        });

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 0);
        assert_eq!(state.last_claim_ts, env.ledger().timestamp() - 7200 * HOUR);
        assert_eq!(client.pending_points(&user), 7200);
    }

    #[test]
    fn test_get_accrual_state_multiple_users_independent() {
        let (env, _admin, _registry, _token, client) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        start_basic(&env, &client, &u1);
        start_basic(&env, &client, &u2);

        let s1 = client.get_accrual_state(&u1).unwrap();
        let s2 = client.get_accrual_state(&u2).unwrap();
        assert_eq!(s1.carry_points, 0);
        assert_eq!(s1.lifetime_points, 0);
        assert_eq!(s2.carry_points, 0);
        assert_eq!(s2.lifetime_points, 0);
        assert!(client.get_accrual_state(&Address::generate(&env)).is_none());
    }

    #[test]
    fn test_get_accrual_states_returns_one_entry_per_user_in_order() {
        let (env, _admin, _registry, _token, client) = setup();
        let started = Address::generate(&env);
        let unknown = Address::generate(&env);
        start_basic(&env, &client, &started);

        let users = soroban_sdk::vec![&env, unknown.clone(), started.clone()];
        let states = client.get_accrual_states(&users);

        assert_eq!(states.len(), 2);
        assert!(states.get(0).unwrap().is_none());
        assert!(states.get(1).unwrap().is_some());
    }

    #[test]
    fn test_get_accrual_states_rejects_more_than_the_cap() {
        let (env, _admin, _registry, _token, client) = setup();
        let mut users: Vec<Address> = Vec::new(&env);
        for _ in 0..(MAX_BATCH_USERS + 1) {
            users.push_back(Address::generate(&env));
        }
        assert_eq!(
            client.try_get_accrual_states(&users),
            Err(Ok(AccrualError::TooManyUsers))
        );
    }

    #[test]
    fn test_get_accrual_states_accepts_exactly_the_cap() {
        let (env, _admin, _registry, _token, client) = setup();
        let mut users: Vec<Address> = Vec::new(&env);
        for _ in 0..MAX_BATCH_USERS {
            users.push_back(Address::generate(&env));
        }
        assert_eq!(client.get_accrual_states(&users).len(), MAX_BATCH_USERS);
    }

    #[test]
    fn test_claim_with_zero_elapsed_returns_zero() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "zeroelapsed");
        start_basic(&env, &client, &user);
        let pending = client.claim(&user, &token, &registry);
        assert_eq!(pending, 0);
    }

    #[test]
    fn test_claim_after_claim_with_no_elapsed_returns_zero() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "noelapsed");
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|l| {
            l.timestamp += 100 * HOUR;
        });
        let _ = client.claim(&user, &token, &registry);
        let pending2 = client.claim(&user, &token, &registry);
        assert_eq!(pending2, 0);
    }

    #[test]
    fn test_claim_unregistered_user_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        let result = client.try_claim(&user, &_token, &_registry);
        assert_eq!(result, Err(Ok(AccrualError::NotStarted)));
    }

    #[test]
    fn test_start_accrual_without_bots_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        // Registration is checked before the bot rate (#415), so an
        // unregistered address without bots gets NotRegistered, not NoBots.
        let result = client.try_start_accrual(&user);
        assert_eq!(result, Err(Ok(AccrualError::NotRegistered)));
        assert!(client.get_accrual_state(&user).is_none());
    }

    #[test]
    fn test_start_accrual_registered_without_bots_fails_with_no_bots() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "nobotuser");
        // Registered but owns no bots: the error is NoBots, proving
        // NotRegistered and NoBots are distinguishable (#415).
        let result = client.try_start_accrual(&user);
        assert_eq!(result, Err(Ok(AccrualError::NoBots)));
        assert!(client.get_accrual_state(&user).is_none());
    }

    #[test]
    fn test_start_accrual_unregistered_with_bot_fails_then_succeeds_after_register() {
        let (env, _admin, registry, _token, bot_nft, client) = setup_with_bot_nft();
        let user = Address::generate(&env);
        // Give the user a bot so the rate check would pass; the failure must
        // still be NotRegistered because registration comes first (#415).
        bot_nft.mint_basic(&user);
        let result = client.try_start_accrual(&user);
        assert_eq!(result, Err(Ok(AccrualError::NotRegistered)));
        assert!(client.get_accrual_state(&user).is_none());
        // Registering then starting works.
        register_user(&env, &registry, &user, "latebloomer");
        client.start_accrual(&user);
        assert!(client.get_accrual_state(&user).is_some());
    }

    #[test]
    fn test_start_accrual_basic_bot_rate_is_one() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|l| l.timestamp += HOUR);
        assert_eq!(client.pending_points(&user), 1);
    }

    #[test]
    fn test_start_accrual_basic_plus_gold_rate() {
        let (env, _admin, registry, _token, bot_nft, client) = setup_with_bot_nft();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "goldrate");
        bot_nft.mint_basic(&user);
        let gold = bot_nft.get_bot(&bot_nft.admin_mint(&user, &BotTier::Gold));
        client.start_accrual(&user);

        // Basic (1) + Gold (100 plus a 0-5% rarity bonus) = 101..=106.
        let expected = 1 + gold.accrual_rate;
        assert!((101..=106).contains(&expected));
        env.ledger().with_mut(|l| l.timestamp += HOUR);
        assert_eq!(client.pending_points(&user), expected as u128);
    }

    #[test]
    fn test_pending_points_not_started_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        let result = client.try_pending_points(&user);
        assert_eq!(result, Err(Ok(AccrualError::NotStarted)));
    }

    #[test]
    fn test_pending_points_zero_elapsed() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_pending_points_correct_calculation() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        env.ledger().with_mut(|l| {
            l.timestamp += 1800 * HOUR;
        });

        assert_eq!(client.pending_points(&user), 1800);
    }

    #[test]
    fn test_config_returns_correct_values() {
        let (_env, _admin, _registry, _token, client) = setup();
        let config = client.config();
        assert_eq!(config.points_per_amt, 100);
    }

    #[test]
    fn test_config_fails_before_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let result = client.try_config();
        assert_eq!(result, Err(Ok(AccrualError::NotInitialized)));
    }

    #[test]
    fn test_claim_missing_config_fails_with_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        let registry = Address::generate(&env);
        // start_accrual needs an initialized contract, so seed the entry directly.
        env.as_contract(&id, || {
            env.storage().persistent().set(
                &DataKey::UserAccrual(user.clone()),
                &UserAccrual {
                    user: user.clone(),
                    rate: 1,
                    last_claim_ts: 0,
                    carry_points: 0,
                    lifetime_points: 0,
                    started_at: 0,
                },
            );
        });
        let result = client.try_claim(&user, &token, &registry);
        assert_eq!(result, Err(Ok(AccrualError::NotInitialized)));
    }

    #[test]
    fn test_config_persists_across_calls() {
        let (_env, _admin, _registry, _token, client) = setup();
        let c1 = client.config();
        let c2 = client.config();
        assert_eq!(c1.points_per_amt, c2.points_per_amt);
    }

    #[test]
    fn test_claim_updates_registry_total_points_and_claimed_amt() {
        let (env, _admin, registry, token, accrual) = setup();
        let user = Address::generate(&env);
        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry);

        // Register user in registry
        register_user(&env, &registry, &user, "claimtest");

        // Start accrual with a Basic bot: 1 point per hour
        start_basic(&env, &accrual, &user);

        // Advance time by 3600 hours → pending = 3600 points
        // With points_per_amt=100: amt_to_mint = 3600/100 = 36, remaining = 0
        env.ledger().with_mut(|l| {
            l.timestamp += 3600 * HOUR;
            l.sequence_number += 1;
        });

        let pending = accrual.claim(&user, &token, &registry);
        assert_eq!(pending, 3600);

        // Verify registry state updated via cross-contract calls
        let profile = reg_client.get_user(&user);
        assert_eq!(profile.total_points, 3600);
        assert_eq!(profile.claimed_amt, 36);
    }

    #[test]
    fn test_claim_below_threshold_updates_registry_points_only() {
        let (env, _admin, registry, token, accrual) = setup();
        let user = Address::generate(&env);
        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry);

        register_user(&env, &registry, &user, "belowthresh");

        // Basic bot → 1 pt/hr, advance 50h → 50 points < 100 threshold
        start_basic(&env, &accrual, &user);

        env.ledger().with_mut(|l| {
            l.timestamp += 50 * HOUR;
            l.sequence_number += 1;
        });

        let pending = accrual.claim(&user, &token, &registry);
        assert_eq!(pending, 50);

        let profile = reg_client.get_user(&user);
        // Points added to registry even when below mint threshold
        assert_eq!(profile.total_points, 50);
        // No tokens minted, so claimed_amt stays 0
        assert_eq!(profile.claimed_amt, 0);
    }

    #[test]
    fn test_claim_twice_accumulates_registry_state() {
        let (env, _admin, registry, token, accrual) = setup();
        let user = Address::generate(&env);
        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry);

        register_user(&env, &registry, &user, "twice");

        // Basic bot → 1 pt/hr
        start_basic(&env, &accrual, &user);

        // First claim: 80 hours → 80 points (below threshold, no mint)
        env.ledger().with_mut(|l| {
            l.timestamp += 80 * HOUR;
            l.sequence_number += 1;
        });
        let pending1 = accrual.claim(&user, &token, &registry);
        assert_eq!(pending1, 80);

        // Second claim: 120 more hours → 120 points
        // Carry-forward from first claim: 80 % 100 = 80
        // updated_points = 80 + 120 = 200 → amt_to_mint = 200/100 = 2, remaining = 0
        env.ledger().with_mut(|l| {
            l.timestamp += 120 * HOUR;
            l.sequence_number += 1;
        });
        let pending2 = accrual.claim(&user, &token, &registry);
        assert_eq!(pending2, 120);

        let profile = reg_client.get_user(&user);
        // total_points accumulates both claims: 80 + 120 = 200
        assert_eq!(profile.total_points, 200);
        // Only the second claim crosses the threshold: 200/100 = 2
        assert_eq!(profile.claimed_amt, 2);
    }

    // --- Issue #417: the mint path (total >= points_per_amt) had zero
    // coverage because every claim test stayed below the threshold.
    // `deploy_all` wires the accrual contract as the token admin (mirroring
    // `scripts/deploy.sh#wire_token_admin`), so these claims mint for real.
    // Mint amounts are raw AMT units (`pending / points_per_amt`, AM-093).

    #[test]
    fn test_claim_exactly_at_threshold_mints_one() {
        use automint_token::AMTTokenClient;
        let (env, _admin, registry, token, accrual) = setup();
        let token_client = AMTTokenClient::new(&env, &token);
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "exactthresh");
        // Basic bot → 1 pt/hr; 100h → exactly 100 points = points_per_amt.
        start_basic(&env, &accrual, &user);
        env.ledger().with_mut(|l| {
            l.timestamp += 100 * HOUR;
            l.sequence_number += 1;
        });

        let pending = accrual.claim(&user, &token, &registry);
        assert_eq!(pending, 100);
        // 100 / 100 = 1 AMT minted, carry fully consumed.
        assert_eq!(token_client.balance(&user), 1);
        let state = accrual.get_accrual_state(&user).unwrap();
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 100);
    }

    #[test]
    fn test_claim_just_over_threshold_mints_one_with_carry() {
        use automint_token::AMTTokenClient;
        let (env, _admin, registry, token, accrual) = setup();
        let token_client = AMTTokenClient::new(&env, &token);
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "justover");
        // 101h → 101 points: 1 AMT minted, 1 point carried.
        start_basic(&env, &accrual, &user);
        env.ledger().with_mut(|l| {
            l.timestamp += 101 * HOUR;
            l.sequence_number += 1;
        });

        let pending = accrual.claim(&user, &token, &registry);
        assert_eq!(pending, 101);
        assert_eq!(token_client.balance(&user), 1);
        let state = accrual.get_accrual_state(&user).unwrap();
        assert_eq!(state.carry_points, 1);
        assert_eq!(state.lifetime_points, 101);
    }

    #[test]
    fn test_claim_several_multiples_mints_multiple() {
        use automint_token::AMTTokenClient;
        let (env, _admin, registry, token, accrual) = setup();
        let token_client = AMTTokenClient::new(&env, &token);
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "multiples");
        // 350h → 350 points: 3 AMT minted, 50 carried.
        start_basic(&env, &accrual, &user);
        env.ledger().with_mut(|l| {
            l.timestamp += 350 * HOUR;
            l.sequence_number += 1;
        });

        let pending = accrual.claim(&user, &token, &registry);
        assert_eq!(pending, 350);
        assert_eq!(token_client.balance(&user), 3);
        let state = accrual.get_accrual_state(&user).unwrap();
        assert_eq!(state.carry_points, 50);
        assert_eq!(state.lifetime_points, 350);
        let profile =
            automint_registry::RegistryContractClient::new(&env, &registry).get_user(&user);
        assert_eq!(profile.claimed_amt, 3);
    }

    #[test]
    fn test_claim_carry_pushes_next_claim_over_threshold() {
        use automint_token::AMTTokenClient;
        let (env, _admin, registry, token, accrual) = setup();
        let token_client = AMTTokenClient::new(&env, &token);
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "carryover");
        start_basic(&env, &accrual, &user);

        // First claim: 80h → 80 points, below threshold: no mint, carry 80.
        env.ledger().with_mut(|l| {
            l.timestamp += 80 * HOUR;
            l.sequence_number += 1;
        });
        assert_eq!(accrual.claim(&user, &token, &registry), 80);
        assert_eq!(token_client.balance(&user), 0);
        assert_eq!(accrual.get_accrual_state(&user).unwrap().carry_points, 80);

        // Second claim: 30h → 30 pending; 80 carry + 30 = 110 → 1 AMT, carry 10.
        env.ledger().with_mut(|l| {
            l.timestamp += 30 * HOUR;
            l.sequence_number += 1;
        });
        assert_eq!(accrual.claim(&user, &token, &registry), 30);
        assert_eq!(token_client.balance(&user), 1);
        let state = accrual.get_accrual_state(&user).unwrap();
        assert_eq!(state.carry_points, 10);
        assert_eq!(state.lifetime_points, 110);
    }

    // --- Issue #544: storage TTL / archival coverage ---
    //
    // UserAccrual is persistent storage bumped via
    // `extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP)` on `start_accrual` and
    // `claim`. These tests simulate ledger advancement with
    // `automint_testutils::advance_ledger` to exercise that TTL/archival
    // behaviour directly.

    // Control case: accrual state started well within the TTL window is
    // still readable.
    #[test]
    fn test_accrual_state_survives_before_ttl_expiry() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP / 2);

        let state = client.get_accrual_state(&user);
        assert!(state.is_some());
    }

    // An accrual entry whose TTL is never refreshed becomes archived once
    // the ledger sequence passes its live_until_ledger_seq. As with the
    // other contracts, the whole contract instance shares the same TTL
    // bump window here, so accessing anything past that point is rejected
    // with a hard panic caught via `catch_unwind`.
    #[test]
    fn test_accrual_state_archived_after_ttl_expiry() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        start_basic(&env, &client, &user);

        automint_testutils::advance_past_ttl(&env, LEDGER_BUMP);

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.get_accrual_state(&user)
        }));
        assert!(outcome.is_err(), "expected archived entry access to fail");
    }

    // #544 fix verification: `claim` now also renews the contract
    // instance's TTL (previously only `initialize` did). Advancing to just
    // before the original expiry, claiming (which renews both the
    // UserAccrual entry's TTL and the instance's), then advancing well past
    // the original expiry ledger must still leave the accrual state
    // readable.
    //
    // Verified manually that this test exercises the renewal (not just Env
    // defaults) by temporarily removing the two `extend_ttl` calls at the
    // end of `claim`: with them removed, this test fails with an
    // archived-entry panic at the final `get_accrual_state` call.
    #[test]
    fn test_claim_extends_ttl_restores_access_near_expiry() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "ttluser");
        start_basic(&env, &client, &user);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP - 1);
        client.claim(&user, &token, &registry);

        automint_testutils::advance_ledger(&env, LEDGER_BUMP);

        let state = client.get_accrual_state(&user);
        assert!(state.is_some());
    }

    #[test]
    fn test_claim_unregistered_user_returns_registry_call_failed() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        // `start_accrual` now rejects unregistered users up front (#415), so
        // seed the accrual record directly to still cover the claim-time
        // registry failure for a record whose user has no registry profile.
        env.as_contract(&client.address, || {
            env.storage().persistent().set(
                &DataKey::UserAccrual(user.clone()),
                &UserAccrual {
                    user: user.clone(),
                    rate: 1,
                    last_claim_ts: env.ledger().timestamp(),
                    carry_points: 0,
                    lifetime_points: 0,
                    started_at: env.ledger().timestamp(),
                },
            );
        });
        env.ledger().with_mut(|l| {
            l.timestamp += 100 * HOUR;
        });

        let result = client.try_claim(&user, &token, &registry);
        assert_eq!(result, Err(Ok(AccrualError::RegistryCallFailed)));
    }

    #[test]
    fn test_three_claims_lifetime_and_carry_points() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "threeclaims");
        // Basic bot → 1 point per hour
        start_basic(&env, &client, &user);

        // Claim 1: 100 hours → 100 points. (100 / 100 = 1 AMT, carry = 0, lifetime = 100)
        env.ledger().with_mut(|l| l.timestamp += 100 * HOUR);
        let _ = client.claim(&user, &token, &registry);

        // Claim 2: 100 hours → 100 points. (100 / 100 = 1 AMT, carry = 0, lifetime = 200)
        env.ledger().with_mut(|l| l.timestamp += 100 * HOUR);
        let _ = client.claim(&user, &token, &registry);

        // Claim 3: 50 hours → 50 points. (50 / 100 = 0 AMT, carry = 50, lifetime = 250)
        env.ledger().with_mut(|l| l.timestamp += 50 * HOUR);
        let _ = client.claim(&user, &token, &registry);

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.lifetime_points, 250);
        assert_eq!(state.carry_points, 50);
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
        client: AccrualContractClient<'static>,
        registry_id: Address,
        token_id: Address,
        bot_nft_id: Address,
    }

    fn mint_basic(ctx: &Ctx, user: &Address) {
        ctx.env.mock_all_auths();
        automint_bot_nft::BotNFTContractClient::new(&ctx.env, &ctx.bot_nft_id).mint_basic(user);
    }

    fn setup() -> Ctx {
        let env = Env::default();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let registry_id = env.register_contract(None, automint_registry::RegistryContract);
        let reg_client = automint_registry::RegistryContractClient::new(&env, &registry_id);
        let token_id = env.register_contract(None, automint_token::AMTToken);
        let token_client = automint_token::AMTTokenClient::new(&env, &token_id);
        let bot_nft_id = env.register_contract(None, automint_bot_nft::BotNFTContract);
        let bot_nft = automint_bot_nft::BotNFTContractClient::new(&env, &bot_nft_id);

        env.mock_all_auths();
        reg_client.initialize(&admin);
        token_client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );
        bot_nft.initialize(&admin, &registry_id);
        client.initialize(&admin, &bot_nft_id, &registry_id, &100_u64);

        Ctx {
            env,
            id,
            client,
            registry_id,
            token_id,
            bot_nft_id,
        }
    }

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let bot_nft = Address::generate(&env);
        let registry = Address::generate(&env);

        let result = client.try_initialize(&admin, &bot_nft, &registry, &100_u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let bot_nft = Address::generate(&env);
        let registry = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), bot_nft.clone(), registry.clone(), 100_u64)
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_initialize(&admin, &bot_nft, &registry, &100_u64);
        assert!(result.is_ok());
    }

    fn register(ctx: &Ctx, user: &Address) {
        ctx.env.mock_all_auths();
        automint_registry::RegistryContractClient::new(&ctx.env, &ctx.registry_id)
            .register(user, &String::from_str(&ctx.env, "authuser"));
    }

    #[test]
    fn test_start_accrual_fails_without_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);
        register(&ctx, &user);
        mint_basic(&ctx, &user);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_start_accrual(&user);
        assert!(result.is_err());
    }

    #[test]
    fn test_start_accrual_succeeds_with_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);
        register(&ctx, &user);
        mint_basic(&ctx, &user);

        ctx.env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "start_accrual",
                args: (user.clone(),).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_start_accrual(&user);
        assert!(result.is_ok());
    }

    #[test]
    fn test_claim_fails_without_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);
        register(&ctx, &user);
        mint_basic(&ctx, &user);
        ctx.env.mock_all_auths();
        ctx.client.start_accrual(&user);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_claim(&user, &ctx.token_id, &ctx.registry_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_claim_succeeds_with_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        let registry = automint_registry::RegistryContractClient::new(&ctx.env, &ctx.registry_id);
        registry.register(&user, &String::from_str(&ctx.env, "claim-auth"));
        mint_basic(&ctx, &user);
        ctx.client.start_accrual(&user);

        ctx.env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "claim",
                args: (user.clone(), ctx.token_id.clone(), ctx.registry_id.clone())
                    .into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_claim(&user, &ctx.token_id, &ctx.registry_id);
        assert!(result.is_ok());
    }
}
