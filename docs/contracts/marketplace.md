# Marketplace Contract API Reference

The Marketplace contract manages listings and sales of bot NFTs, with configurable admin fees, creator royalties, escrowed offers, and per-currency allowlisting.

## Public Functions

### initialize

```rust
pub fn initialize(
  env: Env,
  admin: Address,
  bot_nft: Address,
  fee_bps: u32,
  royalty_bps: u32,
) -> Result<(), MarketplaceError>
```

Initialize the marketplace contract with the admin address, bot NFT contract reference, platform fee and creator royalty. Requires authorization from `admin`.

- `admin`: The marketplace administrator address
- `bot_nft`: The address of the bot NFT contract; probed for the expected interface
- `fee_bps`: Platform fee in basis points (e.g., 250 = 2.5%)
- `royalty_bps`: Creator royalty in basis points, paid to the bot's original minter

`fee_bps + royalty_bps` must not exceed 10,000. Initializes `next_listing_id` to `1` and the per-seller active-listing cap to `50`. Seeds the currency allowlist with the bot NFT contract's `payment_token` (emitting `currency_added`), so a fresh deployment can trade in the payment token without a separate `add_allowed_currency` call. Emits `initialized` with `(admin, bot_nft, fee_bps)`.

Errors:
- `AlreadyInitialized`: Called more than once
- `InvalidBotNft`: `bot_nft` does not respond to the bot NFT interface
- `InvalidPrice`: `fee_bps + royalty_bps` exceeds 10,000

---

### next_listing_id

```rust
pub fn next_listing_id(env: Env) -> u64
```

Return the ID that will be assigned to the next listing. This is the public enumeration cursor: paging through `get_listing` or `get_active_listings` works with listing IDs, not positional indexes. Returns `1` before any listing is created.

---

### config

```rust
pub fn config(env: Env) -> Result<Config, MarketplaceError>
```

Retrieve the marketplace configuration (admin, bot_nft address, fee_bps, royalty_bps).

Errors:
- `NotInitialized`: Marketplace not initialized

---

### admin

```rust
pub fn admin(env: Env) -> Result<Address, MarketplaceError>
```

Return the current admin address.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### bot_nft

```rust
pub fn bot_nft(env: Env) -> Result<Address, MarketplaceError>
```

Return the bot NFT contract the marketplace escrows and settles trades through.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### get_min_price

```rust
pub fn get_min_price(env: Env, currency: Address) -> i128
```

Return the minimum accepted price for `currency`. When the admin has not set an explicit floor with `set_min_price`, the default is `ceil(10_000 / fee_bps)` (or `1` when `fee_bps == 0`), which guarantees the platform fee rounds to at least one base unit. Panics if the marketplace is not initialized.

---

### set_min_price

```rust
pub fn set_min_price(
  env: Env,
  currency: Address,
  min_price: i128,
) -> Result<(), MarketplaceError>
```

Admin-only: set the minimum price for `currency`. `min_price` must be strictly positive. Emits `min_price(currency)` with `(old_min_price, new_min_price)`; the old value is `0` when no override existed.

Errors:
- `InvalidPrice`: `min_price` is zero or negative
- `NotInitialized`: Marketplace not initialized

---

### set_fee_bps

```rust
pub fn set_fee_bps(env: Env, new_fee_bps: u32) -> Result<(), MarketplaceError>
```

Admin-only: change the platform fee. The combined `new_fee_bps + royalty_bps` must stay within 10,000 basis points. Currencies without an explicit `set_min_price` override immediately derive their default minimum from the new fee. Emits `fee_bps_upd` with `(old_fee_bps, new_fee_bps)`.

Errors:
- `InvalidPrice`: `new_fee_bps + royalty_bps` exceeds 10,000
- `NotInitialized`: Marketplace not initialized

---

### set_royalty_bps

```rust
pub fn set_royalty_bps(env: Env, new_royalty_bps: u32) -> Result<(), MarketplaceError>
```

Admin-only: change the creator royalty without a redeploy. The combined `fee_bps + new_royalty_bps` must stay within 10,000 basis points, the same rule `initialize` and `set_fee_bps` enforce. Emits `royalty_bps_upd` with `(old_royalty_bps, new_royalty_bps)`.

Errors:
- `InvalidPrice`: `fee_bps + new_royalty_bps` exceeds 10,000
- `NotInitialized`: Marketplace not initialized

---

### get_listing_cap

```rust
pub fn get_listing_cap(env: Env) -> u32
```

Return the maximum number of active listings a single seller may hold (default `50`). Cancelled and completed listings do not count toward the cap.

---

### set_listing_cap

```rust
pub fn set_listing_cap(env: Env, new_cap: u32) -> Result<(), MarketplaceError>
```

Admin-only: set the per-seller active-listing cap. Applies to future `list_bot` calls; sellers already above the new cap are not evicted. Emits `listing_cap_upd` with `new_cap`.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### get_user_active_listing_count

```rust
pub fn get_user_active_listing_count(env: Env, seller: Address) -> u32
```

Return how many active listings `seller` currently holds. Returns `0` when the seller has never listed or holds none.

---

### list_bot

```rust
pub fn list_bot(
  env: Env,
  seller: Address,
  bot_id: u64,
  price: i128,
  currency: Address,
  duration_secs: u64,
) -> Result<u64, MarketplaceError>
```

Escrow a bot into the marketplace and create a listing. Requires authorization from `seller`.

- `bot_id`: The ID of the bot NFT to list
- `price`: Sale price in the specified currency (must be > 0 and at least the currency's minimum)
- `currency`: The token contract address for payment; must be allowlisted
- `duration_secs`: Listing lifetime, from 1 day (`86_400`) to 90 days (`7_776_000`)

Returns the new listing ID on success. The listing is escrowed until it sells, is cancelled, or expires.

Errors:
- `InvalidPrice`: Price is not strictly positive
- `InvalidExpiry`: `duration_secs` is outside 1 to 90 days
- `NotInitialized`: Marketplace not initialized
- `BotNotFound`: Bot does not exist
- `NotBotOwner`: Caller is not the bot's owner
- `PriceTooLow`: Price is below `get_min_price(currency)`
- `UnsupportedCurrency`: Currency is not allowlisted
- `TooManyListings`: Seller already holds the maximum number of active listings
- `BotTransferFailed`: Genuine escrow transfer failure
- `ContractPaused`: Marketplace is paused
- `Overflow`: Listing ID or listing count overflowed

---

### update_price

```rust
pub fn update_price(
  env: Env,
  seller: Address,
  listing_id: u64,
  new_price: i128,
) -> Result<(), MarketplaceError>
```

Change the price of an active listing. Requires authorization from the seller. The new price must satisfy the same rules as `list_bot` (positive and at least the currency minimum). Emits `price_upd(seller, listing_id)` with `(old_price, new_price)` and updates the tier's floor statistics.

Errors:
- `ListingNotFound`: Listing does not exist
- `Unauthorized`: Caller is not the listing seller
- `ListingNotActive`: Listing is no longer active
- `InvalidPrice`: `new_price` is zero or negative
- `PriceTooLow`: `new_price` is below `get_min_price(currency)`
- `ContractPaused`: Marketplace is paused
- `NotInitialized`: Marketplace not initialized

---

### cancel_listing

```rust
pub fn cancel_listing(
  env: Env,
  seller: Address,
  listing_id: u64,
) -> Result<(), MarketplaceError>
```

Cancel a listing and return the escrowed bot to the seller. Requires authorization from `seller`. This is the escape hatch and keeps working while the marketplace is paused. Emits `cancel(seller, listing_id)` with `bot_id`.

Errors:
- `ListingNotFound`: Listing does not exist
- `Unauthorized`: Caller is not the original seller
- `ListingNotActive`: Listing has already been cancelled or purchased
- `NotInitialized`: Marketplace not initialized
- `BotTransferFailed`: Failed to return the bot to seller

---

### reclaim_expired

```rust
pub fn reclaim_expired(env: Env, listing_id: u64) -> Result<(), MarketplaceError>
```

Permissionless: return an expired but still-active listing's escrowed bot to the original seller. Anyone may call it; the bot always goes to the seller, never the caller. Emits `reclaimed(seller, listing_id)` with `bot_id`.

Errors:
- `ListingNotFound`: Listing does not exist
- `ListingNotActive`: Listing is inactive or has not expired yet
- `NotInitialized`: Marketplace not initialized
- `BotTransferFailed`: Failed to return the bot to seller

---

### on_bot_moved

```rust
pub fn on_bot_moved(env: Env, bot_id: u64) -> Result<(), MarketplaceError>
```

Callback for the bot NFT contract, which must authorize the call. Deactivates any active listing for `bot_id` (for example when the bot is transferred outside a sale by an admin action). Does nothing when the bot has no listing. Emits `deactive(bot_id)` with the deactivated `listing_id`.

Errors:
- `NotInitialized`: Marketplace not initialized

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

Payment is split between the seller, the original minter's royalty when `royalty_bps` is set, and the platform fee. The fee is retained in the contract and tracked per currency; the admin withdraws it with `withdraw_fees` (#426). When the minter is the seller, the royalty stays with the seller instead of being paid out separately.

The bot is transferred to the buyer before any token leg; a failed token transfer aborts the whole invocation, so neither side can end up with both the bot and the funds. If the marketplace no longer owns the escrowed bot, the listing is marked inactive and `ListingStale` is returned before payment. Emits `sold(seller, buyer)` with `(listing_id, bot_id, price, currency)`.

Errors:
- `ListingNotFound`: Listing does not exist
- `SelfPurchase`: Buyer is the listing seller (cannot buy own listing)
- `ListingNotActive`: Listing is no longer active
- `ListingExpired`: Listing is past its `expires_at`
- `ContractPaused`: Marketplace is paused
- `UnsupportedCurrency`: The listing's currency is no longer allowlisted
- `ListingStale`: The marketplace no longer escrows the bot for this listing
- `NotInitialized`: Marketplace not initialized
- `Overflow`: Price calculation overflow
- `PaymentFailed`: Buyer does not have sufficient balance or payment failed
- `BotTransferFailed`: Failed to transfer bot to buyer

---

### get_listing

```rust
pub fn get_listing(env: Env, listing_id: u64) -> Result<Listing, MarketplaceError>
```

Retrieve the details of a specific listing. Historical listings (bought, cancelled or stale) remain readable with `active == false`; only an ID that was never assigned errors with `ListingNotFound`.

---

### get_listing_for_bot

```rust
pub fn get_listing_for_bot(env: Env, bot_id: u64) -> Result<u64, MarketplaceError>
```

Return the active listing ID for a bot, if one exists.

Errors:
- `ListingNotFound`: The bot is not listed, or its listing was cancelled, sold or expired

---

### get_active_listings

```rust
pub fn get_active_listings(
  env: Env,
  cursor: u64,
  limit: u32,
) -> (Vec<Listing>, u64)
```

Retrieve a page of active listings using listing-ID pagination.

- `cursor`: Listing ID to start after (`0` = start)
- `limit`: Maximum number of listings to return

Returns `(listings, next_cursor)`. The cursor is an ID, not a positional index, so it stays valid when listings are cancelled, sold or compacted mid-pagination. At most `limit * 4` index entries are examined per call, so a page may be short while tombstones are skipped; keep paging until the returned cursor equals the one passed in. `limit == 0` returns an empty vector and the unchanged cursor. Inactive, missing and stale listings (where the marketplace no longer owns the bot) are skipped.

---

### compact_page

```rust
pub fn compact_page(env: Env, page: u32) -> u32
```

Permissionless: remove tombstoned (inactive or missing) IDs from listing page `page`, so the slot count reflects live listings. Safe at any time because cursors are ID-based. Returns the number of IDs removed; returns `0` for a page that does not exist.

---

### listing_page_count

```rust
pub fn listing_page_count(env: Env) -> u32
```

Return the number of allocated listing pages. Each page holds at most `LISTING_PAGE_SIZE` (100) IDs.

---

### get_listings_filtered

```rust
pub fn get_listings_filtered(
  env: Env,
  tier: Option<BotTier>,
  min_price: Option<i128>,
  max_price: Option<i128>,
  cursor: u64,
  limit: u32,
) -> (Vec<Listing>, u64)
```

Bounded page of active listings matching an optional tier and inclusive price range.

- `tier`: Only return listings for this tier, or all tiers when `None`
- `min_price` / `max_price`: Inclusive bounds, or unbounded for that side when `None`
- `cursor`: Listing ID to start after (`0` = start)
- `limit`: Requested page size, capped at `50`

Returns `(listings, next_cursor)`; stop when the returned cursor equals the one passed in. At most `MAX_FILTER_SCAN` (200) index entries are examined per call, so a page may be short. Stale listings whose bot is no longer escrowed are skipped.

---

### get_user_listings

```rust
pub fn get_user_listings(env: Env, seller: Address) -> Vec<Listing>
```

Retrieve all listings created by a specific seller (both active and inactive), oldest first. Reads the whole history; use `get_user_listings_page` for bounded reads.

Returns an empty vector if the seller has no listings.

---

### get_user_listings_page

```rust
pub fn get_user_listings_page(
  env: Env,
  seller: Address,
  cursor: u32,
  limit: u32,
) -> (Vec<Listing>, Option<u32>)
```

Up to `limit` (capped at `MAX_HISTORY_PAGE_LIMIT`, 50) of the seller's listings, oldest first, starting at history index `cursor`. The second value is the cursor for the next page, or `None` once the history is exhausted.

---

### get_user_purchases

```rust
pub fn get_user_purchases(env: Env, buyer: Address, limit: u32) -> Vec<Purchase>
```

Return the buyer's most recent `limit` purchases, oldest first.

---

### get_user_purchases_page

```rust
pub fn get_user_purchases_page(
  env: Env,
  buyer: Address,
  cursor: u32,
  limit: u32,
) -> (Vec<Purchase>, Option<u32>)
```

Up to `limit` (capped at `MAX_HISTORY_PAGE_LIMIT`, 50) of the buyer's purchases, oldest first, starting at history index `cursor`. The second value is the cursor for the next page, or `None` once the history is exhausted.

---

### add_allowed_currency

```rust
pub fn add_allowed_currency(env: Env, currency: Address) -> Result<(), MarketplaceError>
```

Admin-only: add a token contract to the payment allowlist. Adding an already-allowed currency is a no-op returning `Ok(())`. The allowlist starts empty, so at least one currency must be added before any listing can be created. Emits `currency_added` with `currency`.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### remove_allowed_currency

```rust
pub fn remove_allowed_currency(env: Env, currency: Address) -> Result<(), MarketplaceError>
```

Admin-only: remove a token contract from the payment allowlist. Removing a currency that is not present is a no-op. Existing listings in that currency can no longer be bought or accepted (`UnsupportedCurrency`) until it is re-added. Emits `currency_removed` with `currency`.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### is_allowed_currency

```rust
pub fn is_allowed_currency(env: Env, currency: Address) -> bool
```

Return whether `currency` is currently allowlisted. Returns `false` before any currency is added.

---

### pause

```rust
pub fn pause(env: Env) -> Result<(), MarketplaceError>
```

Admin-only: pause trading. While paused, `list_bot`, `update_price`, `buy_bot`, `make_offer` and `accept_offer` fail with `ContractPaused`; `cancel_listing`, `cancel_offer` and `dismiss_offer` keep working so escrowed bots and funds can always be released. Emits `paused` with the admin address.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### unpause

```rust
pub fn unpause(env: Env) -> Result<(), MarketplaceError>
```

Admin-only: resume trading after `pause`. Emits `unpaused` with the admin address.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### is_paused

```rust
pub fn is_paused(env: Env) -> bool
```

Return whether the marketplace is currently paused. Returns `false` when it has never been paused.

---

### propose_admin

```rust
pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), MarketplaceError>
```

Step one of a two-step admin transfer: the current admin nominates `new_admin`. Nothing changes until the nominee calls `accept_admin`. Proposing again replaces the pending nomination. Emits `admin_proposed` with `(current_admin, pending_admin)`.

Errors:
- `NotInitialized`: Marketplace not initialized

---

### accept_admin

```rust
pub fn accept_admin(env: Env) -> Result<(), MarketplaceError>
```

Step two of an admin transfer: the nominated address accepts and becomes admin. Requires authorization from the pending admin. Clears the pending nomination and emits `admin_upd` with `(old_admin, new_admin)`.

Errors:
- `NotInitialized`: Marketplace not initialized
- `NoPendingAdmin`: No admin transfer is pending

---

### pending_admin

```rust
pub fn pending_admin(env: Env) -> Option<Address>
```

Return the address nominated by `propose_admin`, or `None` when no transfer is pending.

---

### set_bot_nft

```rust
pub fn set_bot_nft(env: Env, new_bot_nft: Address) -> Result<(), MarketplaceError>
```

Admin-only: point the marketplace at a new bot NFT contract. The new address is probed for the expected interface. Rejected while any listing still escrows a bot, because escrowed bots settle through the configured address (#912). Emits `bot_nft_upd` with `(old_nft, new_nft)`.

Errors:
- `NotInitialized`: Marketplace not initialized
- `ActiveListingsExist`: At least one listing still escrows a bot
- `InvalidBotNft`: `new_bot_nft` does not respond to the bot NFT interface

---

### tier_stats

```rust
pub fn tier_stats(env: Env, tier: BotTier) -> TierStats
```

Return cumulative sales statistics for one tier: total volume, sale count, last sale price and the current floor (lowest active listing price, `0` when none). All zeros before any activity. Volume and prices are raw base units summed across whatever currencies were used.

---

### market_stats

```rust
pub fn market_stats(env: Env) -> Vec<TierStats>
```

Return `tier_stats` for every tier, in tier order (`Basic`, `Bronze`, `Silver`, `Gold`, `Diamond`).

---

### make_offer

```rust
pub fn make_offer(
  env: Env,
  buyer: Address,
  bot_id: u64,
  amount: i128,
  currency: Address,
  expires_at: u64,
) -> Result<u64, MarketplaceError>
```

Escrow `amount` of `currency` from `buyer` as a standing offer for `bot_id`, open until `expires_at` (a ledger timestamp; the offer can no longer be accepted from that second on). The bot does not need to be listed. Requires authorization from `buyer`; blocked while paused. Returns the offer id. A bot carries at most `MAX_OFFERS_PER_BOT` (25) open offers, and an offer may be at most `MAX_OFFER_DURATION` (30 days) away.

Errors:
- `InvalidPrice`: `amount` is zero or negative
- `PriceTooLow`: `amount` is below the currency's minimum price (see `get_min_price`)
- `UnsupportedCurrency`: `currency` is not allowlisted
- `InvalidExpiry`: `expires_at` is not in the future, or is more than 30 days away
- `BotNotFound`: Bot does not exist
- `OfferOnOwnBot`: The buyer owns the bot, directly or through their own active listing
- `TooManyOffers`: The bot already has 25 open offers
- `PaymentFailed`: The escrow transfer from the buyer failed
- `ContractPaused`, `NotInitialized`
- `Overflow`: Offer ID overflow

---

### accept_offer

```rust
pub fn accept_offer(
  env: Env,
  seller: Address,
  offer_id: u64,
) -> Result<(), MarketplaceError>
```

Sell the bot to the offer's buyer at the offered amount. The bot moves to the buyer and the escrow is paid out in the same invocation: seller payout, minter royalty (unless the minter is the seller), and the platform fee, which is retained in the contract. The seller must own the bot outright or hold it in escrow through their own active listing, which is deactivated as part of the sale. Other open offers on the bot are left in place for their buyers to cancel or the owner to dismiss. Requires authorization from `seller`; blocked while paused. Emits `offer_acc(seller, buyer)` with `(offer_id, bot_id, amount)`.

Errors:
- `OfferNotFound`, `OfferNotActive`: No such offer, or it was already accepted or cancelled
- `OfferExpired`: `expires_at` has passed
- `SelfPurchase`: The seller is the offer's buyer
- `NotBotOwner`: The seller neither owns the bot nor has it listed
- `BotTransferFailed`, `PaymentFailed`, `Overflow`, `UnsupportedCurrency`, `ContractPaused`, `NotInitialized`

---

### cancel_offer

```rust
pub fn cancel_offer(
  env: Env,
  caller: Address,
  offer_id: u64,
) -> Result<(), MarketplaceError>
```

Cancel an open offer and refund its escrow in full to the buyer. Before `expires_at` only the buyer may cancel; from `expires_at` on anyone may call it (the refund still goes to the buyer), so abandoned escrow can be released by a keeper. Requires authorization from `caller`. Works while paused. Emits `offer_cxl(buyer, offer_id)` with `(bot_id, amount, expired)`.

Errors:
- `OfferNotFound`, `OfferNotActive`
- `NotOfferOwner`: Called before expiry by someone other than the buyer
- `PaymentFailed`: The refund transfer failed

---

### dismiss_offer

```rust
pub fn dismiss_offer(
  env: Env,
  caller: Address,
  offer_id: u64,
) -> Result<(), MarketplaceError>
```

Dismiss an open offer before expiry and refund its escrow in full to the buyer (#914). `caller` must be the bot's effective owner (its direct owner, or the seller of its active listing) or the admin, so an owner can clear unwanted offers that would otherwise occupy the bot's 25 offer slots until they expire. The refund never goes anywhere but the buyer. Requires authorization from `caller`; works while paused. Emits `offer_dsm(buyer, offer_id)` with `(bot_id, amount, caller)`.

Errors:
- `OfferNotFound`, `OfferNotActive`
- `Unauthorized`: Caller is neither the admin nor the bot's effective owner
- `PaymentFailed`: The refund transfer failed
- `NotInitialized`: Marketplace not initialized

---

### get_offer

```rust
pub fn get_offer(env: Env, offer_id: u64) -> Result<Offer, MarketplaceError>
```

One offer by id, whatever its status. Errors with `OfferNotFound`.

---

### get_offers_for_bot

```rust
pub fn get_offers_for_bot(env: Env, bot_id: u64) -> Vec<Offer>
```

Every open offer on `bot_id`, oldest first. Expired offers stay listed until cancelled, so compare `expires_at` with the ledger timestamp before acting on one.

---

### fees_accrued

```rust
pub fn fees_accrued(env: Env, currency: Address) -> i128
```

Platform fees collected in `currency` and not yet withdrawn. Escrowed offer funds are never part of this figure even though they sit in the same token balance.

---

### withdraw_fees

```rust
pub fn withdraw_fees(
  env: Env,
  currency: Address,
  to: Address,
  amount: i128,
) -> Result<(), MarketplaceError>
```

Admin-only. Transfer `amount` of accrued fees in `currency` to `to`. Bounded by `fees_accrued`, so a withdrawal can never touch escrowed offer funds. Emits `fees_wd(admin, to)` with `(currency, amount, remaining)`.

Errors:
- `InvalidAmount`: `amount` is zero or negative
- `InsufficientFees`: `amount` exceeds `fees_accrued(currency)`
- `PaymentFailed`, `NotInitialized`

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
  pub expires_at: u64,          // Ledger timestamp, inclusive deadline
}
```

Represents a bot listing in the marketplace. `expires_at` is bounded to 1–90 days after `listed_at`.

### Config

```rust
pub struct Config {
  pub admin: Address,
  pub bot_nft: Address,
  pub fee_bps: u32,
  pub royalty_bps: u32,
}
```

Marketplace configuration stored during initialization.

### Purchase

```rust
pub struct Purchase {
  pub listing_id: u64,   // 0 for a sale made by accepting an offer
  pub bot_id: u64,
  pub seller: Address,
  pub price: i128,
  pub currency: Address,
  pub purchased_at: u64,
}
```

One completed purchase, recorded for both `buy_bot` and `accept_offer`.

### TierStats

```rust
pub struct TierStats {
  pub tier: BotTier,
  pub volume: i128,          // Cumulative sale volume, raw base units
  pub sale_count: u64,
  pub last_sale_price: i128,
  pub floor_price: i128,     // 0 when nothing is listed
  pub floor_listing_id: u64, // 0 when nothing is listed
}
```

### Offer

```rust
pub struct Offer {
    pub id: u64,
    pub buyer: Address,
    pub bot_id: u64,
    pub amount: i128,      // escrowed, in currency base units
    pub currency: Address,
    pub created_at: u64,
    pub expires_at: u64,   // ledger timestamp, exclusive
    pub status: OfferStatus,
}

pub enum OfferStatus {
    Active,
    Accepted,
    Cancelled,
}
```

---

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `AlreadyInitialized` | 1 | Marketplace was already initialized |
| `NotInitialized` | 2 | Marketplace has not been initialized |
| `InvalidPrice` | 3 | Price must be strictly positive (also used for an invalid duration or fee split) |
| `BotTransferFailed` | 4 | Genuine escrow transfer failure |
| `ListingNotFound` | 5 | Listing does not exist |
| `NotSeller` | 6 | Caller is not the listing seller |
| `ListingInactive` | 7 | Listing is not active |
| `InsufficientFunds` | 8 | Buyer does not have enough currency |
| `ListingNotActive` | 9 | Listing is no longer active |
| `Unauthorized` | 10 | Caller is not authorized for this action |
| `PaymentFailed` | 11 | Payment transfer failed |
| `Overflow` | 12 | Arithmetic overflow occurred |
| `PriceTooLow` | 13 | Price is below the currency's minimum price |
| `ListingStale` | 14 | The marketplace no longer escrows the bot for this listing |
| `SelfPurchase` | 15 | Buyer is the listing seller |
| `TooManyListings` | 16 | Seller reached the per-seller active-listing cap |
| `InvalidBotNft` | 17 | The supplied bot NFT contract does not respond to the expected interface |
| `ContractPaused` | 18 | Trading is paused |
| `NoPendingAdmin` | 19 | No admin transfer is pending |
| `BotNotFound` | 20 | Bot does not exist |
| `NotBotOwner` | 21 | Caller is not the bot's owner (`list_bot`, `accept_offer`) |
| `Reentrancy` | 22 | A state-changing call re-entered the contract |
| `UnsupportedCurrency` | 23 | Currency is not allowlisted |
| `ListingExpired` | 24 | `buy_bot` on a listing past its `expires_at` |
| `InvalidExpiry` | 25 | Offer expiry is not in the future or is more than 30 days away |
| `OfferNotFound` | 26 | Offer does not exist |
| `OfferNotActive` | 27 | Offer was already accepted or cancelled |
| `OfferExpired` | 28 | `accept_offer` after the offer's expiry |
| `NotOfferOwner` | 29 | `cancel_offer` before expiry by someone other than the buyer |
| `OfferOnOwnBot` | 30 | `make_offer` on a bot the buyer owns or has listed |
| `TooManyOffers` | 31 | The bot already carries 25 open offers |
| `InvalidAmount` | 32 | `withdraw_fees` amount is zero or negative |
| `InsufficientFees` | 33 | `withdraw_fees` amount exceeds the accrued balance |
| `ActiveListingsExist` | 34 | `set_bot_nft` while any listing still escrows a bot |

---

## Events

The contract emits the following events:

- `initialized` with `(admin, bot_nft, fee_bps)`
- `listed(seller, listing_id)` with `(bot_id, price, currency)`
- `cancel(seller, listing_id)` with `bot_id`
- `sold(seller, buyer)` with `(listing_id, bot_id, price, currency)`
- `reclaimed(seller, listing_id)` with `bot_id`
- `price_upd(seller, listing_id)` with `(old_price, new_price)`
- `deactive(bot_id)` with `listing_id`
- `offered(buyer, offer_id)` with `(bot_id, amount, expires_at)`
- `offer_acc(seller, buyer)` with `(offer_id, bot_id, amount, currency)`
- `offer_cxl(buyer, offer_id)` with `(bot_id, amount, expired: bool)`
- `offer_dsm(buyer, offer_id)` with `(bot_id, amount, caller)`
- `fees_wd(admin, to)` with `(currency, amount, remaining)`
- `fee_bps_upd` with `(old_fee_bps, new_fee_bps)`
- `min_price(currency)` with `(old_min_price, new_min_price)`
- `bot_nft_upd` with `(old_nft, new_nft)`
- `listing_cap_upd` with `new_cap`
- `currency_added` with `currency`
- `currency_removed` with `currency`
- `paused` with the `admin` address
- `unpaused` with the `admin` address
- `admin_proposed` with `(current_admin, pending_admin)`
- `admin_upd` with `(old_admin, new_admin)`

---

## Fee Calculation

The platform fee and creator royalty are calculated in basis points of 10,000:
```
fee = price * fee_bps / 10_000
royalty = price * royalty_bps / 10_000
seller_payment = price - fee - royalty
```

For example, with a 250 basis point fee (2.5%) and a 500 basis point royalty (5%):
- Listing price: 1000 tokens
- Fee: (1000 * 250) / 10_000 = 25 tokens
- Royalty: (1000 * 500) / 10_000 = 50 tokens
- Seller receives: 925 tokens
- 25 tokens accrue to `fees_accrued(currency)` inside the contract, for the admin to withdraw with `withdraw_fees`

When the minter is the seller, the royalty is not paid out separately and is added back to the seller's payout. The same split applies to `accept_offer`, computed on the offered amount.
