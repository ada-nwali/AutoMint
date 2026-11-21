#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, IntoVal, Symbol, Val, Vec,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    AccrualState(Address),
    Config,
    Initialized,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct AccrualState {
    pub last_claim_ts: u64,
    pub total_claimed_points: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct Config {
    pub registry: Address,
    pub bot_nft: Address,
    pub token: Address,
    pub admin: Address,
    pub points_per_amt: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AccrualError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    UserNotStarted = 4,
    NothingToClaim = 5,
    RegistryError = 6,
    TokenError = 7,
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;
const POINTS_PER_AMT: u64 = 100;

fn call_get_total_rate(env: &Env, bot_nft: &Address, owner: &Address) -> u64 {
    let args: Vec<Val> = soroban_sdk::vec![env, owner.into_val(env)];
    env.invoke_contract(bot_nft, &Symbol::new(env, "get_user_total_rate"), args)
}

fn call_add_points(env: &Env, registry: &Address, user: &Address, points: u64) {
    let args: Vec<Val> = soroban_sdk::vec![env, user.into_val(env), points.into_val(env)];
    let _: () = env.invoke_contract(registry, &Symbol::new(env, "add_points"), args);
}

fn call_token_mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    let args: Vec<Val> = soroban_sdk::vec![env, to.into_val(env), amount.into_val(env)];
    let _: () = env.invoke_contract(token, &Symbol::new(env, "mint"), args);
}

fn call_add_claimed_amt(env: &Env, registry: &Address, user: &Address, amount: i128) {
    let args: Vec<Val> = soroban_sdk::vec![env, user.into_val(env), amount.into_val(env)];
    let _: () = env.invoke_contract(registry, &Symbol::new(env, "add_claimed_amt"), args);
}

#[contract]
pub struct AccrualContract;

#[contractimpl]
impl AccrualContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        registry: Address,
        bot_nft: Address,
        token: Address,
    ) -> Result<(), AccrualError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(AccrualError::AlreadyInitialized);
        }
        admin.require_auth();
        let config = Config { registry, bot_nft, token, admin, points_per_amt: POINTS_PER_AMT };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    // Idempotent: safe to call again if already started
    pub fn start_accrual(env: Env, user: Address) -> Result<(), AccrualError> {
        user.require_auth();
        if env.storage().persistent().has(&DataKey::AccrualState(user.clone())) {
            return Ok(());
        }
        let state = AccrualState {
            last_claim_ts: env.ledger().timestamp(),
            total_claimed_points: 0,
        };
        env.storage().persistent().set(&DataKey::AccrualState(user.clone()), &state);
        env.storage().persistent().extend_ttl(
            &DataKey::AccrualState(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Ok(())
    }

    pub fn pending_points(env: Env, user: Address) -> u64 {
        let state: AccrualState = match env
            .storage()
            .persistent()
            .get(&DataKey::AccrualState(user.clone()))
        {
            Some(s) => s,
            None => return 0,
        };
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        let rate = call_get_total_rate(&env, &config.bot_nft, &user);
        Self::calc_pending(&env, &state, rate)
    }

    pub fn claim(env: Env, user: Address) -> Result<u64, AccrualError> {
        user.require_auth();
        let mut state: AccrualState = env
            .storage()
            .persistent()
            .get(&DataKey::AccrualState(user.clone()))
            .ok_or(AccrualError::UserNotStarted)?;
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(AccrualError::NotInitialized)?;
        let rate = call_get_total_rate(&env, &config.bot_nft, &user);
        let points = Self::calc_pending(&env, &state, rate);
        if points == 0 {
            return Err(AccrualError::NothingToClaim);
        }
        state.last_claim_ts = env.ledger().timestamp();
        state.total_claimed_points = state.total_claimed_points.saturating_add(points);
        env.storage().persistent().set(&DataKey::AccrualState(user.clone()), &state);
        env.storage().persistent().extend_ttl(
            &DataKey::AccrualState(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        call_add_points(&env, &config.registry, &user, points);
        let amt_amount = (points / config.points_per_amt) as i128;
        if amt_amount > 0 {
            call_token_mint(&env, &config.token, &user, amt_amount);
            call_add_claimed_amt(&env, &config.registry, &user, amt_amount);
        }
        env.events().publish(
            (symbol_short!("claim"), user.clone()),
            (points, amt_amount),
        );
        Ok(points)
    }

    pub fn get_accrual_state(env: Env, user: Address) -> Option<AccrualState> {
        env.storage().persistent().get(&DataKey::AccrualState(user))
    }

    pub fn seconds_to_next_amt(env: Env, user: Address) -> u64 {
        let state: AccrualState = match env
            .storage()
            .persistent()
            .get(&DataKey::AccrualState(user.clone()))
        {
            Some(s) => s,
            None => return 0,
        };
        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(c) => c,
            None => return 0,
        };
        let rate = call_get_total_rate(&env, &config.bot_nft, &user);
        if rate == 0 {
            return u64::MAX;
        }
        let points_left = config
            .points_per_amt
            .saturating_sub(state.total_claimed_points % config.points_per_amt);
        let points_left = if points_left == 0 { config.points_per_amt } else { points_left };
        points_left
            .saturating_mul(3600)
            .saturating_add(rate.saturating_sub(1))
            .saturating_div(rate)
    }

    pub fn config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn calc_pending(env: &Env, state: &AccrualState, rate_per_hour: u64) -> u64 {
        let now = env.ledger().timestamp();
        if now <= state.last_claim_ts {
            return 0;
        }
        let elapsed = now - state.last_claim_ts;
        elapsed.saturating_mul(rate_per_hour).saturating_div(3600)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use automint_bot_nft::{BotNFTContract, BotNFTContractClient};
    use automint_registry::{RegistryContract, RegistryContractClient};
    use automint_token::{AMTToken, AMTTokenClient};
    use soroban_sdk::{testutils::{Address as _, Ledger}, Env, String};

    fn deploy_all(env: &Env) -> (
        Address,
        RegistryContractClient<'static>,
        BotNFTContractClient<'static>,
        AMTTokenClient<'static>,
        AccrualContractClient<'static>,
    ) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let reg_id = env.register_contract(None, RegistryContract);
        let bot_id = env.register_contract(None, BotNFTContract);
        let tok_id = env.register_contract(None, AMTToken);
        let acc_id = env.register_contract(None, AccrualContract);
        let reg = RegistryContractClient::new(env, &reg_id);
        let bot = BotNFTContractClient::new(env, &bot_id);
        let tok = AMTTokenClient::new(env, &tok_id);
        let acc = AccrualContractClient::new(env, &acc_id);
        reg.initialize(&admin);
        bot.initialize(&admin);
        tok.initialize(
            &admin,
            &7u32,
            &String::from_str(env, "AutoMint Token"),
            &String::from_str(env, "AMT"),
        );
        tok.set_admin(&acc_id);
        acc.initialize(&admin, &reg_id, &bot_id, &tok_id);
        (admin, reg, bot, tok, acc)
    }

    #[test]
    fn test_start_and_pending_after_one_hour() {
        let env = Env::default();
        let (_, reg, bot, _, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });
        reg.register(&user, &String::from_str(&env, "Tester"));
        bot.mint_basic(&user);
        acc.start_accrual(&user);
        env.ledger().with_mut(|l| { l.timestamp = 1_003_600; });
        // Basic: 1 pt/hr
        assert_eq!(acc.pending_points(&user), 1);
    }

    #[test]
    fn test_claim_and_amt_mint() {
        let env = Env::default();
        let (_, reg, bot, tok, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        env.ledger().with_mut(|l| { l.timestamp = 0; });
        reg.register(&user, &String::from_str(&env, "Claimer"));
        bot.mint_tier(&user, &automint_bot_nft::BotTier::Gold);
        acc.start_accrual(&user);
        // 2 hours → 200 pts → 2 AMT
        env.ledger().with_mut(|l| { l.timestamp = 7200; });
        let claimed = acc.claim(&user);
        assert_eq!(claimed, 200);
        assert_eq!(tok.balance(&user), 2_i128);
        assert_eq!(reg.get_user(&user).total_points, 200);
    }

    #[test]
    fn test_multiple_bots_accrual() {
        let env = Env::default();
        let (_, reg, bot, _, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        env.ledger().with_mut(|l| { l.timestamp = 0; });
        reg.register(&user, &String::from_str(&env, "Multi"));
        bot.mint_basic(&user);
        bot.mint_tier(&user, &automint_bot_nft::BotTier::Silver);
        acc.start_accrual(&user);
        env.ledger().with_mut(|l| { l.timestamp = 3600; });
        // 1 + 25 = 26 pts/hr
        assert_eq!(acc.pending_points(&user), 26);
    }

    #[test]
    fn test_claim_resets_timer() {
        let env = Env::default();
        let (_, reg, bot, _, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        env.ledger().with_mut(|l| { l.timestamp = 0; });
        reg.register(&user, &String::from_str(&env, "Resetter"));
        bot.mint_tier(&user, &automint_bot_nft::BotTier::Gold);
        acc.start_accrual(&user);
        env.ledger().with_mut(|l| { l.timestamp = 3600; });
        acc.claim(&user);
        // Pending should be 0 right after claim
        assert_eq!(acc.pending_points(&user), 0);
    }

    #[test]
    fn test_claim_before_start_fails() {
        let env = Env::default();
        let (_, _, _, _, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        assert!(acc.try_claim(&user).is_err());
    }

    #[test]
    fn test_start_accrual_idempotent() {
        let env = Env::default();
        let (_, reg, bot, _, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        env.ledger().with_mut(|l| { l.timestamp = 1000; });
        reg.register(&user, &String::from_str(&env, "Idm"));
        bot.mint_basic(&user);
        acc.start_accrual(&user);
        // Calling again should not change last_claim_ts
        let state1 = acc.get_accrual_state(&user).unwrap();
        env.ledger().with_mut(|l| { l.timestamp = 2000; });
        acc.start_accrual(&user);
        let state2 = acc.get_accrual_state(&user).unwrap();
        assert_eq!(state1.last_claim_ts, state2.last_claim_ts);
    }

    #[test]
    fn test_no_amt_minted_below_threshold() {
        let env = Env::default();
        let (_, reg, bot, tok, acc) = deploy_all(&env);
        let user = Address::generate(&env);
        env.ledger().with_mut(|l| { l.timestamp = 0; });
        reg.register(&user, &String::from_str(&env, "Low"));
        bot.mint_basic(&user); // 1 pt/hr
        acc.start_accrual(&user);
        // Only 30 min — 0 pts (truncated)
        env.ledger().with_mut(|l| { l.timestamp = 1800; });
        // pending = 0 (1 * 1800 / 3600 = 0 due to integer division)
        assert_eq!(acc.pending_points(&user), 0);
        // Claim fails with NothingToClaim
        assert!(acc.try_claim(&user).is_err());
        assert_eq!(tok.balance(&user), 0);
    }
}
