# Changelog

All notable changes to the AutoMint project on the `testnet-implementation` branch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - testnet-implementation

### Added
- **Marketplace offers** (#425): `make_offer` escrows a buyer's bid on any bot, listed or not; `accept_offer` moves the bot and pays out the escrow atomically (deactivating the seller's own listing when the bot is in escrow); `cancel_offer` refunds in full, by the buyer before expiry or by anyone after; `get_offer` / `get_offers_for_bot` views. Offers on a bot the buyer already owns are rejected; at most 25 open offers per bot. See [`docs/adr/0006-offers-and-retained-fees.md`](docs/adr/0006-offers-and-retained-fees.md).
- **Marketplace fee withdrawal** (#426): platform fees now accrue inside the contract per currency (`DataKey::Fees`) instead of being forwarded to the admin on every sale; admin-only `withdraw_fees(currency, to, amount)` is bounded by `fees_accrued(currency)` so escrowed offer funds are never withdrawable, and emits `fees_wd`.
- **Accrual batch settlement** (#414): permissionless `settle(users)` (up to 25) credits pending points to the registry and carries them forward without minting or per-user signatures; the user's next `claim` mints the same amount it would have. Rationale for leaving it open is in [`docs/contracts/accrual.md`](docs/contracts/accrual.md).
- **Documentation & Onboarding Suite**:
  - Added [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) featuring Mermaid cross-contract call graphs, complete authorization matrix, storage layout/TTL retention policies, event catalogue, and deployment sequence (#566). Renamed from `docs/architecture.md` and extended with a contract responsibility/dependency table, address-wiring notes, and the ordering and failure semantics of `Marketplace::buy_bot` ([#212](https://github.com/Ada-Girly881/AutoMint/issues/212)).
  - Added [`docs/DEPLOY.md`](docs/DEPLOY.md), an operator runbook covering deployer key generation and Friendbot funding, running `scripts/deploy.sh`, contract verification on Stellar Expert and via the CLI, `frontend/.env.local` updates, a post-deploy smoke test, and redeployment ([#217](https://github.com/Ada-Girly881/AutoMint/issues/217)).
  - Extended [`docs/MANUAL_TEST_REPORT.md`](docs/MANUAL_TEST_REPORT.md) with end-to-end testnet checklists for the two-account buy-listed-bot flow including the 2.5% fee split and negative cases ([#210](https://github.com/Ada-Girly881/AutoMint/issues/210)) and the multi-account leaderboard refresh flow ([#211](https://github.com/Ada-Girly881/AutoMint/issues/211)).
  - Added [`docs/ONBOARDING.md`](file:///Users/macosbigsur/Documents/Code/AutoMint/docs/ONBOARDING.md) guiding new contributors in exact reading order: `types` → `lib/stellar` → `lib/contracts` → `hooks` → `components` → `pages` ([#250](file:///Users/macosbigsur/Documents/Code/AutoMint/docs/ONBOARDING.md)).
  - Rewrote [`README.md`](file:///Users/macosbigsur/Documents/Code/AutoMint/README.md) to describe the actual implemented codebase state (~10,000 LOC), component status tables, setup guides, and `testnet-implementation` PR guidelines ([#565](file:///Users/macosbigsur/Documents/Code/AutoMint/README.md)).
  - Created [`CHANGELOG.md`](file:///Users/macosbigsur/Documents/Code/AutoMint/CHANGELOG.md) tracking implementation milestones on the `testnet-implementation` branch ([#246](file:///Users/macosbigsur/Documents/Code/AutoMint/CHANGELOG.md)).

- **Smart Contract System (Soroban / Rust)**:
  - **`automint_registry`**: Implemented user registration, unique username verification, user profile persistent storage, total users counter, and sorted on-chain leaderboard queries.
  - **`automint_bot_nft`**: Implemented sequential NFT bot minting, 5 tier levels (`Basic`, `Bronze`, `Silver`, `Gold`, `Diamond`), ownership transfer, user bot list indexing, and TTL renewal fixes on transfer.
  - **`automint_accrual`**: Implemented 24/7 idle time-based accrual calculation engine, pending points query, and `$AMT` token mint redemption upon claiming points.
  - **`automint_marketplace`**: Implemented P2P bot escrow marketplace allowing users to list, cancel, and buy bots with positive price validation and 2.5% (250 bps) admin fee distribution.
  - **`automint_token`**: Implemented SEP-41 compliant `$AMT` token with minting, burning, transfer, allowance/approve mechanics, and `set_admin` governance transfer.
  - **`automint_testutils`**: Created shared testing crate providing `advance_ledger` and `advance_past_ttl` helpers for ledger progression simulation.

- **Frontend Application (Next.js 14 / TypeScript)**:
  - Next.js 14 App Router pages for `Landing`, `Dashboard`, `Marketplace`, `Leaderboard`, and `Profile`.
  - TanStack React Query custom hooks (`useWallet`, `useAccrual`, `useMarketplace`, `useLeaderboard`, `useBotDetails`).
  - Soroban contract clients in `lib/contracts.ts` with exponential-backoff RPC retry handling in `lib/rpcRetry.ts`.
  - Zustand wallet store in `store/walletStore.ts` supporting Freighter wallet auto-reconnect and transaction signing.
  - UI component library covering Modals, Skeletons, Bot Cards, Live Points Counter, Upgrade Prompts, and Registration Banners.

- **CI/CD & Testing Discipline**:
  - Explicit authorization test suite (`auth_tests` modules) asserting `require_auth()` behavior across contracts ([#543]).
  - Storage TTL and archival test coverage verifying entry access before expiry, panic on archive, and TTL renewal ([#544]).
  - Exact error variant assertions replacing bare `is_err()` checks in contract test suites ([#545]).
  - Wired frontend Jest suite into GitHub Actions CI with jsdom polyfills and Stellar SDK transaction smoke test ([#547]).
  - Automated workflow for weekly `cargo-mutants` mutation testing (`.github/workflows/mutation-testing.yml`) ([#580]).
  - Automated frontend bundle budget size enforcement pipeline (`.github/workflows/frontend-bundle-budget.yml`).
  - Unit and integration test coverage for Dashboard and Leaderboard UI components ([#578]).

### Fixed
- Contract CI gates on `testnet-implementation` were red after the 26 to 28 September merges: `cargo fmt --check` failed across the workspace, `cargo clippy -D warnings` failed on unused imports in the token, the bot_nft and marketplace test modules no longer compiled (views `next_id`, `get_bots_range`, `all_tiers` and the typed `get_tier_info` had been dropped from the contract while their tests remained; `initialize` / `mint_tier` / marketplace `initialize` / `list_bot` arities had moved), the accrual wasm failed to link with a duplicate `initialize` symbol because it depended on the registry and token contract crates, `rename_bot` read the wrong stored type, and the token's `TotalSupply` entry was never TTL-extended so it archived under the burn TTL test. Accrual now talks to the registry and token through local `#[contractclient]` traits, the dropped views are back, the shared test deployment allowlists the AMT token for the marketplace, and every stale test asserts the merged behaviour (one free Basic bot per account, currency allowlist, self-approval permitted, `InvalidDecimals`, total-supply accounting, base-unit minting).
- The merges of #629, #643, #644 and #646 left the accrual contract uncompilable: conflict residue (branch-name lines inside `start_accrual`, `claim` and a test; both sides of the `UserAccrual` initializer kept; `rate` used before it was read), a `DataKey::Frozen` variant referenced but never declared, and two `UserAccrual` test initializers without `leftover`; #645 then used an undefined `next_last_claim_ts`, built a `Config` without `amt_scale` in `set_points_per_amt`, and declared `pending_points` as `u64` over `u128` arithmetic. The reentrancy guard `claim` sets in temporary storage was never released, so every claim after the first in a ledger silently returned zero; it is now cleared on the success path.
- `scripts/generate-bindings.sh` now passes the all-zero placeholder `--contract-id`, which stellar-cli 22.0.0 (the version CI installs) requires even when generating from a local wasm; the committed bindings are regenerated with that CLI so the drift check compares like with like.

### Changed
- Every stored id counter now fails closed with a typed `Overflow` error instead of trapping (#335): `bot_nft::get_next_id` returns `Result` and `BotNFTError::Overflow`, `registry::register` returns `RegistryError::Overflow`, and the marketplace's `NextListingId`, `UserActiveListingCount`, `PageCount` and `sale_count` increments are all checked.
- Refactored persistent storage writes across `bot_nft`, `token`, and `accrual` contracts to explicitly extend instance and persistent TTL on every write operation, preventing silent archival under active accounts ([#544]).
- Standardized error handling in contract clients to return typed error variants.
