#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, String, Vec,
};

pub const RATE_BASIC: u64 = 1;
pub const RATE_BRONZE: u64 = 5;
pub const RATE_SILVER: u64 = 25;
pub const RATE_GOLD: u64 = 100;
pub const RATE_DIAMOND: u64 = 500;

pub const PRICE_BRONZE: i128 = 100_0000000;
pub const PRICE_SILVER: i128 = 500_0000000;
pub const PRICE_GOLD: i128 = 2000_0000000;
pub const PRICE_DIAMOND: i128 = 10000_0000000;

#[derive(Clone, Copy, Debug, PartialEq)]
#[contracttype]
#[repr(u32)]
pub enum BotTier {
    Basic = 0,
    Bronze = 1,
    Silver = 2,
    Gold = 3,
    Diamond = 4,
}

impl BotTier {
    pub fn rate(&self) -> u64 {
        match self {
            BotTier::Basic => RATE_BASIC,
            BotTier::Bronze => RATE_BRONZE,
            BotTier::Silver => RATE_SILVER,
            BotTier::Gold => RATE_GOLD,
            BotTier::Diamond => RATE_DIAMOND,
        }
    }

    pub fn price(&self) -> i128 {
        match self {
            BotTier::Basic => 0,
            BotTier::Bronze => PRICE_BRONZE,
            BotTier::Silver => PRICE_SILVER,
            BotTier::Gold => PRICE_GOLD,
            BotTier::Diamond => PRICE_DIAMOND,
        }
    }

    pub fn name(&self, env: &Env) -> String {
        match self {
            BotTier::Basic => String::from_str(env, "Basic Bot"),
            BotTier::Bronze => String::from_str(env, "Bronze Bot"),
            BotTier::Silver => String::from_str(env, "Silver Bot"),
            BotTier::Gold => String::from_str(env, "Gold Bot"),
            BotTier::Diamond => String::from_str(env, "Diamond Bot"),
        }
    }
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Bot(u64),
    UserBots(Address),
    NextBotId,
    /// Number of bots minted and currently tracked by this contract.
    Supply,
    Admin,
    Initialized,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct BotNFT {
    pub id: u64,
    pub tier: BotTier,
    pub owner: Address,
    pub accrual_rate: u64,
    pub minted_at: u64,
    pub name: String,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum BotNFTError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    BotNotFound = 4,
    NotOwner = 5,
    InvalidTier = 6,
    MaxBotsReached = 7,
    InvalidName = 8,
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;
const MAX_BOTS_PER_USER: u32 = 50;
pub const MAX_BOT_NAME_BYTES: u32 = 24;

#[contract]
pub struct BotNFTContract;

#[contractimpl]
impl BotNFTContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), BotNFTError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(BotNFTError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::NextBotId, &1u64);
        env.storage().instance().set(&DataKey::Supply, &0u64);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    pub fn mint_basic(env: Env, owner: Address) -> Result<u64, BotNFTError> {
        owner.require_auth();
        Self::mint_bot_internal(&env, &owner, BotTier::Basic)
    }

    pub fn mint_tier(env: Env, owner: Address, tier: BotTier) -> Result<u64, BotNFTError> {
        owner.require_auth();
        if matches!(tier, BotTier::Basic) {
            return Err(BotNFTError::InvalidTier);
        }
        Self::mint_bot_internal(&env, &owner, tier)
    }

    /// Returns the tracked number of minted bots.
    pub fn total_supply(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }

    pub fn get_bot(env: Env, bot_id: u64) -> Result<BotNFT, BotNFTError> {
        env.storage()
            .persistent()
            .get(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)
    }

    pub fn get_user_bots(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(owner))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_user_total_rate(env: Env, owner: Address) -> u64 {
        let bot_ids = Self::get_user_bots(env.clone(), owner);
        let mut total: u64 = 0;
        for id in bot_ids.iter() {
            if let Some(bot) = env.storage().persistent().get::<_, BotNFT>(&DataKey::Bot(id)) {
                total = total.saturating_add(bot.accrual_rate);
            }
        }
        total
    }

    pub fn transfer(env: Env, from: Address, to: Address, bot_id: u64) -> Result<(), BotNFTError> {
        from.require_auth();
        let mut bot: BotNFT = env
            .storage()
            .persistent()
            .get(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)?;
        if bot.owner != from {
            return Err(BotNFTError::NotOwner);
        }
        Self::remove_from_user_list(&env, &from, bot_id);
        Self::add_to_user_list(&env, &to, bot_id)?;
        bot.owner = to.clone();
        env.storage().persistent().set(&DataKey::Bot(bot_id), &bot);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish((symbol_short!("transfer"), from, to), bot_id);
        Ok(())
    }

    pub fn rename_bot(
        env: Env,
        owner: Address,
        bot_id: u64,
        name: String,
    ) -> Result<(), BotNFTError> {
        owner.require_auth();
        let mut bot = env
            .storage()
            .persistent()
            .get::<_, BotNFT>(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)?;
        if bot.owner != owner {
            return Err(BotNFTError::NotOwner);
        }
        if name.len() > MAX_BOT_NAME_BYTES {
            return Err(BotNFTError::InvalidName);
        }
        bot.name = name;
        env.storage()
            .persistent()
            .set(&DataKey::Bot(bot_id), &bot);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (symbol_short!("rename"), owner),
            bot_id,
        );
        Ok(())
    }

    pub fn get_tier_info(env: Env, tier: BotTier) -> (String, u64, i128) {
        (tier.name(&env), tier.rate(), tier.price())
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    fn mint_bot_internal(env: &Env, owner: &Address, tier: BotTier) -> Result<u64, BotNFTError> {
        let user_bots = Self::get_user_bots(env.clone(), owner.clone());
        if user_bots.len() >= MAX_BOTS_PER_USER {
            return Err(BotNFTError::MaxBotsReached);
        }
        let bot_id: u64 = env.storage().instance().get(&DataKey::NextBotId).unwrap_or(1);
        let bot = BotNFT {
            id: bot_id,
            tier,
            owner: owner.clone(),
            accrual_rate: tier.rate(),
            minted_at: env.ledger().timestamp(),
            name: tier.name(env),
        };
        env.storage().persistent().set(&DataKey::Bot(bot_id), &bot);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::add_to_user_list(env, owner, bot_id)?;
        env.storage().instance().set(&DataKey::NextBotId, &(bot_id + 1));
        let supply = env.storage().instance().get(&DataKey::Supply).unwrap_or(0u64);
        env.storage().instance().set(&DataKey::Supply, &supply.saturating_add(1));
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            (symbol_short!("mint"), owner.clone()),
            (bot_id, tier as u32, tier.rate()),
        );
        Ok(bot_id)
    }

    fn add_to_user_list(env: &Env, user: &Address, bot_id: u64) -> Result<(), BotNFTError> {
        let mut bots: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(user.clone()))
            .unwrap_or_else(|| Vec::new(env));
        if bots.len() >= MAX_BOTS_PER_USER {
            return Err(BotNFTError::MaxBotsReached);
        }
        bots.push_back(bot_id);
        env.storage().persistent().set(&DataKey::UserBots(user.clone()), &bots);
        env.storage().persistent().extend_ttl(
            &DataKey::UserBots(user.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Ok(())
    }

    fn remove_from_user_list(env: &Env, user: &Address, bot_id: u64) {
        let bots: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserBots(user.clone()))
            .unwrap_or_else(|| Vec::new(env));
        let mut new_bots: Vec<u64> = Vec::new(env);
        for id in bots.iter() {
            if id != bot_id {
                new_bots.push_back(id);
            }
        }
        env.storage().persistent().set(&DataKey::UserBots(user.clone()), &new_bots);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address, BotNFTContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, admin, client)
    }

    #[test]
    fn test_mint_basic_bot() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        let bot_id = client.mint_basic(&user);
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.tier, BotTier::Basic);
        assert_eq!(bot.accrual_rate, RATE_BASIC);
        assert_eq!(bot.owner, user);
    }

    #[test]
    fn test_mint_basic_via_tier_fails() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        assert!(client.try_mint_tier(&user, &BotTier::Basic).is_err());
    }

    #[test]
    fn test_mint_tier_and_rate() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint_basic(&user);
        client.mint_tier(&user, &BotTier::Gold);
        assert_eq!(client.get_user_total_rate(&user), RATE_BASIC + RATE_GOLD);
    }

    #[test]
    fn test_all_tier_rates() {
        assert_eq!(BotTier::Basic.rate(), 1);
        assert_eq!(BotTier::Bronze.rate(), 5);
        assert_eq!(BotTier::Silver.rate(), 25);
        assert_eq!(BotTier::Gold.rate(), 100);
        assert_eq!(BotTier::Diamond.rate(), 500);
    }

    #[test]
    fn test_transfer_bot() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let bot_id = client.mint_basic(&alice);
        client.transfer(&alice, &bob, &bot_id);
        let bot = client.get_bot(&bot_id);
        assert_eq!(bot.owner, bob);
        assert_eq!(client.get_user_bots(&alice).len(), 0);
        assert_eq!(client.get_user_bots(&bob).len(), 1);
    }

    #[test]
    fn test_transfer_not_owner_fails() {
        let (env, _admin, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);
        let bot_id = client.mint_basic(&alice);
        // charlie tries to transfer alice's bot
        assert!(client.try_transfer(&charlie, &bob, &bot_id).is_err());
    }

    #[test]
    fn test_nonexistent_bot_fails() {
        let (env, _admin, client) = setup();
        assert!(client.try_get_bot(&9999u64).is_err());
    }

    #[test]
    fn test_multiple_bots_accumulate() {
        let (env, _admin, client) = setup();
        let user = Address::generate(&env);
        client.mint_basic(&user);
        client.mint_tier(&user, &BotTier::Silver);
        client.mint_tier(&user, &BotTier::Diamond);
        assert_eq!(
            client.get_user_total_rate(&user),
            RATE_BASIC + RATE_SILVER + RATE_DIAMOND
        );
        assert_eq!(client.get_user_bots(&user).len(), 3);
    }

    #[test]
    fn test_double_initialize_fails() {
        let (env, admin, client) = setup();
        assert!(client.try_initialize(&admin).is_err());
    }
}
