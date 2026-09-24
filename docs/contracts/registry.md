# Registry Contract API Reference

The Registry contract is the source of truth for user identity on AutoMint: it stores usernames, cumulative points, claimed AMT, bot counts, and exposes a bounded leaderboard query.

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
- `username`: Display name, 1-32 characters, and unique across the registry.

Errors:
- `AlreadyRegistered`: `user` already has a profile.
- `UsernameTaken`: `username` is empty, longer than 32 characters, or already used by another address.

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

Add `amount` to `user`'s `claimed_amt` running total, saturating on overflow. `amount` may be negative (e.g. to reverse a prior credit); `amount == 0` is a no-op that returns `Ok(())`.

Errors:
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

Return up to `limit` `UserProfile` records sorted by `total_points` descending (in-contract bubble sort, gas-bounded by the total number of registered users). `limit == 0` returns an empty vector.

Example:

```rust
let top_10 = registry_client.get_leaderboard(&10_u32);
```

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

### admin

```rust
pub fn admin(env: Env) -> Result<Address, RegistryError>
```

Return the current admin address.

Errors:
- `NotInitialized`: The registry has not been initialized.

Example:

```rust
let admin = registry_client.admin();
```
