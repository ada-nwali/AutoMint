# ADR 0005: Admin And Upgrade Strategy

## Status

Accepted

## Context

The contracts use explicit initialization and admin addresses for privileged
actions such as token minting and configuration ownership. Some contracts expose
admin reads or transfer functions, while upgrades are not centrally documented.

Without a shared admin and upgrade strategy, contributors can add privileged
entrypoints inconsistently or skip initialization guards.

## Decision

Every contract must guard initialization with an initialized marker or equivalent
state check. Privileged actions must authenticate the current admin before
changing admin-controlled state. Cross-contract addresses set during
initialization are treated as deployment configuration and must not be changed
without a documented migration or ADR.

Upgrade or migration work must document:

- which contract state is preserved,
- which admin authorizes the change,
- which cross-contract addresses change, and
- how tests prove old and new state remain compatible.

## Alternatives Considered

- Immutable contracts with no admin: This minimizes privileged access but blocks
  operational fixes while the testnet implementation is still evolving.
- A single global admin registry: This centralizes authority, but it adds another
  dependency to every contract and becomes a single point of failure.
- Per-function ad hoc authorization: This is flexible, but it makes audits and
  contributor review harder.

## Consequences

- Admin behavior stays predictable across contracts.
- Initialization guards are mandatory for privileged or config-dependent
  functions.
- Any future upgrade path must be reviewed as a cross-contract decision instead
  of an isolated code change.
