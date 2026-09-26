# Accrual Contract API Reference

The Accrual contract tracks each user's point-accrual clock and converts pending points into AMT tokens on claim, coordinating with the Registry and Token contracts.

## Public Functions

### initialize

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    bot_nft: Address,
    registry: Address,
    points_per_amt: u64,
) -> Result<(), AccrualError>
```

Initialize the contract with an admin address, the bot_nft and registry addresses, and the points-to-AMT conversion rate. Requires authorization from `admin`. The registry address is stored so `start_accrual` can verify registration up front (#415).

- `admin`: The contract administrator address.
- `bot_nft`: The bot NFT contract used to derive each user's accrual rate.
- `registry`: The registry contract used to verify `is_registered(user)`.
- `points_per_amt`: Number of points required to mint 1 AMT unit. Must be non-zero.

Errors:
- `AlreadyInitialized`: The contract has already been initialized.
- `InvalidConfig`: `points_per_amt` is `0`.

Example:

```rust
accrual_client.initialize(&admin, &bot_nft_id, &registry_id, &100_u64);
```

---

### start_accrual

```rust
pub fn start_accrual(env: Env, user: Address) -> Result<(), AccrualError>
```

Start the accrual clock for `user` at the combined rate of the bots they own, read from the bot_nft contract. Requires authorization from `user`. Can only be called once per user.

Errors:
- `AlreadyStarted`: `user` already has an accrual record.
- `NotRegistered`: `user` is not registered in the registry contract (#415).
- `NoBots`: `user` owns no bots, so the derived rate is zero.

Example:

```rust
accrual_client.start_accrual(&user);
```

---

### pending_points

```rust
pub fn pending_points(env: Env, user: Address) -> Result<u128, AccrualError>
```

Compute the points accrued since `user`'s `last_claim_ts`, based on elapsed time and `rate`. Read-only; does not mutate state.

Errors:
- `NotStarted`: `user` has no accrual record.

Example:

```rust
let pending = accrual_client.pending_points(&user);
```

---

### get_accrual_state

```rust
pub fn get_accrual_state(env: Env, user: Address) -> Option<AccrualState>
```

Return `Some(AccrualState { last_claim_ts, carry_points, lifetime_points, rate, started_at })` for `user`, or `None` if accrual has not started. The state carries everything the dashboard needs in one call, including the rate used for client-side interpolation (#418).

Example:

```rust
let state = accrual_client.get_accrual_state(&user);
```

---

### claim

```rust
pub fn claim(
    env: Env,
    user: Address,
    token_contract: Address,
    registry: Address,
) -> Result<i128, AccrualError>
```

Settle pending points for `user`: adds them to the Registry's `total_points`, mints any whole AMT units earned (`updated_points / points_per_amt`) via the Token contract, carries the remainder forward, and resets `last_claim_ts`. Requires authorization from `user`.

- `token_contract`: Address of the deployed AMT Token contract.
- `registry`: Address of the deployed Registry contract.

Returns the number of points settled in this claim (not the AMT amount minted).

Errors:
- `NotStarted`: `user` has no accrual record.
- `NotInitialized`: The contract configuration could not be read (not initialized).

Example:

```rust
let points_claimed = accrual_client.claim(&user, &token_id, &registry_id);
```

---

### admin

```rust
pub fn admin(env: Env) -> Address
```

Return the current admin address. Panics if the contract has not been initialized.

Example:

```rust
let admin = accrual_client.admin();
```

---

### config

```rust
pub fn config(env: Env) -> Result<Config, AccrualError>
```

Return the current `Config` (`points_per_amt`).

Errors:
- `NotInitialized`: The contract has not been initialized.

Example:

```rust
let config = accrual_client.config();
```
