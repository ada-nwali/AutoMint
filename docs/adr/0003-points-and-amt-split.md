# ADR 0003: Points And AMT Split

## Status

Accepted

## Context

AutoMint tracks user progress as points while also minting AMT tokens once a
configured conversion threshold is reached. Registry profiles keep total points
and claimed AMT for leaderboard and profile views. The token contract keeps AMT
balances and transfer approvals.

This split can look redundant because claiming touches both registry and token
state.

## Decision

Keep points and AMT in separate contracts. The registry is the source of truth
for user profile progress, total points, claimed AMT totals, bot counts, and
leaderboards. The token contract is the source of truth for transferable AMT
balances, allowances, minting, burning, and token metadata.

The accrual contract owns conversion math from pending points to AMT and updates
both contracts during claim. Cross-contract changes to point accounting, AMT
minting, or conversion thresholds require an ADR.

## Alternatives Considered

- Store points only in the token contract: This would couple non-transferable
  progress to transferable balances and make leaderboard state depend on token
  internals.
- Store AMT balances in the registry: This would duplicate token behavior and
  make token integrations harder.
- Store only AMT and derive points from token history: This would lose
  sub-threshold progress and make leaderboard reads depend on event replay.

## Consequences

- User progress and transferable value have clear, separate ownership.
- Claim flows must keep registry and token updates in sync.
- Integration tests should cover claims that mint AMT and claims below the AMT
  threshold.
