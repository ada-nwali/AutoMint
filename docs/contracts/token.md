# AMT Token Contract API Reference

The AMT Token contract is a Soroban-based token implementation with
admin-controlled minting, burning, and allowance-based transfers. It implements
`soroban_sdk::token::TokenInterface` for standard token clients while retaining
typed `Result` errors on the AMT-specific contract client.

## Public Functions

### initialize

```rust
pub fn initialize(
  env: Env,
  admin: Address,
  decimal: u32,
  name: String,
  symbol: String,
) -> Result<(), TokenError>
```

Initialize the token contract with metadata and admin address.

- `admin`: The address that can mint and burn tokens, and transfer admin rights
- `decimal`: Number of decimal places (must be > 0)
- `name`: Human-readable name (e.g., "AutoMint Token")
- `symbol`: Token symbol (e.g., "AMT")

Returns `TokenError::AlreadyInitialized` if called twice.

---

### balance

```rust
pub fn balance(env: Env, id: Address) -> i128
```

Query the token balance for an address. Returns 0 if the address has no balance record.

---

### spendable_balance

```rust
pub fn spendable_balance(env: Env, id: Address) -> i128
```

Query the portion of `balance` that is actually transferable right now (SEP-41). Equals `balance` minus any reserve held in a (currently unused) `Locked` entry for `id`; returns 0 for an address with no balance record.

---

### bump_balance

```rust
pub fn bump_balance(env: Env, id: Address)
```

Permissionless keeper call that refreshes `id`'s balance entry TTL without modifying its amount. Anyone may call this; it is a no-op if `id` has no balance record. See [Balance TTL](#balance-ttl) below.

---

### transfer

```rust
pub fn transfer(
  env: Env,
  from: Address,
  to: Address,
  amount: i128,
) -> Result<(), TokenError>
```

Transfer tokens from one address to another. Requires authorization from `from`.

- Zero amounts are no-ops and return `Ok(())`
- Negative amounts return `TokenError::NegativeAmount`
- `from == to` returns `TokenError::Unauthorized`
- Insufficient balance returns `TokenError::InsufficientBalance`

---

### transfer_batch

```rust
pub fn transfer_batch(
  env: Env,
  from: Address,
  recipients: Vec<Address>,
  amounts: Vec<i128>,
) -> Result<(), TokenError>
```

Transfer to multiple recipients from a single source in one call. Requires authorization from `from`.

- `recipients` and `amounts` must have the same length (`LengthMismatch` otherwise)
- At most `MAX_BATCH_SIZE` (100) recipients (`BatchTooLarge` otherwise)
- Negative amounts return `TokenError::NegativeAmount`
- Duplicate recipients are aggregated before balances are written
- The full total is debited from `from` once; insufficient balance returns `TokenError::InsufficientBalance`
- Zero amounts are skipped when writing balances but still produce a `transfer` event for that recipient
- Emits one SAC-shaped `transfer(from, recipient)` event per recipient
- Rejected with `TokenError::Paused` while the contract is paused

---

### transfer_from

```rust
pub fn transfer_from(
  env: Env,
  spender: Address,
  from: Address,
  to: Address,
  amount: i128,
) -> Result<(), TokenError>
```

Transfer tokens on behalf of another address using an allowance. Requires authorization from `spender`.

- Validates negative amounts before checking allowance
- Zero amounts are no-ops and return `Ok(())`
- `spender == from` returns `TokenError::Unauthorized`
- `from == to` returns `TokenError::Unauthorized`
- Expired allowance returns `TokenError::AllowanceExpired`
- Insufficient allowance returns `TokenError::InsufficientAllowance`
- Insufficient balance returns `TokenError::InsufficientBalance`

---

### approve

```rust
pub fn approve(
  env: Env,
  from: Address,
  spender: Address,
  amount: i128,
  expiration_ledger: u32,
) -> Result<(), TokenError>
```

Approve a spender to transfer up to `amount` tokens from `from`. Requires authorization from `from`.

- Negative amounts return `TokenError::NegativeAmount`
- Zero amounts are valid and stored as 0 allowance; a zero amount may use a past `expiration_ledger` as a revoke
- A non-zero amount with `expiration_ledger` in the past returns `TokenError::InvalidExpiration`
- An `expiration_ledger` beyond the network's maximum allowance window returns `TokenError::InvalidExpiration`
- #341: self-approval (`from == spender`) is permitted per SEP-41

---

### allowance

```rust
pub fn allowance(env: Env, from: Address, spender: Address) -> i128
```

Query the remaining allowance for a spender to transfer from `from`. Returns 0 if:
- No allowance record exists
- The allowance has expired

---

### mint

```rust
pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError>
```

Mint new tokens. Requires admin authorization.

- Zero amounts are no-ops and return `Ok(())`
- Negative amounts return `TokenError::NegativeAmount`
- Overflow returns `TokenError::Overflow`

---

### burn

```rust
pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError>
```

Burn tokens from an address. Requires authorization from `from`.

- Zero amounts are no-ops and return `Ok(())`
- Negative amounts return `TokenError::NegativeAmount`
- Insufficient balance returns `TokenError::InsufficientBalance`

---

### burn_from

```rust
pub fn burn_from(
  env: Env,
  spender: Address,
  from: Address,
  amount: i128,
) -> Result<(), TokenError>
```

Burn tokens from `from` using an allowance granted to `spender`. Requires authorization from `spender`.

- Zero amounts are no-ops and return `Ok(())`
- Negative amounts return `TokenError::NegativeAmount`
- Expired or insufficient allowance returns the corresponding allowance error
- Insufficient balance returns `TokenError::InsufficientBalance`
- Rejected with `TokenError::Paused` while the contract is paused
- Emits `burn(from)` with `amount`, the same topic/data shape as `burn`

---

### set_mint_limit

```rust
pub fn set_mint_limit(
  env: Env,
  max_per_window: i128,
  window_ledgers: u32,
) -> Result<(), TokenError>
```

Admin-only rolling mint ceiling: at most `max_per_window` tokens may be minted per `window_ledgers` ledgers. A `max_per_window` of `0` disables the limiter; an enabled limit requires a non-zero `window_ledgers`.

- Negative `max_per_window`, or a positive limit with `window_ledgers == 0`, returns `TokenError::InvalidMintLimit`
- Initializes the current mint window if one does not exist yet
- Emits `mintlim` with `(max_per_window, window_ledgers)`
- `mint` rejects an amount that would exceed the window with `TokenError::MintLimitExceeded`

---

### set_admin

```rust
pub fn set_admin(env: Env, new_admin: Address) -> Result<(), TokenError>
```

Propose an administrator transfer. Requires authorization from the current admin;
the current admin remains active until `new_admin` calls `accept_admin`.

- `new_admin == current_admin` returns `TokenError::Unauthorized`
- Contract not initialized returns `TokenError::NotInitialized`

---

### accept_admin, cancel_admin_transfer, pending_admin

```rust
pub fn accept_admin(env: Env) -> Result<(), TokenError>
pub fn cancel_admin_transfer(env: Env) -> Result<(), TokenError>
pub fn pending_admin(env: Env) -> Option<Address>
```

Only the proposed address can accept a pending transfer. The current admin can
cancel it; both actions clear `pending_admin`. `accept_admin` and
`cancel_admin_transfer` return `TokenError::NoPendingAdmin` when no proposal is
pending.

---

### set_metadata

```rust
pub fn set_metadata(env: Env, name: String, symbol: String) -> Result<(), TokenError>
```

Updates the token name and symbol and emits a `metadata` event containing the
old and new values. Only the current admin may call it, and both values must be
non-empty. Token decimals remain immutable: changing precision would silently
reprice every existing integer balance.

---

### admin

```rust
pub fn admin(env: Env) -> Result<Address, TokenError>
```

Query the current admin address. Returns `TokenError::NotInitialized` if the contract is not initialized.

---

### decimals

```rust
pub fn decimals(env: Env) -> Result<u32, TokenError>
```

Query the number of decimal places. Returns `TokenError::NotInitialized` if the contract is not initialized.

---

### name

```rust
pub fn name(env: Env) -> Result<String, TokenError>
```

Query the token name. Returns `TokenError::NotInitialized` if the contract is not initialized.

---

### symbol

```rust
pub fn symbol(env: Env) -> Result<String, TokenError>
```

Query the token symbol. Returns `TokenError::NotInitialized` if the contract is not initialized.

---

### total_supply

```rust
pub fn total_supply(env: Env) -> i128
```

Return the current total supply, tracked on every `mint` and `burn`/`burn_from`. Returns `0` before the first mint.

---

### max_supply

```rust
pub fn max_supply(env: Env) -> Option<i128>
```

Return the configured maximum supply cap, or `None` when no cap is set (unlimited minting, subject to the mint limit).

---

### set_max_supply

```rust
pub fn set_max_supply(env: Env, new_cap: Option<i128>) -> Result<(), TokenError>
```

Admin-only: set (`Some(cap)`) or remove (`None`) the maximum supply cap. A cap below the current `total_supply` returns `TokenError::SupplyCapExceeded`; a negative cap returns `TokenError::NegativeAmount`. `mint` rejects any amount that would push supply past the cap with `TokenError::SupplyCapExceeded`. Emits `maxsup` with the new cap, or `-1` when the cap is removed.

---

### paused

```rust
pub fn paused(env: Env) -> bool
```

Return whether the contract is currently paused. Read-only and never errors.

---

### pause / unpause

```rust
pub fn pause(env: Env) -> Result<(), TokenError>
pub fn unpause(env: Env) -> Result<(), TokenError>
```

Admin-only circuit breaker. While paused, state-changing token operations (`transfer`, `transfer_batch`, `transfer_from`, `mint`, `burn`, `burn_from`) fail with `TokenError::Paused`; reads and `bump_balance` continue to work. `pause` emits `pause` with `true`, `unpause` emits `unpause` with `false`.

Errors:
- `NotInitialized`: The contract has not been initialized.
- `Unauthorized`: Caller is not the admin.

---

### upgrade

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TokenError>
```

Admin-only: replace the contract's wasm with the code identified by `new_wasm_hash`. Emits `upgrade` with empty data.

Errors:
- `NotInitialized`: The contract has not been initialized.
- `Unauthorized`: Caller is not the admin.

> **Token administration via Accrual:** once the Accrual contract is the token admin (see `accept_token_admin` in [accrual.md](./accrual.md)), these admin-only entry points must be driven through Accrual. Accrual exposes `set_mint_limit` as a wrapper and authorizes the Token's `set_admin`/`accept_admin` calls as itself; direct calls from the old admin will fail authorization.

---

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `AlreadyInitialized` | 1 | Contract was already initialized |
| `NotInitialized` | 2 | Contract has not been initialized |
| `Unauthorized` | 3 | Caller is not authorized for this action |
| `InsufficientBalance` | 4 | Account does not have enough balance |
| `InsufficientAllowance` | 5 | Allowance is not sufficient for the transfer |
| `NegativeAmount` | 6 | Amount is negative |
| `AllowanceExpired` | 7 | Allowance has expired |
| `Overflow` | 8 | Arithmetic overflow occurred |
| `SupplyCapExceeded` | 9 | Mint would exceed the configured max supply |
| `InvalidDecimals` | 10 | `decimal` was 0 at `initialize` |
| `InvalidExpiration` | 11 | `approve`'s `expiration_ledger` is in the past (for a non-zero amount) or beyond the maximum allowance window |
| `InvalidMetadata` | 12 | Name or symbol is empty |
| `NoPendingAdmin` | 13 | No administrator transfer is pending |
| `LengthMismatch` | 14 | `transfer_batch` received different counts of recipients and amounts |
| `BatchTooLarge` | 15 | `transfer_batch` received more than `MAX_BATCH_SIZE` (100) recipients |
| `MintLimitExceeded` | 16 | Mint would exceed the rolling mint limit |
| `InvalidMintLimit` | 17 | Mint limit is negative or has a zero window |
| `Paused` | 1000 | Contract is paused |

---

## Balance TTL

Balance entries are persistent storage, bumped to the network's maximum entry TTL (3,110,400 ledgers, ≈180 days at 5s/ledger) on every `mint`, `transfer`, `burn`/`burn_from`, or `bump_balance` call. The private storage helpers own those TTL extensions; public callers do not extend TTL directly. `balance()` and `spendable_balance()` are read-only and never extend TTL. A holder that transacts at least once within that window never archives; `bump_balance(id)` lets anyone (a keeper, a wallet, the holder) refresh a dormant balance's TTL without touching its amount.

---

## Events

The contract emits the following events, matching the Stellar Asset Contract (SAC) topic/data convention `topics = (name, ...addresses)`, `data = payload`:

| Function | Topics | Data |
|----------|--------|------|
| `transfer` | `("transfer", from, to)` | `amount: i128` |
| `mint` | `("mint", admin, to)` | `amount: i128` |
| `burn` / `burn_from` | `("burn", from)` | `amount: i128` |
| `transfer_batch` | `("transfer", from, recipient)` per recipient | `amount: i128` |
| `set_mint_limit` | `("mintlim", admin)` | `(max_per_window: i128, window_ledgers: u32)` |
| `set_max_supply` | `("maxsup",)` | `new_cap: i128` (`-1` when the cap is removed) |
| `pause` | `("pause",)` | `true` |
| `unpause` | `("unpause",)` | `false` |
| `upgrade` | `("upgrade",)` | `()` |
| `approve` | `("approve", from, spender)` | `(amount: i128, expiration_ledger: u32)` |
| `admin_proposed` | `("admin_proposed", current_admin)` | `pending_admin: Address` |
| `set_admin` | `("set_admin", old_admin)` | `new_admin: Address` |
| `admin_cancel` | `("admin_cancel",)` | `cancelled_admin: Address` |
| `metadata` | `("metadata",)` | `(old_name, old_symbol, new_name, new_symbol)` |
