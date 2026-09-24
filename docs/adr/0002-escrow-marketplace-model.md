# ADR 0002: Escrow Marketplace Model

## Status

Accepted

## Context

Marketplace listings need to prove that a seller still controls the listed bot
when a buyer attempts purchase. If the bot remained in the seller account during
listing, the seller could transfer it away and leave a stale listing behind.

The current marketplace transfers listed bots to the marketplace contract address
and returns them on cancellation or transfers them to the buyer on purchase.

## Decision

Keep the escrow-based listing model. Creating a listing transfers the bot NFT to
the marketplace contract address. Buying a listing pays the seller and fee
recipient, marks the listing inactive, and transfers the escrowed bot to the
buyer. Cancelling a listing marks it inactive and transfers the escrowed bot back
to the seller.

Changes that alter the bot custody boundary between `bot_nft` and `marketplace`
require an ADR.

## Alternatives Considered

- Non-custodial listings: Simpler at listing time, but purchase would need to
  revalidate ownership and could fail after buyers have acted on stale listings.
- Approval-based custody: Closer to token allowance flows, but it adds another
  authorization surface to bot ownership and still needs expiry and revocation
  rules.
- Off-chain order book: Reduces contract storage, but it makes listing validity
  dependent on indexers or external services.

## Consequences

- Active listings represent bots the marketplace can actually deliver.
- Sellers temporarily lose direct control of a listed bot until sale or
  cancellation.
- Marketplace bugs can affect custody, so listing, purchase, and cancellation
  tests must cover ownership transitions.
