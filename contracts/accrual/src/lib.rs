// SPDX-License-Identifier: Apache-2.0

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

#[derive(Clone)]
#[contracttype]
pub struct AccrualState {
    pub last_claim_ts: u64,
    pub carry_points: u64,
    pub lifetime_points: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Config,
    Admin,
    Initialized,
    UserAccrual(Address),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Config {
    pub points_per_amt: u64,
}

fn read_accrual_state(env: &Env, user: &Address) -> Option<AccrualState> {
    env.storage()
        .persistent()
        .get::<_, UserAccrual>(&DataKey::UserAccrual(user.clone()))
        .map(|a| AccrualState {
            last_claim_ts: a.last_claim_ts,
            carry_points: a.carry_points,
            lifetime_points: a.lifetime_points,
        })
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
    pub fn initialize(env: Env, admin: Address, points_per_amt: u64) -> Result<(), AccrualError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(AccrualError::AlreadyInitialized);
        }

        if points_per_amt == 0 {
            return Err(AccrualError::InvalidConfig);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);

        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { points_per_amt });

        env.storage().instance().set(&DataKey::Initialized, &true);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        Ok(())
    }

    pub fn start_accrual(env: Env, user: Address, rate: u64) -> Result<(), AccrualError> {
        user.require_auth();
        if env
            .storage()
            .persistent()
            .has(&DataKey::UserAccrual(user.clone()))
        {
            return Err(AccrualError::AlreadyStarted);
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

    pub fn get_accrual_state(env: Env, user: Address) -> Option<AccrualState> {
        read_accrual_state(&env, &user)
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
    use automint_testutils::{deploy_all, register_user};
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Env};

    fn setup() -> (
        Env,
        Address,
        Address,
        Address,
        AccrualContractClient<'static>,
    ) {
        let deployment = deploy_all(Env::default());
        let client = AccrualContractClient::new(&deployment.env, &deployment.accrual_id);
        (
            deployment.env,
            deployment.admin,
            deployment.registry_id,
            deployment.token_id,
            client,
        )
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
        let result = client.try_initialize(&_admin, &100_u64);
        assert_eq!(result, Err(Ok(AccrualError::AlreadyInitialized)));
    }

    #[test]
    fn test_initialize_zero_points_per_amt_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let result = client.try_initialize(&admin, &0_u64);
        assert_eq!(result, Err(Ok(AccrualError::InvalidConfig)));
    }

    #[test]
    fn test_start_accrual() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &50_u64);
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_start_accrual_initializes_correctly() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        let start_ts = env.ledger().timestamp();

        let result = client.try_start_accrual(&user, &50_u64);
        assert!(result.is_ok());

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.last_claim_ts, start_ts);
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 0);
    }

    #[test]
    fn test_double_start_accrual_fails() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &50_u64);
        let result = client.try_start_accrual(&user, &50_u64);
        assert_eq!(result, Err(Ok(AccrualError::AlreadyStarted)));
    }

    #[test]
    fn test_pending_points_calculation() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &100_u64);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 100;
            ledger.timestamp += 500;
        });

        let pending = client.pending_points(&user);
        assert!(pending > 0);
    }

    #[test]
    fn test_claim_resets_timestamp() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        // Use low rate so total_points < points_per_amt (no mint triggered)
        client.start_accrual(&user, &1_u64);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 50;
        });

        let _pending = client.claim(&user, &token, &registry);
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_claim_below_threshold_mints_nothing() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        // rate=3600 means 1 point per second, so 50s = 50 points < 100 threshold
        client.start_accrual(&user, &3600_u64);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 50;
        });

        let pending = client.claim(&user, &token, &registry);
        assert_eq!(pending, 50);
    }

    #[test]
    fn test_claim_accumulates_total_claimed() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        // rate=3600 means 1 point per second, stays below 100 threshold per claim
        client.start_accrual(&user, &3600_u64);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 30;
        });

        let pending = client.claim(&user, &token, &registry);
        assert_eq!(pending, 30);

        env.ledger().with_mut(|ledger| {
            ledger.sequence_number += 10;
            ledger.timestamp += 30;
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
        // rate=3600 pts/hr, elapsed=3600s → exactly 3600 points
        client.start_accrual(&user, &3600_u64);
        env.ledger().with_mut(|l| {
            l.timestamp += 3600;
        });
        assert_eq!(client.pending_points(&user), 3600);
    }

    #[test]
    fn test_accrual_state_read() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &100_u64);
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
        client.start_accrual(&user, &100_u64);

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.last_claim_ts, env.ledger().timestamp());
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 0);
    }

    #[test]
    fn test_get_accrual_state_after_pending() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &3600_u64);

        // Advance time so pending_points > 0, but don't claim (avoids cross-contract auth)
        env.ledger().with_mut(|l| {
            l.timestamp += 7200;
        });

        let state = client.get_accrual_state(&user).unwrap();
        assert_eq!(state.carry_points, 0);
        assert_eq!(state.lifetime_points, 0);
        assert_eq!(state.last_claim_ts, env.ledger().timestamp() - 7200);
        assert_eq!(client.pending_points(&user), 7200);
    }

    #[test]
    fn test_get_accrual_state_multiple_users_independent() {
        let (env, _admin, _registry, _token, client) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        client.start_accrual(&u1, &100_u64);
        client.start_accrual(&u2, &200_u64);

        let s1 = client.get_accrual_state(&u1).unwrap();
        let s2 = client.get_accrual_state(&u2).unwrap();
        assert_eq!(s1.carry_points, 0);
        assert_eq!(s1.lifetime_points, 0);
        assert_eq!(s2.carry_points, 0);
        assert_eq!(s2.lifetime_points, 0);
        assert!(client.get_accrual_state(&Address::generate(&env)).is_none());
    }

    #[test]
    fn test_claim_with_zero_elapsed_returns_zero() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "zeroelapsed");
        client.start_accrual(&user, &100_u64);
        let pending = client.claim(&user, &token, &registry);
        assert_eq!(pending, 0);
    }

    #[test]
    fn test_claim_after_claim_with_no_elapsed_returns_zero() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "noelapsed");
        client.start_accrual(&user, &100_u64);

        env.ledger().with_mut(|l| {
            l.timestamp += 100;
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
    fn test_start_accrual_with_zero_rate() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &0_u64);

        env.ledger().with_mut(|l| {
            l.timestamp += 3600;
        });
        assert_eq!(client.pending_points(&user), 0);
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
        client.start_accrual(&user, &100_u64);
        assert_eq!(client.pending_points(&user), 0);
    }

    #[test]
    fn test_pending_points_correct_calculation() {
        let (env, _admin, _registry, _token, client) = setup();
        let user = Address::generate(&env);
        client.start_accrual(&user, &3600_u64);

        env.ledger().with_mut(|l| {
            l.timestamp += 1800;
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
        client.start_accrual(&user, &100_u64);
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

        // Start accrual: rate=3600 pts/hr → 1 point per second
        accrual.start_accrual(&user, &3600_u64);

        // Advance time by 3600 seconds → pending = 3600 points
        // With points_per_amt=100: amt_to_mint = 3600/100 = 36, remaining = 0
        env.ledger().with_mut(|l| {
            l.timestamp += 3600;
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

        // rate=3600 → 1 pt/sec, advance 50s → 50 points < 100 threshold
        accrual.start_accrual(&user, &3600_u64);

        env.ledger().with_mut(|l| {
            l.timestamp += 50;
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

        // rate=3600 → 1 pt/sec
        accrual.start_accrual(&user, &3600_u64);

        // First claim: 80 seconds → 80 points (below threshold, no mint)
        env.ledger().with_mut(|l| {
            l.timestamp += 80;
            l.sequence_number += 1;
        });
        let pending1 = accrual.claim(&user, &token, &registry);
        assert_eq!(pending1, 80);

        // Second claim: 120 more seconds → 120 points
        // Carry-forward from first claim: 80 % 100 = 80
        // updated_points = 80 + 120 = 200 → amt_to_mint = 200/100 = 2, remaining = 0
        env.ledger().with_mut(|l| {
            l.timestamp += 120;
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
        client.start_accrual(&user, &50_u64);

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
        client.start_accrual(&user, &50_u64);

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
        // Rate 0 keeps pending points (and therefore amt_to_mint) at zero
        // for the whole test, so `claim` never needs to cross-call the
        // token contract's `mint` — that path requires nested admin auth
        // that this test harness's `mock_all_auths()` doesn't satisfy for
        // non-root invocations, which is an unrelated pre-existing gap
        // (also hit by test_claim_twice_accumulates_registry_state and
        // test_claim_updates_registry_total_points_and_claimed_amt). Using
        // rate 0 isolates the TTL-renewal behaviour this test targets from
        // that unrelated issue.
        client.start_accrual(&user, &0_u64);

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
        // User starts accrual but is NOT registered in registry
        client.start_accrual(&user, &3600_u64);
        env.ledger().with_mut(|l| {
            l.timestamp += 100;
        });

        let result = client.try_claim(&user, &token, &registry);
        assert_eq!(result, Err(Ok(AccrualError::RegistryCallFailed)));
    }

    #[test]
    fn test_three_claims_lifetime_and_carry_points() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "threeclaims");
        // rate=3600 → 1 point per second
        client.start_accrual(&user, &3600_u64);

        // Claim 1: 100 seconds → 100 points. (100 / 100 = 1 AMT, carry = 0, lifetime = 100)
        env.ledger().with_mut(|l| l.timestamp += 100);
        let _ = client.claim(&user, &token, &registry);

        // Claim 2: 100 seconds → 100 points. (100 / 100 = 1 AMT, carry = 0, lifetime = 200)
        env.ledger().with_mut(|l| l.timestamp += 100);
        let _ = client.claim(&user, &token, &registry);

        // Claim 3: 50 seconds → 50 points. (50 / 100 = 0 AMT, carry = 50, lifetime = 250)
        env.ledger().with_mut(|l| l.timestamp += 50);
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

        env.mock_all_auths();
        reg_client.initialize(&admin);
        token_client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AutoMint Token"),
            &String::from_str(&env, "AMT"),
        );
        client.initialize(&admin, &100_u64);

        Ctx {
            env,
            id,
            client,
            registry_id,
            token_id,
        }
    }

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        let result = client.try_initialize(&admin, &100_u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let env = Env::default();
        let id = env.register_contract(None, AccrualContract);
        let client = AccrualContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), 100_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_initialize(&admin, &100_u64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_start_accrual_fails_without_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[]);
        let result = ctx.client.try_start_accrual(&user, &5_u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_start_accrual_succeeds_with_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);

        ctx.env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &ctx.id,
                fn_name: "start_accrual",
                args: (user.clone(), 5_u64).into_val(&ctx.env),
                sub_invokes: &[],
            },
        }]);
        let result = ctx.client.try_start_accrual(&user, &5_u64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_claim_fails_without_user_auth() {
        let ctx = setup();
        let user = Address::generate(&ctx.env);
        ctx.env.mock_all_auths();
        ctx.client.start_accrual(&user, &5_u64);

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
        ctx.client.start_accrual(&user, &5_u64);

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
