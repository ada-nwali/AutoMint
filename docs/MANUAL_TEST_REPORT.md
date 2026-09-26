# AutoMint Testnet Manual Test Report

Target branch: `testnet-implementation`

This report captures the end-to-end manual verification steps for the core AutoMint testnet flows. Record the wallet address, transaction hashes, observed balances, and screenshots in the PR that updates this file.

## Environment

- Network: Stellar testnet
- Frontend URL: `<deployed testnet frontend URL>`
- Wallet: `<wallet name and public key>`
- Registry contract: `<contract ID>`
- Bot NFT contract: `<contract ID>`
- Accrual contract: `<contract ID>`
- Marketplace contract: `<contract ID>`
- AMT token contract: `<contract ID>`

## Registration

Issue: #206

1. Open the testnet frontend and connect the test wallet.
2. Register a unique username.
3. Confirm the registration transaction succeeds.
4. Open the dashboard or profile page.
5. Verify a free Basic Bot appears in the user's bot inventory.
6. Verify the accrual timer or pending-points display starts from the registration timestamp.

Expected result:

- The wallet is marked registered.
- The username is shown for the connected account.
- A Basic Bot is visible in the user's owned bots.
- Accrual begins without requiring a paid bot purchase.

Evidence to attach:

- Registration transaction hash
- Screenshot of registered profile/dashboard
- Screenshot or log showing Basic Bot ownership
- Screenshot or log showing accrual state

## Claim

Issue: #207

1. Use a registered account with active accrual.
2. Wait long enough for points to accrue.
3. Record the current AMT token balance and pending points.
4. Trigger the claim action.
5. Confirm the claim transaction succeeds.
6. Refresh dashboard/account state.
7. Verify the AMT balance increases when the claim crosses the mint threshold.
8. Verify pending points reset or carry only the expected remainder.

Expected result:

- Claim succeeds for a registered user with accrued points.
- Registry points are updated.
- AMT balance increases when claimable points meet the configured conversion threshold.
- Accrual timestamp resets after claim.

Evidence to attach:

- Claim transaction hash
- AMT balance before and after
- Pending points before and after
- Screenshot of success state

## Mint Tier Bot

Issue: #208

1. Open the marketplace page as a registered user.
2. Choose a paid tier: Bronze, Silver, Gold, or Diamond.
3. Record the user's current bot inventory and total accrual rate.
4. Buy the selected tier bot.
5. Confirm the purchase/mint transaction succeeds.
6. Open "My Bots".
7. Verify the purchased bot appears with the correct tier.
8. Verify total accrual rate increases by the selected tier's configured rate.

Expected result:

- Purchase transaction succeeds.
- The selected tier bot appears under "My Bots".
- The user's total rate reflects Basic Bot plus the new tier rate.
- Marketplace purchase state does not leave a duplicate pending item.

Evidence to attach:

- Purchase transaction hash
- Selected tier and price
- Bot inventory before and after
- Total accrual rate before and after

## List Bot For Sale

Issue: #209

1. Open "My Bots" as a registered user who owns a non-basic bot.
2. Select an owned bot and enter a non-zero sale price.
3. Submit the listing.
4. Confirm the list transaction succeeds.
5. Open "My Listings".
6. Verify the listed bot appears with the expected price and active status.
7. Verify the bot is escrowed by checking it can no longer be listed again by the seller while active.
8. Open the marketplace page from another session or refresh and verify the listing is visible.

Expected result:

- Listing transaction succeeds.
- The selected bot is escrowed by the marketplace.
- "My Listings" shows exactly one active listing for the bot.
- Public marketplace inventory includes the listing.

Evidence to attach:

- Listing transaction hash
- Bot ID, tier, and price
- Screenshot of "My Listings"
- Screenshot or contract read proving escrow/active listing state

## Buy Listed Bot

Issue: #210

Requires **two** funded testnet accounts: Account A (seller, already holds an active listing from the "List Bot For Sale" flow above) and Account B (buyer). Account B must be registered and must hold enough of the listing's `currency` token to cover the full price.

### Preparation

1. Complete "List Bot For Sale" as Account A and record the `listing_id`, `bot_id`, `bot_tier`, `price`, and `currency`.
2. Connect Account B in a separate browser profile or after disconnecting Account A. Register Account B if it is not already registered.
3. Fund Account B with the payment token. If `currency` is the AMT token, the deployer/admin must mint to Account B:
   ```bash
   stellar contract invoke --id "$TOKEN_ID" --source "$DEPLOYER" --network testnet \
     -- mint --to <ACCOUNT_B_ADDRESS> --amount <PRICE_IN_STROOPS>
   ```

### Record before the purchase

| Value | How to read it |
|---|---|
| Account B token balance | `Token::balance --id <ACCOUNT_B>` |
| Account A (seller) token balance | `Token::balance --id <ACCOUNT_A>` |
| Admin token balance | `Token::balance --id <ADMIN_ADDRESS>` |
| Bot owner | `BotNFT::get_bot --bot_id <BOT_ID>` — owner must be the **marketplace contract** (escrow) |
| Listing state | `Marketplace::get_listing --listing_id <ID>` — `active: true` |
| Account B bot list | `BotNFT::get_user_bots --user <ACCOUNT_B>` |

### Steps

1. Open the marketplace page as Account B.
2. Verify Account A's listing is visible with the expected bot tier and price.
3. Click buy on that listing and approve the transaction in the wallet.
4. Confirm the transaction succeeds and record the transaction hash.
5. Refresh the marketplace page.
6. Open "My Bots" as Account B.
7. Re-read every value from the table above.

### Expected result

- The purchase transaction succeeds.
- **Bot transfer**: `get_bot(bot_id).owner` is now Account B, and `get_user_bots(Account B)` includes `bot_id`.
- **Payment**: Account B's balance decreases by the full `price`; Account A's balance increases by `price - fee`; the admin balance increases by `fee`, where `fee = price * 25 / 1000` (2.5%, `fee_bps = 250`).
- The listing is now `active: false` and no longer appears in `get_active_listings` or on the public marketplace page.
- A `bought` event was emitted with topics `(buyer, listing_id)` and data `(bot_id, price)`.

### Negative cases to confirm

| Case | Expected error |
|---|---|
| Account A tries to buy its own listing | `Unauthorized` (error 10) — sellers cannot buy back through this flow |
| Buying the same listing a second time | `ListingNotActive` (error 9) |
| Buyer holds less than `price` | Purchase reverts; **no** bot transfer occurs and no balances change |

> Note the ordering in `Marketplace::buy_bot`: the NFT moves before payment, and a failed seller payment reverts the whole transaction (including the NFT transfer). The 2.5% admin fee transfer is the one call whose failure is deliberately swallowed — if the admin fee does not arrive but buyer and seller settle correctly, that is expected behaviour, not a bug. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#ordering--failure-semantics-of-buy_bot).

> `buy_bot` does not adjust Registry bot counts. Do **not** treat an unchanged `bot_count` on either account as a failure of this flow.

### Evidence to attach

- Purchase transaction hash
- `listing_id`, `bot_id`, tier, `price`, and computed `fee`
- Buyer / seller / admin token balances before and after
- `get_bot(bot_id)` owner before (marketplace) and after (buyer)
- Screenshot of Account B's "My Bots" showing the purchased bot
- Screenshot of the marketplace with the listing gone

---

## Leaderboard Refresh

Issue: #211

Requires **at least three** registered, funded testnet accounts so that ranking order can be shown to change, not merely to exist.

### Preparation

1. Register Accounts A, B, and C with distinct usernames.
2. Start accrual for each account, giving them **different accrual rates** so their point totals diverge — mint different bot tiers, or call `start_accrual` with different rates. Record each account's rate.
3. Read the baseline: `Registry::get_leaderboard --limit 50`. Record the full ordering and each account's `total_points`.

### Steps

1. Let points accrue. `pending_points = (elapsed_seconds * rate) / 3600`, so an account at 1 pt/hr needs a full hour for a single point — use higher-rate bots or a longer wait to produce a visible spread.
2. Claim as Account C (the intended new leader) so its `total_points` overtakes the others.
3. Open the leaderboard page and refresh.
4. Claim as Account A, then as Account B, refreshing the leaderboard after each claim.
5. After each claim, cross-check the UI against the contract:
   ```bash
   stellar contract invoke --id "$REGISTRY_ID" --source "$DEPLOYER" --network testnet \
     -- get_leaderboard --limit 50
   ```
6. Claim again as an account currently ranked lower, with enough accrued points to overtake the account above it.
7. Refresh the leaderboard and confirm the two rows swapped.

### Expected result

- The leaderboard is sorted by `total_points` **descending**, and the UI ordering matches `Registry::get_leaderboard` exactly.
- Each claim increases only the claiming account's `total_points`, by the number of points that claim reported.
- Rankings re-order when a lower-ranked account's total passes a higher-ranked one — verified at least once by an actual position swap, not just by a points increase.
- The `--limit` argument truncates results: `get_leaderboard --limit 2` returns only the top 2, and `--limit 0` returns an empty list.
- Accounts registered but never accrued appear with `total_points: 0` and sort to the bottom.
- An `addpoints` event with topic `user` and data `points` is emitted per claim.

### Points and `$AMT` interaction

Claiming both adds points **and**, once the threshold is crossed, mints `$AMT` and records it via `add_claimed_amt`. Confirm that:

- The leaderboard ranks on `total_points`, and is unaffected by how much `$AMT` an account has claimed.
- `claimed_amt` on the profile increases only on claims that crossed the mint threshold.

### Evidence to attach

- Claim transaction hash per account
- Each account's accrual rate and `total_points` before and after every claim
- `get_leaderboard` contract output before and after each claim
- Screenshots of the leaderboard page showing the ordering change (before/after the swap in step 7)
- Confirmation that the UI ordering matched the contract output at every checkpoint

---

## Execution Notes

- Local automated execution was not performed in this environment because no funded testnet wallet, deployed frontend URL, or deployed contract IDs were available.
- The checklists above define the required manual evidence for the PR and should be completed during testnet verification.
- To deploy the contracts these flows run against, follow [`DEPLOY.md`](./DEPLOY.md).

### Known blockers to check before running the buy flow (#210)

While writing the #210 checklist, two mismatches were found between [`frontend/src/lib/contracts.ts`](../frontend/src/lib/contracts.ts) and `Marketplace::buy_bot`. Both will need resolving before the buy flow can be exercised through the UI; they are recorded here rather than fixed in this documentation change.

1. `buyBot()` passes only `listing_id`, but the contract signature is `buy_bot(buyer: Address, listing_id: u64)` — the required `buyer` address argument is not sent.
2. `listing_id` is encoded as `u128`, while the contract declares `u64`. `cancelListing()` encodes the same argument the same way.

If the UI purchase fails at simulation, verify these first — the contract path itself is covered by the marketplace unit tests.
