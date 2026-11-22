# ADR 0007: Registry Observability — Complete Events, Seasons, Display Names

## Status

Accepted

## Context

The registry is the most-called contract in the system (every claim credits
points; every mint/burn touches bot counts), yet it was the least observable:
only three event types (`register`, `addpoints`, `dec_bot`) left ten mutating
entry points silent. Indexers could not see admin transfers (AM-031's
`set_admin`/`accept_admin`/`cancel_admin_transfer`), could not total claimed
`$AMT` per user (`add_claimed_amt`), and had no signal when writers were
reconfigured. Two internal ticket IDs cited as event-coverage requirements
(`AM-014`, `AM-043`) do not exist anywhere in the repository, so the coverage
list had to be derived from the contract source itself (#370).

Two product gaps travelled with the observability gap. The leaderboard was a
single all-time board — seasonal campaigns had nothing to rank against (#371).
And usernames were stored exactly as typed with case-sensitive uniqueness, so
`Alice` and `alice` could both exist and every UI showed the raw stored
string with no canonical display casing (#373).

## Decision

**Every state-changing registry entry point publishes exactly one event**,
using the existing topic style `(symbol_short!(name), indexed_address?)`.
Zero-amount/zero-point calls are no-ops and publish nothing, so an indexer
never has to discard zero-value events. The full table (eleven events:
`init`, `register`, `writers`, `addpoints`, `inc_bot`, `dec_bot`, `claimed`,
`newseason`, `set_admin`, `adm_acpt`, `adm_cncl`) is the contract of record
in `docs/contracts/registry.md` §Events and `indexer/docs/EVENTS.md`.

**Seasons are counters plus shadow boards, not resets.** `DataKey::Season`
(instance) holds the current season number; season `0` is in effect until the
first admin `start_new_season`, which rolls the counter and starts the next
season from an empty board. Each season has its own bounded top-N board at
`DataKey::SeasonTop(season)` — same `Vec<(Address, u64)>` shape and
`LEADERBOARD_SIZE` bound as the lifetime `TopUsers` — and each user's season
earnings live in persistent `DataKey::SeasonPoints(season, user)`, renewed on
every `add_points` just like the lifetime profile. Lifetime totals, the
lifetime board, and every completed season's data remain queryable forever via
`get_season` / `get_leaderboard_for_season(season, limit)`, which returns
`SeasonEntry { address, display_name, season_points, total_points }` rows so
a UI can render both numbers in one call.

**Usernames split into a key and a label.** `UserProfile` gains
`display_name` — the casing the user typed, preserved verbatim — while
`username` becomes the ASCII-lowercased uniqueness key. `register`
lowercases once (ASCII-only, so the comparison is deterministic across
hosts) and checks the `Username` map against that form, rejecting mixed-case
duplicates. The leaderboard, batch profile lookups, and every event payload
expose `display_name`.

## Alternatives Considered

- **Emit the missing events only in cross-contract wrappers**: rejected —
  the wrapper cannot observe e.g. `accept_admin`'s internal state change, so
  coverage would stay partial.
- **Season boards as a separate season contract**: rejected — every
  `add_points` would pay an extra cross-contract call to maintain the board;
  keeping the shadow board inside the registry makes the season credit one
  storage write in the call that already holds the profile.
- **Resetting the single leaderboard on a new season**: rejected — destroys
  the all-time ranking the rest of the product (dashboard, pins, `get_rank`)
  depends on.
- **Overwriting `username` in place to normalize casing**: rejected —
  on-chain renames break every stored `Username` mapping and any UI that has
  cached the string; a second field is additive and cheap.

## Consequences

- The indexer's `EVENT_NAMES`, `docs/EVENTS.md`, and `decode.test.ts` must
  change together with the registry's publish calls — the existing contract
  between EVENTS.md and decode tests now covers all eleven events.
- `set_admin`'s registry payload is a `(current, pending)` tuple while the
  token contract's same-named event still publishes only the new admin; the
  event tables call this out explicitly so downstream parsers dispatch on
  contract address, not event name alone.
- Each season costs one instance-storage board (≤ 100 entries) plus one
  persistent `u64` per active user per season; historical seasons cost
  storage but no writes once closed.
- No state migration: the pre-`display_name` testnet data keeps
  `display_name == username` semantics via the parser fallback in the
  frontend (`parseUserProfile` treats an absent `display_name` as the
  normalized username); re-initialize testnet deployments if case-normalized
  uniqueness over old registrations is required.
- `AM-014`/`AM-043` remain unresolvable; the event tables are grounded in
  `env.events().publish` calls in the contract source instead.
