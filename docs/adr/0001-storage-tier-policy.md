# ADR 0001: Storage Tier Policy

## Status

Accepted

## Context

AutoMint stores different kinds of contract state with different durability
requirements. Token balances, bot ownership, user profiles, and accrual state
must survive beyond short interactions. Allowances, however, are deliberately
short-lived approvals tied to an expiration ledger.

Contributors have questioned why allowances live in temporary storage while the
rest of the token state uses persistent or instance storage.

## Decision

Use temporary storage for token allowances and preserve the explicit
`expiration_ledger` check. Use persistent storage for per-user and per-bot state,
including balances, profiles, bots, and accrual records. Use instance storage for
contract-wide configuration and initialization markers.

Cross-contract changes that alter storage tier, TTL policy, or expiration
semantics require a new ADR or an update to this one.

## Alternatives Considered

- Persistent allowances: This would make approvals durable, but it increases
  long-term state growth for records that are naturally temporary.
- Instance storage for all state: This would avoid per-key storage decisions, but
  it would mix global configuration with user-owned records and make pruning
  harder to reason about.
- No stored allowances: This would force direct transfers only and would prevent
  marketplace flows that need delegated token movement.

## Consequences

- Allowances expire naturally and do not become permanent state obligations.
- Contract code must keep checking expiration before returning or spending an
  allowance.
- Any feature that relies on long-lived approvals must explicitly redesign this
  policy before implementation.
