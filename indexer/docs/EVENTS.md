# AutoMint Event Schemas — Indexer Contract

This document is the **contract between the on-chain AutoMint contracts and the
indexer** (`indexer/`, issue #563). Every event type listed here is decoded,
persisted, and aggregated by the indexer. If a contract changes an event's
shape, this document and `indexer/src/__tests__/decode.test.ts` must change
together.

The indexer listens to events from the **five deployed contracts**:

| Contract    | Contract ID source                                                  |
| ----------- | -------------------------------------------------------------------- |
| `registry`  | `deployments/<network>.json` → `.contracts.registry.contract_id`     |
| `bot_nft`   | same, `.contracts.bot_nft.contract_id`                               |
| `accrual`   | same, `.contracts.accrual.contract_id`                               |
| `marketplace` | same, `.contracts.marketplace.contract_id`                         |
| `token`     | same, `.contracts.token.contract_id`                                 |

## Representation notes

- Every event is published with `env.events().publish(topics_tuple, data)`.
  The first topic is always a `symbol` — the event name. The remaining topics
  are indexed as `topics[1..]`; the value is the `data` payload.
- `Address` topics/payloads decode to their StrKey string (`G...`/`C...`).
- `u32` decodes to JS `number`; `u64`, `i128`, and `u128` decode to `bigint`
  and are serialized as **decimal strings** in JSON/SQLite. Listing and bot IDs
  remain text in the derived SQLite table; conversions to JS numbers reject
  values outside the safe-integer range.
- `Tier` (bot_nft) is a `#[contracttype]` enum **without** `#[repr(u32)]`, so it
  serializes as a **symbol** (`"Basic"`, `"Advanced"`, `"Premium"`).
- Only events where `inSuccessfulContractCall == true` are indexed — events
  from reverted/failed calls are skipped.

## Registry contract

Every state-changing registry entry point publishes exactly one event
(#370–#373). Zero-amount/zero-point calls are no-ops and publish **no** event.

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `init` | `[admin: Address]` | `timestamp: u64` | `initialize()` |
| `register` | `[user: Address]` | `timestamp: u64` | `register()` |
| `writers` | *(none)* | `(accrual: Address, bot_nft: Address)` | `set_writers()` |
| `addpoints` | `[user: Address]` | `points: u64` | `add_points()` (cross-contract) |
| `inc_bot` | `[user: Address]` | `bot_count: u32` | `increment_bot_count()` |
| `dec_bot` | `[user: Address]` | `bot_count: u32` | `decrement_bot_count()` |
| `claimed` | `[user: Address]` | `amount: i128` (decimal string in JSON) | `add_claimed_amt()` (#370) |
| `newseason` | *(none)* | `season: u32` | `start_new_season()` (#371) |
| `set_admin` | *(none)* | `(current_admin: Address, new_admin: Address)` | `set_admin()` (two-step, #372) |
| `adm_acpt` | *(none)* | `(current_admin: Address, pending: Address)` | `accept_admin()` (#372) |
| `adm_cncl` | *(none)* | `(current_admin: Address, pending: Address)` | `cancel_admin_transfer()` (#372) |

Note the registry's `set_admin` payload is a **two-address tuple** (current →
pending); the token contract's own `set_admin` (below) still publishes only the
new admin — same event name, different contracts.

## Bot NFT contract

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `mint` | `[owner: Address]` | `(bot_id: u64, tier: Symbol)` | `mint_basic()` (`"Basic"`), `mint_tier()` (`"Basic"`/`"Advanced"`/`"Premium"`) |
| `transfer` | `[from: Address, to: Address]` | `bot_id: u64` | `transfer()` |

## Accrual contract

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `start` | `[user: Address]` | `timestamp: u64` | `start_accrual()` |
| `mint` | `[user: Address]` | `amt_minted: i128` | `claim()` (only when AMT was minted) |
| `claim` | `[user: Address]` | `(pending: u64, remaining_points: u64)` | `claim()` |

## Marketplace contract

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `listed` | `[seller: Address, listing_id: u64]` | `(bot_id: u64, price: i128, currency: Address)` | `list_bot()` |
| `price_upd` | `[seller: Address, listing_id: u64]` | `(old_price: i128, new_price: i128)` | `update_price()` |
| `sold` | `[seller: Address, buyer: Address]` | `(listing_id: u64, bot_id: u64, price: i128, currency: Address)` | `buy_bot()` |
| `cancel` | `[seller: Address, listing_id: u64]` | `bot_id: u64` | `cancel_listing()` |
| `offered` | `[buyer: Address, offer_id: u64]` | `(bot_id: u64, amount: i128, expires_at: u64, currency: Address)` | `make_offer()` |
| `reclaimed` | `[seller: Address, listing_id: u64]` | `bot_id: u64` | `reclaim_expired()` |
| `deactive` | `[bot_id: u64]` | `listing_id: u64` | `on_bot_moved()` (bot transferred out of escrow) |

`listed`, `sold`, and `offered` carry the `currency` so volume, offer amounts, and floor price
are kept per currency. Prices in different tokens are never summed.

## Token (AMT) contract

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `approve` | `[from: Address, spender: Address]` | `(amount: i128, expiration_ledger: u32)` | `approve()` |
| `burn` | `[from: Address]` | `amount: i128` | `burn()` |
| `mint` | `[to: Address]` | `amount: i128` | `mint()` (admin) |
| `set_admin` | *(none)* | `new_admin: Address` | `set_admin()` |
| `transfer` | `[from: Address, to: Address]` | `amount: i128` | `transfer()` / `transfer_from()` |

## Aggregate mapping

| Aggregate | Derived from | Definition |
|-----------|--------------|------------|
| Users | registry `register` | distinct `user` address |
| Claims | accrual `claim` | count of `claim` events (optionally per day) |
| AMT minted | token `mint` | Σ `amount` (i128) |
| Volume (per currency) | marketplace `sold` | Σ `price` (i128), grouped by `currency` |
| Floor price (per currency) | marketplace `listed`/`price_upd`/`sold`/`cancel`/`reclaimed`/`deactive` | min `price` over listings with status `active`, grouped by `currency` |

## Known limitations & unresolved dependencies (AM-030/AM-053/AM-099/AM-124)

These four internal ticket IDs could **not** be resolved from the repository
(no `TICKETS.md`, no references in commits, PRs, or code). The indexer was
therefore built against the **actual event emissions in the current contract
source** (the verifiable ground truth above) and documented here explicitly.

Assumptions made in place of the missing ticket context:

- **AM-030 (likely: contract event-schema stability):** assumed the current
  `symbol_short` event names and topic/data layouts are stable. If AM-030
  calls for canonicalizing/renaming events, the decode layer
  (`indexer/src/events.ts`) and this document must be updated together.
- **AM-053 (unknown):** assumed no additional event types exist beyond those
  in this document. A full audit against every `env.events().publish` call in
  the contract sources was performed and matched.
- **AM-099 (unknown — possibly listing metadata):** the marketplace `listed`
  event does **not** include `bot_tier`; the indexer stores `bot_tier = NULL`
  in the `listings` table. `currency` is now part of `listed` and `sold`.
- **AM-124 (unknown):** unresolved; assumed no fee fields are emitted. Note
  that the marketplace `sold` event carries only `(listing_id, bot_id, price,
  currency)` — the
  2.5% fee and seller payment are **not** in the event, so the "fee bug"
  question (AM-006) **cannot** be answered from events alone today. Confirming
  whether AM-124 adds fee fields (or whether the fee should be computed from
  `price`) is required before adding a fee-anomaly aggregate.

These are the exact items to confirm with the contract owners before this
indexer is considered complete for production.
