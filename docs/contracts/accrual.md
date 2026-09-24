# Accrual Contract API Reference

The Accrual contract tracks each user's point-accrual clock and converts pending points into AMT tokens on claim, coordinating with the Registry and Token contracts.

## Public Functions

### initialize

```rust
pub fn initialize(env: Env, admin: Address, points_per_amt: u64) -> Result<(), AccrualError>
```

Initialize the contract with an admin address and the points-to-AMT conversion rate. Requires authorization from `admin`.

- `admin`: The contract administrator address.
- `points_per_amt`: Number of points required to mint 1 AMT unit. Must be non-zero.

Errors:
- `AlreadyInitialized`: The contract has already been initialized.
- `Unauthorized`: `points_per_amt` is `0`.

Example:

```rust
accrual_client.initialize(&admin, &100_u64);
```

---

### start_accrual

```rust
pub fn start_accrual(env: Env, user: Address, rate: u64) -> Result<(), AccrualError>
```

Start the accrual clock for `user` at `rate` points per hour. Requires authorization from `user`. Can only be called once per user.

- `rate`: Points accrued per hour, typically `get_user_total_rate` from the Bot NFT contract.

Errors:
- `AlreadyStarted`: `user` already has an accrual record.

Example:

```rust
accrual_client.start_accrual(&user, &rate);
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

Return `Some(AccrualState { last_claim_ts, total_claimed_points })` for `user`, or `None` if accrual has not started.

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
- `Unauthorized`: The contract configuration could not be read (not initialized).

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
