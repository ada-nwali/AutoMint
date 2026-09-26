# Changelog

All notable changes to the AutoMint project on the `testnet-implementation` branch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - testnet-implementation

### Added
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

### Changed
- Refactored persistent storage writes across `bot_nft`, `token`, and `accrual` contracts to explicitly extend instance and persistent TTL on every write operation, preventing silent archival under active accounts ([#544]).
- Standardized error handling in contract clients to return typed error variants.
