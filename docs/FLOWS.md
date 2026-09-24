# Contract Interaction Flows

This document illustrates the cross-contract call sequences for the four core AutoMint flows: **register**, **claim**, **list**, and **buy**. Contract names match the crates under [`contracts/`](../contracts): `registry`, `bot_nft`, `accrual`, `marketplace`, `token`.

For testnet end-to-end manual verification steps and evidence capture, see [`MANUAL_TEST_REPORT.md`](./MANUAL_TEST_REPORT.md).

## Register

A new user creates a profile in the Registry, then starts their point-accrual clock.

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant Registry
    participant BotNFT as Bot NFT
    participant Accrual

    User->>FE: Connect wallet & submit username
    FE->>Registry: register(user, username)
    Registry-->>Registry: validate username (length, uniqueness)
    Registry-->>FE: Ok / UsernameTaken / AlreadyRegistered
    FE->>BotNFT: get_user_total_rate(user)
    BotNFT-->>FE: rate (0 if no bots yet)
    FE->>Accrual: start_accrual(user, rate)
    Accrual-->>Accrual: store last_claim_ts = now
    Accrual-->>FE: Ok / AlreadyStarted
    FE-->>User: Registration complete
```

## Claim

A user claims accrued points, which are credited to the Registry and, once enough points have accumulated, minted as AMT via the Token contract.

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant Accrual
    participant Registry
    participant Token as AMT Token

    User->>FE: Click "Claim"
    FE->>Accrual: pending_points(user)
    Accrual-->>FE: pending (read-only)
    FE->>Accrual: claim(user, token_contract, registry)
    Accrual-->>Accrual: compute elapsed points since last_claim_ts
    Accrual->>Registry: add_points(user, pending)
    Registry-->>Accrual: Ok / NotRegistered
    alt updated_points >= points_per_amt
        Accrual->>Token: mint(user, amt_to_mint)
        Token-->>Accrual: Ok
        Accrual->>Registry: add_claimed_amt(user, amt_to_mint)
        Registry-->>Accrual: Ok
    end
    Accrual-->>Accrual: reset last_claim_ts, carry remainder points
    Accrual-->>FE: points_claimed
    FE-->>User: Show updated balance
```

## List

A user escrows a Bot NFT into the Marketplace contract and creates a listing.

```mermaid
sequenceDiagram
    actor Seller
    participant FE as Frontend
    participant Marketplace
    participant BotNFT as Bot NFT

    Seller->>FE: Choose bot & set price
    FE->>Marketplace: list_bot(seller, bot_id, price, currency)
    Marketplace-->>Marketplace: validate price > 0
    Marketplace->>BotNFT: get_bot(bot_id)
    BotNFT-->>Marketplace: BotNFT { tier, owner, ... }
    Marketplace->>BotNFT: transfer(bot_id, seller, marketplace)
    BotNFT-->>BotNFT: verify seller == owner
    BotNFT-->>Marketplace: Ok / NotOwner / BotNotFound
    Marketplace-->>Marketplace: store Listing, push to ActiveListings
    Marketplace-->>FE: listing_id
    FE-->>Seller: Listing created
```

## Buy

A buyer purchases an active listing; payment is split between the seller and the marketplace fee recipient, and the bot is transferred out of escrow.

```mermaid
sequenceDiagram
    actor Buyer
    participant FE as Frontend
    participant Marketplace
    participant Token as Currency Token
    participant BotNFT as Bot NFT

    Buyer->>FE: Click "Buy" on a listing
    FE->>Marketplace: buy_bot(buyer, listing_id)
    Marketplace-->>Marketplace: load listing, verify active & buyer != seller
    Marketplace-->>Marketplace: compute fee (2.5%) and seller_payment
    Marketplace->>Token: transfer(buyer, seller, seller_payment)
    Token-->>Marketplace: Ok / PaymentFailed
    opt fee > 0
        Marketplace->>Token: transfer(buyer, admin, fee)
    end
    Marketplace->>BotNFT: transfer(bot_id, marketplace, buyer)
    BotNFT-->>Marketplace: Ok / BotTransferFailed
    Marketplace-->>Marketplace: mark listing inactive, remove from ActiveListings
    Marketplace-->>FE: Ok
    FE-->>Buyer: Bot transferred, listing closed
```
