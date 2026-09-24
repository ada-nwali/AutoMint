# AMT Token Contract API Reference

The AMT Token contract is a Soroban-based token implementation with admin-controlled minting, burning, and allowance-based transfers.

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

- `from == spender` returns `TokenError::Unauthorized`
- Negative amounts return `TokenError::NegativeAmount`
- Zero amounts are valid and stored as 0 allowance

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

### set_admin

```rust
pub fn set_admin(env: Env, new_admin: Address) -> Result<(), TokenError>
```

Transfer admin rights to a new address. Requires authorization from the current admin.

- `new_admin == current_admin` returns `TokenError::Unauthorized`
- Contract not initialized returns `TokenError::NotInitialized`

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

---

## Events

The contract emits the following events:

- `approve(from, spender)` with `(amount, expiration_ledger)`
- `transfer(from, to)` with `amount`
- `burn(from)` with `amount`
- `mint(to)` with `amount`
- `set_admin()` with `new_admin`
