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
- `u64`/`u32` decode to JS `number`; **`i128`/`u128` decode to `bigint`** and
  are serialized as **decimal strings** in JSON/SQLite so no precision is lost.
- `Tier` (bot_nft) is a `#[contracttype]` enum **without** `#[repr(u32)]`, so it
  serializes as a **symbol** (`"Basic"`, `"Advanced"`, `"Premium"`).
- Only events where `inSuccessfulContractCall == true` are indexed — events
  from reverted/failed calls are skipped.

## Registry contract

| Event | Topics (after name) | Data | Emitted in |
|-------|---------------------|------|-----------|
| `register` | `[user: Address]` | `timestamp: u64` | `register()` |
| `addpoints` | `[user: Address]` | `points: u64` | `add_points()` (cross-contract) |
| `dec_bot` | `[user: Address]` | `bot_count: u32` | `decrement_bot_count()` |

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
| `listed` | `[seller: Address, listing_id: u64]` | `(bot_id: u64, price: i128)` | `list_bot()` |
| `cancelled` | `[seller: Address, listing_id: u64]` | `bot_id: u64` | `cancel_listing()` |
| `bought` | `[buyer: Address, listing_id: u64]` | `(bot_id: u64, price: i128)` | `buy_bot()` |

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
| Volume | marketplace `bought` | Σ `price` (i128) |
| Floor price | marketplace `listed`/`bought`/`cancelled` | min `price` over listings whose latest event is `listed` (status `active`) |

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
  event does **not** include `bot_tier` or `currency`; the indexer stores
  `bot_tier = NULL` in the `listings` table. If AM-099 adds tier/currency to
  the event, extend `insertListingStmt` in `indexer/src/db.ts`.
- **AM-124 (unknown):** unresolved; assumed no fee fields are emitted. Note
  that the marketplace `bought` event carries only `(bot_id, price)` — the
  2.5% fee and seller payment are **not** in the event, so the "fee bug"
  question (AM-006) **cannot** be answered from events alone today. Confirming
  whether AM-124 adds fee fields (or whether the fee should be computed from
  `price`) is required before adding a fee-anomaly aggregate.

These are the exact items to confirm with the contract owners before this
indexer is considered complete for production.

