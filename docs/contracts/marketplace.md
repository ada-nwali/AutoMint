# Marketplace Contract API Reference

The Marketplace contract manages listings and sales of bot NFTs, with configurable admin fees.

## Public Functions

### initialize

```rust
pub fn initialize(
  env: Env,
  admin: Address,
  bot_nft: Address,
  fee_bps: u32,
) -> Result<(), MarketplaceError>
```

Initialize the marketplace contract with admin address, bot NFT contract reference, and fee configuration.

- `admin`: The marketplace administrator address
- `bot_nft`: The address of the bot NFT contract
- `fee_bps`: Platform fee in basis points (e.g., 250 = 2.5%)

Returns `MarketplaceError::AlreadyInitialized` if called twice.

---

### list_bot

```rust
pub fn list_bot(
  env: Env,
  seller: Address,
  bot_id: u64,
  price: i128,
  currency: Address,
) -> Result<u64, MarketplaceError>
```

Escrow a bot into the marketplace and create a listing. Requires authorization from `seller`.

- `bot_id`: The ID of the bot NFT to list
- `price`: Sale price in the specified currency (must be > 0)
- `currency`: The token contract address for payment

Returns the new listing ID on success.

Errors:
- `InvalidPrice`: Price must be strictly positive
- `NotInitialized`: Marketplace not initialized
- `BotTransferFailed`: Bot does not exist or caller is not the owner

---

### cancel_listing

```rust
pub fn cancel_listing(
  env: Env,
  seller: Address,
  listing_id: u64,
) -> Result<(), MarketplaceError>
```

Cancel a listing and return the escrowed bot to the seller. Requires authorization from `seller`.

Errors:
- `ListingNotFound`: Listing does not exist
- `ListingNotActive`: Listing has already been cancelled or purchased
- `Unauthorized`: Caller is not the original seller
- `NotInitialized`: Marketplace not initialized
- `BotTransferFailed`: Failed to return the bot to seller

---

### buy_bot

```rust
pub fn buy_bot(
  env: Env,
  buyer: Address,
  listing_id: u64,
) -> Result<(), MarketplaceError>
```

Purchase a bot from an active listing. Requires authorization from `buyer` and sufficient currency balance.

Payment is split between seller (97.5%) and admin (2.5% fee) based on the configured fee rate.

Errors:
- `ListingNotFound`: Listing does not exist
- `ListingNotActive`: Listing is no longer active
- `Unauthorized`: Buyer is the original seller (cannot buy own listing)
- `NotInitialized`: Marketplace not initialized
- `Overflow`: Price calculation overflow
- `PaymentFailed`: Buyer does not have sufficient balance or payment failed
- `BotTransferFailed`: Failed to transfer bot to buyer

---

### get_listing

```rust
pub fn get_listing(env: Env, listing_id: u64) -> Result<Listing, MarketplaceError>
```

Retrieve the details of a specific listing.

Errors:
- `ListingNotFound`: Listing does not exist

---

### get_active_listings

```rust
pub fn get_active_listings(
  env: Env,
  start: u64,
  limit: u32,
) -> Vec<Listing>
```

Retrieve a paginated list of active listings.

- `start`: Offset in the listings index (0-based)
- `limit`: Maximum number of listings to return

Returns an empty vector if no listings are found.

---

### get_user_listings

```rust
pub fn get_user_listings(env: Env, seller: Address) -> Vec<Listing>
```

Retrieve all listings created by a specific seller (both active and inactive).

Returns an empty vector if the seller has no listings.

---

### config

```rust
pub fn config(env: Env) -> Result<Config, MarketplaceError>
```

Retrieve the marketplace configuration (admin, bot_nft address, fee_bps).

Errors:
- `NotInitialized`: Marketplace not initialized

---

## Data Types

### Listing

```rust
pub struct Listing {
  pub id: u64,
  pub seller: Address,
  pub bot_id: u64,
  pub bot_tier: BotTier,
  pub price: i128,
  pub currency: Address,
  pub listed_at: u64,           // Ledger timestamp
  pub active: bool,
}
```

Represents a bot listing in the marketplace.

### Config

```rust
pub struct Config {
  pub admin: Address,
  pub bot_nft: Address,
  pub fee_bps: u32,
}
```

Marketplace configuration stored during initialization.

---

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `AlreadyInitialized` | 1 | Marketplace was already initialized |
| `NotInitialized` | 2 | Marketplace has not been initialized |
| `InvalidPrice` | 3 | Price must be strictly positive |
| `BotTransferFailed` | 4 | Failed to transfer bot (doesn't exist or wrong owner) |
| `ListingNotFound` | 5 | Listing does not exist |
| `NotSeller` | 6 | Caller is not the listing seller |
| `ListingInactive` | 7 | Listing is not active |
| `InsufficientFunds` | 8 | Buyer does not have enough currency |
| `ListingNotActive` | 9 | Listing is no longer active |
| `Unauthorized` | 10 | Caller is not authorized for this action |
| `PaymentFailed` | 11 | Payment transfer failed |
| `Overflow` | 12 | Arithmetic overflow occurred |

---

## Events

The contract emits the following events:

- `listed(seller, listing_id)` with `(bot_id, price)`
- `cancelled(seller, listing_id)` with `bot_id`
- `bought(buyer, listing_id)` with `(bot_id, price)`

---

## Fee Calculation

The platform fee is calculated as:
```
fee = price * fee_bps / 1000
seller_payment = price - fee
```

For example, with a 250 basis point fee (2.5%):
- Listing price: 1000 tokens
- Fee: (1000 * 25) / 1000 = 25 tokens
- Seller receives: 975 tokens
- Admin receives: 25 tokens
