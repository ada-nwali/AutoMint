// SPDX-License-Identifier: Apache-2.0

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env,
    String, Vec,
};

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
    pub fn price(self) -> i128 {
        match self {
            Tier::Basic => 0,
            Tier::Advanced => 500_0000000,
            Tier::Premium => 2000_0000000,
        }
    }
}

impl BotTier {
    pub fn price(self) -> i128 {
        match self {
            BotTier::Basic => 0,
            BotTier::Bronze => 500_0000000,
            BotTier::Silver => 2000_0000000,
            BotTier::Gold => 7500_0000000,
            BotTier::Diamond => 25000_0000000,
        }
    }

    pub fn name(self, env: &Env) -> String {
        match self {
            BotTier::Basic => String::from_str(env, "Basic Bot"),
            BotTier::Bronze => String::from_str(env, "Bronze Bot"),
            BotTier::Silver => String::from_str(env, "Silver Bot"),
            BotTier::Gold => String::from_str(env, "Gold Bot"),
            BotTier::Diamond => String::from_str(env, "Diamond Bot"),
        }
    }

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

#[derive(Clone)]
#[contracttype]
pub struct BotNFT {
    pub id: u64,
    pub tier: BotTier,
    pub owner: Address,
    pub accrual_rate: u64,
    pub minted_at: u64,
    pub name: String,
    /// Deterministic variant (0..=7) assigned at mint, used for rarity.
    pub variant: u32,
    /// Deterministic bonus bps (0..500) on top of the tier base accrual rate.
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
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;
/// Maximum number of bots that may be minted per tier (supply cap).
const MAX_TIER_SUPPLY: u64 = 50;
/// Maximum number of recipients in a single admin_mint_batch call.
const MAX_BATCH_SIZE: u64 = 50;
/// Maximum number of bots returned by a single `get_user_bots_detailed` call.
/// The cap is enforced contract-side so one simulation stays within the
/// compute budget; callers with more bots paginate via `get_user_bots` +
/// `get_bot` (#483).
const MAX_DETAILED_BOTS: usize = 50;

#[contract]
pub struct BotNFTContract;

#[contractimpl]
impl BotNFTContract {
    pub fn initialize(env: Env, admin: Address, registry: Address) -> Result<(), BotNFTError> {
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
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    pub fn mint_basic(env: Env, owner: Address) -> Result<u64, BotNFTError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(BotNFTError::NotInitialized);
        }
        owner.require_auth();
        Self::do_mint(&env, &owner, BotTier::Basic, false)
    }

    pub fn mint_tier(
        env: Env,
        owner: Address,
        tier: Tier,
        token: Address,
    ) -> Result<u64, BotNFTError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(BotNFTError::NotInitialized);
        }
        owner.require_auth();

        // Charge the purchase price (transfer fails on insufficient balance).
        let price = tier.price();
        if price > 0 {
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
        let bot_id = Self::get_next_id(env);
        let name = tier.name(env);
        let (variant, bonus_bps) =
            Self::derive_traits(env, bot_id, env.ledger().timestamp(), owner);
        // Effective accrual rate = base rate + deterministic bonus.
        let base = tier.rate();
        let effective = base.saturating_add(base.saturating_mul(bonus_bps as u64) / 10000);
        let bot = BotNFT {
            id: bot_id,
            tier,
            owner: owner.clone(),
            accrual_rate: effective,
            minted_at: env.ledger().timestamp(),
            name,
            variant,
            bonus_bps,
        };

        // Enforce per-tier supply cap.
        let supply = Self::tier_supply(env, tier).saturating_add(1);
        if supply > MAX_TIER_SUPPLY {
            return Err(BotNFTError::SupplyCapExceeded);
        }
        env.storage()
            .persistent()
            .set(&DataKey::TierSupply(tier), &supply);

        env.storage().persistent().set(&DataKey::Bot(bot_id), &bot);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);

        Self::add_bot_to_user(env, owner, bot_id);
        Self::increment_bot_count(env, owner);

        let topic = if is_grant {
            symbol_short!("grant")
        } else {
            symbol_short!("mint")
        };
        env.events().publish((topic, owner.clone()), (bot_id, tier));
        Ok(bot_id)
    }

    pub fn transfer(env: Env, bot_id: u64, from: Address, to: Address) -> Result<(), BotNFTError> {
        from.require_auth();
        if from == to {
            return Ok(());
        }
        let mut bot: BotNFT = env
            .storage()
            .persistent()
            .get(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)?;

        if bot.owner != from {
            return Err(BotNFTError::NotOwner);
        }

        bot.owner = to.clone();
        env.storage().persistent().set(&DataKey::Bot(bot_id), &bot);
        // #544: `set` alone does not refresh a persistent entry's TTL once
        // it's past the extend-TTL threshold — without this, a bot that
        // changes hands close to its expiry ledger (but is never minted
        // again) could still silently archive out from under its new
        // owner. Explicitly bump it on every ownership change, matching
        // every other write path in this contract.
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Bot(bot_id), LEDGER_THRESHOLD, LEDGER_BUMP);
        // Also keep the contract instance itself alive on write activity —
        // mirrors `registry::register`, which bumps its own instance TTL on
        // every write, not just at `initialize`.
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::remove_bot_from_user(&env, &from, bot_id);
        Self::add_bot_to_user(&env, &to, bot_id);

        env.events()
            .publish((symbol_short!("transfer"), from, to.clone()), bot_id);
        Ok(())
    }

    pub fn get_bot(env: Env, bot_id: u64) -> Result<BotNFT, BotNFTError> {
        env.storage()
            .persistent()
            .get(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)
    }

    /// Off-chain verifiable descriptor. The traits are derived deterministically
    /// from sha256(bot_id, minted_at, owner); this URI exposes the derivation
    /// inputs so anyone can recompute `variant`/`bonus_bps` and confirm rarity.
    pub fn token_uri(env: Env, bot_id: u64) -> Result<String, BotNFTError> {
        let bot: BotNFT = env
            .storage()
            .persistent()
            .get(&DataKey::Bot(bot_id))
            .ok_or(BotNFTError::BotNotFound)?;
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
        let ids = Self::get_user_bots(env.clone(), user);
        let mut bots = Vec::new(&env);
        for id in ids.iter().take(MAX_DETAILED_BOTS) {
            if let Ok(bot) = Self::get_bot(env.clone(), id) {
                bots.push_back(bot);
            }
        }
        bots
    }

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

    pub fn get_tier_info(env: Env, tier: BotTier) -> (String, u64, i128) {
        (tier.name(&env), tier.rate(), tier.price())
    }

    fn get_next_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::NextId, &(id.saturating_add(1)));
        id
    }

    /// Number of bots minted for a given tier (supply tracking).
    fn tier_supply(env: &Env, tier: BotTier) -> u64 {
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

    pub fn admin(env: Env) -> Result<Address, BotNFTError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BotNFTError::NotInitialized)
    }

    fn increment_bot_count(env: &Env, user: &Address) {
        let registry: Address = match env.storage().instance().get(&DataKey::Registry) {
            Some(r) => r,
            None => return,
        };
        let reg_client = automint_registry::RegistryContractClient::new(env, &registry);
        // Use the fallible client so a registry-side error (e.g. the owner is
        // not registered yet) is swallowed rather than panicking the mint.
        let _ = reg_client.try_increment_bot_count(user);
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
        let registry_id = env.register_contract(None, automint_registry::RegistryContract);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), registry_id.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize(&admin, &registry_id);
        // No admin authorization for the subsequent call -> rejected.
        env.mock_auths(&[]);
        let to = Address::generate(&env);
        assert!(client.try_admin_mint(&to, &BotTier::Basic).is_err());
    }

    fn fund_user(env: &Env, token: &Address, user: &Address, amount: i128) {
        let token_client = automint_token::AMTTokenClient::new(env, token);
        let _ = token_client.mint(user, &amount);
    }

    #[test]
    fn test_mint_basic_assigns_sequential_ids() {
        let (env, _admin, registry, _token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        let id1 = client.mint_basic(&user);
        let id2 = client.mint_basic(&user);
        let id3 = client.mint_basic(&user);
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
        let basic_id = client.mint_tier(&user, &Tier::Basic, &token);
        let advanced_id = client.mint_tier(&user, &Tier::Advanced, &token);
        let premium_id = client.mint_tier(&user, &Tier::Premium, &token);

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

        assert_eq!(basic_bot.name, String::from_str(&env, "Basic Bot"));
        assert_eq!(advanced_bot.name, String::from_str(&env, "Bronze Bot"));
        assert_eq!(premium_bot.name, String::from_str(&env, "Silver Bot"));

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
        let id2 = client.mint_basic(&user);
        let id3 = client.mint_basic(&user);

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
        let id2 = client.mint_basic(&user);

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
    }

    #[test]
    fn test_get_user_total_rate_sums_owned_bots() {
        let (env, _admin, registry, token, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "user1");
        fund_user(&env, &token, &user, 100_000_000_000);

        let id1 = client.mint_basic(&user);
        let id2 = client.mint_tier(&user, &Tier::Advanced, &token);
        let id3 = client.mint_tier(&user, &Tier::Premium, &token);

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
            client.try_initialize(&admin, &registry),
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
        client.mint_basic(&owner);
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

        assert_eq!(
            client.get_tier_info(&BotTier::Gold),
            (String::from_str(&env, "Gold Bot"), 100, 7500_0000000)
        );
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
    }

    #[test]
    fn test_mint_tier_basic_is_free() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        let token_client = automint_token::AMTTokenClient::new(&env, &token_id);
        let initial_balance = token_client.balance(&user);
        let bot_id = client.mint_tier(&user, &Tier::Basic, &token_id);
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
        let result = client.try_mint_tier(&user, &Tier::Advanced, &token_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_tier_sequential_ids() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        let bot1 = client.mint_tier(&user, &Tier::Basic, &token_id);
        let bot2 = client.mint_tier(&user, &Tier::Basic, &token_id);
        let bot3 = client.mint_tier(&user, &Tier::Basic, &token_id);

        assert_eq!(bot1, 1); // First mint in setup uses id 0
        assert_eq!(bot2, 2);
        assert_eq!(bot3, 3);
    }

    #[test]
    fn test_mint_tier_updates_user_bot_list() {
        let (env, _admin, registry, token_id, client) = setup();
        let user = Address::generate(&env);
        register_user(&env, &registry, &user, "testuser");

        let bot_id = client.mint_tier(&user, &Tier::Basic, &token_id);
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
        let bot_basic = client.mint_tier(&user, &Tier::Basic, &token_id);

        // Fund user and mint advanced
        fund_user(&env, &token_id, &user, 500_0000000);
        let bot_advanced = client.mint_tier(&user, &Tier::Advanced, &token_id);

        // Fund user more and mint premium
        fund_user(&env, &token_id, &user, 2000_0000000);
        let bot_premium = client.mint_tier(&user, &Tier::Premium, &token_id);

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
        assert_eq!(basic.0, String::from_str(&env, "Basic Bot"));
        assert_eq!(basic.1, 1);
        assert_eq!(basic.2, 0);

        let bronze = client.get_tier_info(&BotTier::Bronze);
        assert_eq!(bronze.0, String::from_str(&env, "Bronze Bot"));
        assert_eq!(bronze.1, 5);
        assert_eq!(bronze.2, 500_0000000);

        let silver = client.get_tier_info(&BotTier::Silver);
        assert_eq!(silver.0, String::from_str(&env, "Silver Bot"));
        assert_eq!(silver.1, 25);
        assert_eq!(silver.2, 2000_0000000);

        let gold = client.get_tier_info(&BotTier::Gold);
        assert_eq!(gold.0, String::from_str(&env, "Gold Bot"));
        assert_eq!(gold.1, 100);
        assert_eq!(gold.2, 7500_0000000);

        let diamond = client.get_tier_info(&BotTier::Diamond);
        assert_eq!(diamond.0, String::from_str(&env, "Diamond Bot"));
        assert_eq!(diamond.1, 500);
        assert_eq!(diamond.2, 25000_0000000);
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
        let result = client.try_initialize(&admin, &registry_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let env = Env::default();
        let registry_id = setup_registry(&env);
        let id = env.register_contract(None, BotNFTContract);
        let client = BotNFTContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (admin.clone(), registry_id.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_initialize(&admin, &registry_id);
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
        client.initialize(&admin, &registry_id);

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
        client.initialize(&admin, &registry_id);

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
        client.initialize(&admin, &registry_id);

        let token_id = env.register_contract(None, automint_token::AMTToken);
        let owner = Address::generate(&env);
        env.mock_auths(&[]);
        let result = client.try_mint_tier(&owner, &Tier::Basic, &token_id);
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
        client.initialize(&admin, &registry_id);

        let token_id = env.register_contract(None, automint_token::AMTToken);
        let owner = Address::generate(&env);
        // Tier::Basic carries a zero price, so no token transfer is required.
        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "mint_tier",
                args: (owner.clone(), Tier::Basic, token_id.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_mint_tier(&owner, &Tier::Basic, &token_id);
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
        client.initialize(&admin, &registry_id);
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
        client.initialize(&admin, &registry_id);
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
}
