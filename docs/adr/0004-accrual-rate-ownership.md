# ADR 0004: Accrual Rate Ownership

## Status

Accepted

## Context

Bots define tiers and rates, while accrual records store the rate used for a
user's active accrual session. Contributors have asked whether accrual should
derive the rate from the bot contract every time or persist the rate in accrual
state.

The current code lets accrual store a rate at `start_accrual` time and later uses
that stored rate to compute pending points.

## Decision

Treat bot tiers as the source of default earning rates and accrual records as
the owner of the active earning rate once accrual has started. The accrual
contract computes pending points from the stored session rate and timestamp.

Any issue that changes rate ownership across `bot_nft`, `accrual`, or
`registry` must include an ADR.

## Alternatives Considered

- Derive rate from owned bots on every claim: This keeps rates current, but it
  requires more cross-contract reads and makes historical accrual sensitive to
  later bot transfers or tier changes.
- Store rates only in the bot contract: This removes duplication, but it makes
  accrual state dependent on bot availability and ownership at claim time.
- Let the frontend calculate rates: This would weaken contract-level accounting
  and allow clients to disagree.

## Consequences

- Accrual calculations are stable for a started session.
- Rate changes or bot transfers do not automatically rewrite existing accrual
  sessions.
- Future tier upgrade work must define whether existing sessions keep their
  stored rate or restart with a new one.
