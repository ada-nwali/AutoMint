# Registry Contract API Reference

The Registry contract is the source of truth for user identity on AutoMint: it stores usernames (plus the original-casing display name), cumulative points, claimed AMT, bot counts, the current season counter, and exposes bounded lifetime and season leaderboard queries. Every state-changing entry point publishes exactly one event (see [Events](#events)).

## Types

```rust
pub struct UserProfile {
    pub address: Address,
    /// ASCII-lowercased username — the uniqueness key (#373).
    pub username: String,
    /// The casing the user typed at registration, preserved verbatim (#373).
    pub display_name: String,
    pub total_points: u64,
    pub claimed_amt: i128,
    pub registered_at: u64,
    pub bot_count: u32,
}

pub struct SeasonEntry {
    pub address: Address,
    pub display_name: String,
    pub season_points: u64,
    pub total_points: u64,
}
```

Username uniqueness is **case-insensitive**: `"Alice"` and `"alice"` collide, while `"alice"` and `"alice2"` do not. `register` stores the ASCII-lowercase form in `username` and the original casing in `display_name`; both predate profiles without a distinct casing simply have the two equal after normalization.

## Public Functions

### initialize

```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError>
```

Initialize the registry with an admin address. Must be called once before any other function.

- `admin`: The registry administrator address. Must authorize the call.

Errors:
- `AlreadyInitialized`: The contract has already been initialized.

Example:

```rust
let admin = Address::generate(&env);
registry_client.initialize(&admin);
```

---

### register

```rust
pub fn register(env: Env, user: Address, username: String) -> Result<(), RegistryError>
```

Register a new user profile. Requires authorization from `user`.

- `user`: The address to register.
- `username`: Display name, 1-32 characters, unique across the registry case-insensitively (#373). The original casing is preserved in `UserProfile::display_name`; the ASCII-lowercased form becomes the uniqueness key in `UserProfile::username`.

Errors:
- `AlreadyRegistered`: `user` already has a profile.
- `InvalidUsername`: `username` is empty or longer than 32 characters.
- `UsernameTaken`: `username` is already used (in any casing) by another address.

Example:

```rust
registry_client.register(&user, &String::from_str(&env, "Alice"));
```

---

### is_registered

```rust
pub fn is_registered(env: Env, user: Address) -> bool
```

Check whether `user` has a registered profile. Never errors.

Example:

```rust
let registered = registry_client.is_registered(&user);
```

---

### get_user

```rust
pub fn get_user(env: Env, user: Address) -> Result<UserProfile, RegistryError>
```

Fetch the full `UserProfile` for `user`.

Errors:
- `NotRegistered`: `user` has no profile.

Example:

```rust
let profile = registry_client.get_user(&user);
```

---

### get_users_batch

```rust
pub fn get_users_batch(
    env: Env,
    addresses: Vec<Address>,
) -> Result<Vec<Option<UserProfile>>, RegistryError>
```

Fetch profiles for up to `MAX_USERS_BATCH` (50) addresses in a single simulation, returning one `Option<UserProfile>` per input address in the same order (`None` for unregistered addresses).

Errors:
- `BatchTooLarge`: `addresses.len() > MAX_USERS_BATCH` (50).

---

### set_writers / get_writers

```rust
pub fn set_writers(env: Env, accrual: Address, bot_nft: Address) -> Result<(), RegistryError>
pub fn get_writers(env: Env) -> Option<Writers>
```

Admin-only allowlist of contracts permitted to call `add_points` / `increment_bot_count` / `decrement_bot_count` / `add_claimed_amt` (the cross-contract writers). `set_writers` replaces both addresses in one call and emits `writers`; `get_writers` returns the current pair, or `None` before the first `set_writers`.

---

### add_points

```rust
pub fn add_points(env: Env, user: Address, points: u64) -> Result<(), RegistryError>
```

Add `points` to `user`'s `total_points`, saturating on overflow. Called by the Accrual contract when a user claims. `points == 0` is a no-op that returns `Ok(())`.

Errors:
- `NotRegistered`: `user` has no profile.

Example:

```rust
registry_client.add_points(&user, &200_u64);
```

---

### increment_bot_count

```rust
pub fn increment_bot_count(env: Env, user: Address) -> Result<(), RegistryError>
```

Increment `user`'s `bot_count` by 1, saturating at `u32::MAX`. Called by the Bot NFT contract after a successful mint.

Errors:
- `NotRegistered`: `user` has no profile.

Example:

```rust
registry_client.increment_bot_count(&user);
```

---

### decrement_bot_count

```rust
pub fn decrement_bot_count(env: Env, user: Address) -> Result<(), RegistryError>
```

Decrement `user`'s `bot_count` by 1, flooring at 0 via `saturating_sub`. Requires authorization from `user`.

Errors:
- `NotRegistered`: `user` has no profile.

Example:

```rust
registry_client.decrement_bot_count(&user);
```

---

### add_claimed_amt

```rust
pub fn add_claimed_amt(env: Env, user: Address, amount: i128) -> Result<(), RegistryError>
```

Add `amount` to `user`'s `claimed_amt` running total, saturating on overflow. `amount == 0` is a no-op that returns `Ok(())`; negative amounts are rejected with `RegistryError::NegativeAmount` so `claimed_amt` is monotonically non-decreasing.

Numeric type rationale: `total_points` is `u64` (an internal non-negative counter accrued from `u64` bot rates × `u64` seconds), whereas `claimed_amt` is `i128` because token balances and transfer/mint amounts are canonically `i128` across Soroban and SEP-41 (`soroban_sdk::token`).

Errors:
- `NegativeAmount`: `amount < 0`.
- `NotRegistered`: `user` has no profile.

Example:

```rust
registry_client.add_claimed_amt(&user, &2_i128);
```

---

### get_leaderboard

```rust
pub fn get_leaderboard(env: Env, limit: u32) -> Vec<UserProfile>
```

Return up to `min(limit, LEADERBOARD_SIZE)` (`LEADERBOARD_SIZE = 100`) `UserProfile` records sorted by `total_points` descending from the bounded top-N leaderboard. Ties are broken by who reached the total first. `limit == 0` returns an empty vector.

Example:

```rust
let top_10 = registry_client.get_leaderboard(&10_u32);
```

---

### get_season

```rust
pub fn get_season(env: Env) -> u32
```

Return the current season counter (#371). Season `0` is in effect until the first `start_new_season` call; every call rolls the counter forward by one.

---

### start_new_season

```rust
pub fn start_new_season(env: Env) -> Result<u32, RegistryError>
```

Admin-only: roll the season counter forward and start the next season's leaderboard from empty (#371). Returns the new season number and emits `newseason`. Lifetime totals, the lifetime leaderboard, and all completed seasons' `SeasonPoints`/`SeasonTop` data remain intact — only the active season's board starts empty.

Errors:
- `Unauthorized`: caller is not the admin.

---

### get_leaderboard_for_season

```rust
pub fn get_leaderboard_for_season(env: Env, season: u32, limit: u32) -> Vec<SeasonEntry>
```

Return up to `min(limit, LEADERBOARD_SIZE)` `SeasonEntry` records for `season`, ranked by that season's `season_points` descending, tie-broken by who reached the total first — the same bounded, O(LEADERBOARD_SIZE) structure as `get_leaderboard`. Each entry carries `display_name`, the season total, and the user's lifetime `total_points`. Seasons that never recorded any points return an empty vector; `limit == 0` likewise.

---

### get_rank

```rust
pub fn get_rank(env: Env, user: Address) -> Result<u32, RegistryError>
```

Return the 1-based leaderboard rank of `user` backed by the bounded top-N structure (`TopUsers`), or `u32::MAX` (`UNRANKED`, documented as "unranked") for registered users below the top-100 cutoff.

Errors:
- `NotRegistered`: `user` has no profile.

---

### total_users

```rust
pub fn total_users(env: Env) -> u32
```

Return the total number of registered users. Returns `0` if the registry has not been initialized yet.

Example:

```rust
let count = registry_client.total_users();
```

---

### get_admin / set_admin / accept_admin / cancel_admin_transfer / pending_admin

```rust
pub fn get_admin(env: Env) -> Result<Address, RegistryError>
pub fn set_admin(env: Env, new_admin: Address) -> Result<(), RegistryError>
pub fn accept_admin(env: Env) -> Result<(), RegistryError>
pub fn cancel_admin_transfer(env: Env) -> Result<(), RegistryError>
pub fn pending_admin(env: Env) -> Option<Address>
```

Two-step admin transfer flow (AM-031):
- `get_admin`: Return the current active admin address (errors with `NotInitialized` before `initialize`).
- `set_admin`: Current admin nominates `new_admin` as `PendingAdmin` (requires current admin auth; rejects self-nomination with `Unauthorized`).
- `accept_admin`: Nominated `PendingAdmin` accepts and becomes the active `Admin`, clearing `PendingAdmin` (requires pending admin auth; errors with `NoPendingAdmin` if none is pending).
- `cancel_admin_transfer`: Current admin cancels a pending transfer, clearing `PendingAdmin` (requires current admin auth; errors with `NoPendingAdmin` if none is pending).
- `pending_admin`: Returns `Some(address)` when a transfer is pending, or `None`.

---

## Events

Every state-changing entry point publishes exactly one event (#370). Zero-amount/zero-point calls are no-ops and publish no event. The first topic is always the event name symbol; the second topic is the affected user where shown.

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `init` | `[admin]` | `timestamp: u64` | `initialize()` |
| `register` | `[user]` | `timestamp: u64` | `register()` |
| `writers` | *(none)* | `(accrual, bot_nft)` | `set_writers()` |
| `addpoints` | `[user]` | `points: u64` | `add_points()` |
| `inc_bot` | `[user]` | `bot_count: u32` | `increment_bot_count()` |
| `dec_bot` | `[user]` | `bot_count: u32` | `decrement_bot_count()` |
| `claimed` | `[user]` | `amount: i128` | `add_claimed_amt()` (#370) |
| `newseason` | *(none)* | `season: u32` | `start_new_season()` (#371) |
| `set_admin` | *(none)* | `(current_admin, new_admin)` | `set_admin()` (#372) |
| `adm_acpt` | *(none)* | `(current_admin, pending)` | `accept_admin()` (#372) |
| `adm_cncl` | *(none)* | `(current_admin, pending)` | `cancel_admin_transfer()` (#372) |

`AM-014` and `AM-043`, cited as event-coverage requirements in #370's original references, do not exist in this repository (no such tickets in code, commits, PRs, or docs); the table above is grounded in the actual `env.events().publish` calls in `contracts/registry/src/lib.rs`.

