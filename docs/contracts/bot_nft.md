# Bot NFT Contract API Reference

The Bot NFT contract mints, tracks, and transfers bot NFTs. Each bot has a `BotTier` that determines its point-accrual rate, and the contract notifies the Registry contract when a user's bot count changes.

## Public Functions

### initialize

```rust
pub fn initialize(env: Env, admin: Address, registry: Address) -> Result<(), BotNFTError>
```

Initialize the contract with an admin address and the Registry contract address used for bot-count callbacks. Must be called once before minting.

- `admin`: The contract administrator address.
- `registry`: Address of the deployed Registry contract.

Errors:
- `AlreadyInitialized`: The contract has already been initialized.

Example:

```rust
bot_nft_client.initialize(&admin, &registry_id);
```

---

### mint_basic

```rust
pub fn mint_basic(env: Env, owner: Address) -> Result<u64, BotNFTError>
```

Mint a free `BotTier::Basic` bot for `owner`. Requires authorization from `owner`. Increments `owner`'s bot count in the Registry contract (failures there are swallowed, not propagated).

Returns the new bot ID.

Errors:
- `NotInitialized`: The contract has not been initialized.

Example:

```rust
let bot_id = bot_nft_client.mint_basic(&owner);
```

---

### mint_tier

```rust
pub fn mint_tier(env: Env, owner: Address, tier: Tier, token: Address) -> Result<u64, BotNFTError>
```

Mint a paid bot at the given `Tier` (`Basic`, `Advanced`, or `Premium`), charging `tier.price()` in `token` from `owner` to the contract if the price is greater than zero. Requires authorization from `owner`.

- `tier`: The purchase tier; maps internally to a `BotTier` (`Advanced` → `BotTier::Bronze`, `Premium` → `BotTier::Silver`).
- `token`: The token contract address used for payment.

Returns the new bot ID.

Errors:
- `NotInitialized`: The contract has not been initialized.
- The underlying token `transfer` call panics (surfaced as an error by `try_mint_tier`) if `owner` has insufficient balance.

Example:

```rust
let bot_id = bot_nft_client.mint_tier(&owner, &Tier::Advanced, &token_id);
```

---

### transfer

```rust
pub fn transfer(env: Env, bot_id: u64, from: Address, to: Address) -> Result<(), BotNFTError>
```

Transfer ownership of `bot_id` from `from` to `to`. Requires authorization from `from`. If `from == to`, this is a no-op that returns `Ok(())`.

Errors:
- `BotNotFound`: `bot_id` does not exist.
- `NotOwner`: `from` is not the current owner of `bot_id`.

Example:

```rust
bot_nft_client.transfer(&bot_id, &from, &to);
```

---

### get_bot

```rust
pub fn get_bot(env: Env, bot_id: u64) -> Result<BotNFT, BotNFTError>
```

Fetch the `BotNFT` record for `bot_id`.

Errors:
- `BotNotFound`: `bot_id` does not exist.

Example:

```rust
let bot = bot_nft_client.get_bot(&bot_id);
```

---

### get_user_bots

```rust
pub fn get_user_bots(env: Env, user: Address) -> Vec<u64>
```

Return the list of bot IDs owned by `user`. Returns an empty vector if `user` owns no bots.

Example:

```rust
let ids = bot_nft_client.get_user_bots(&user);
```

---

### get_user_bots_detailed

```rust
pub fn get_user_bots_detailed(env: Env, user: Address) -> Vec<BotNFT>
```

Return the full `BotNFT` records for up to the first `MAX_DETAILED_BOTS` (50)
bots owned by `user`, in ownership order. One simulation replaces an N+1
fan-out of `get_user_bots` + `get_bot` for dashboards. The cap is enforced
contract-side; callers needing more paginate with `get_user_bots` +
`get_bot`.

Example:

```rust
let bots = bot_nft_client.get_user_bots_detailed(&user);
```

---

### get_user_total_rate

```rust
pub fn get_user_total_rate(env: Env, user: Address) -> u64
```

Sum the `accrual_rate` of every bot owned by `user`. Used by the Accrual contract to compute pending points.

Example:

```rust
let rate = bot_nft_client.get_user_total_rate(&user);
```

---

### get_tier_info

```rust
pub fn get_tier_info(env: Env, tier: BotTier) -> (String, u64, i128)
```

Return `(name, accrual_rate, price)` for a given `BotTier`.

Example:

```rust
let (name, rate, price) = bot_nft_client.get_tier_info(&BotTier::Gold);
```

---

### admin

```rust
pub fn admin(env: Env) -> Result<Address, BotNFTError>
```

Return the current admin address.

Errors:
- `NotInitialized`: The contract has not been initialized.

Example:

```rust
let admin = bot_nft_client.admin();
```
