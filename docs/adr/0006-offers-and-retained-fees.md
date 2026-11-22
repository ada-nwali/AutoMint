# ADR 0006: Offers and Retained Marketplace Fees

## Status

Accepted

## Context

The marketplace was listing-only: a bot could change hands only when its
owner listed it and a buyer paid the asking price. Buyers had no way to
signal a price on an unlisted or overpriced bot, which halves the liquidity
of a peer-to-peer market.

At the same time every sale forwarded the platform fee to the admin address
inside `buy_bot`. Once the contract holds escrowed offer funds, that pattern
becomes dangerous: any withdrawal path has to distinguish fees the platform
owns from deposits it merely custodies, and a token sent to the contract by
mistake had no way out at all.

## Decision

Offers are escrowed bids. `make_offer` pulls the offered amount from the
buyer into the marketplace and records an `Offer` with an expiry.
`accept_offer` moves the bot to the buyer and pays the escrow out in one
invocation: seller payout, minter royalty, and the platform fee. The bot may
be in the seller's wallet or already escrowed under the seller's own active
listing; in the second case the listing is deactivated as part of the sale.
`cancel_offer` refunds the escrow in full; before expiry only the buyer may
cancel, after expiry anyone may, so abandoned escrow never depends on the
buyer returning. An offer on a bot the buyer already owns, directly or through
their own listing, is rejected.

Platform fees are no longer forwarded per sale. `buy_bot` and `accept_offer`
add the fee to a per-currency ledger, `DataKey::Fees(currency)`, and the admin
withdraws from it with `withdraw_fees`, bounded by `fees_accrued`. Escrowed
offer funds sit in the same token balance but are never part of that ledger,
so a withdrawal cannot touch them.

This changes the custody boundary described in ADR 0002: the marketplace now
custodies tokens (offer escrow and accrued fees) as well as bots, and a bot
can leave the seller's wallet through `accept_offer` without ever being
listed.

## Alternatives Considered

- Approval-based offers (no escrow, check the buyer's balance at acceptance):
  cheaper for buyers, but an offer could be accepted into a wallet that no
  longer holds the funds, so acceptance would fail after the seller acted.
- Keep forwarding fees per sale and expose a generic `sweep(token)`: simpler,
  but a sweep cannot tell fees from escrow, which is exactly the failure the
  issue calls out.
- Auto-refund expired offers inside other calls: hides gas costs in unrelated
  operations and makes their failure modes harder to reason about; explicit,
  permissionless cancellation keeps each call's effects local.

## Consequences

- The contract's token balance is now the sum of accrued fees plus open offer
  escrow; operators should reconcile it against `fees_accrued` plus the open
  offers, not treat the whole balance as revenue.
- Fee revenue reaches the admin only through `withdraw_fees`, which emits an
  event for every withdrawal.
- Offer, acceptance, cancellation and withdrawal tests must cover the custody
  transitions for both bots and tokens, including the listed-bot case.
