# AutoMint Frontend & Deployment Documentation

This document describes how to deploy the AutoMint Next.js frontend, configure environment variables, deploy via Vercel or Docker, and run preview environments in CI.

---

## Required Environment Variables

All environment variables used by the frontend are prefixed with `NEXT_PUBLIC_` so Next.js can inline them at build time.

| Variable Name | Required | Default / Example Value | Description |
|---|---|---|---|
| `NEXT_PUBLIC_NETWORK` | Yes | `TESTNET` | Network environment label (e.g. `TESTNET` or `MAINNET`). |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Yes | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint used for simulation & transaction submission. |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Yes | `"Test SDF Network ; September 2015"` | Network passphrase used when signing transactions. |
| `NEXT_PUBLIC_REGISTRY_CONTRACT_ID` | Yes | `C...01` | Deployed Registry contract ID for user profiles and leaderboards. |
| `NEXT_PUBLIC_BOT_NFT_CONTRACT_ID` | Yes | `C...02` | Deployed BotNFT contract ID for bot minting and ownership tracking. |
| `NEXT_PUBLIC_ACCRUAL_CONTRACT_ID` | Yes | `C...03` | Deployed Accrual contract ID for point accrual math and claims. |
| `NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID` | Yes | `C...04` | Deployed Marketplace contract ID for bot NFT escrow and sales. |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | Yes | `C...05` | Deployed Token contract ID for in-app $AMT reward assets. |
| `NEXT_PUBLIC_HORIZON_URL` | Yes | `https://horizon-testnet.stellar.org` | Horizon RPC URL for account balance queries. |
| `NEXT_PUBLIC_TX_TIMEOUT` | No | `30` | Transaction submission timeout (in seconds). |
| `NEXT_PUBLIC_BASE_FEE` | No | `100` | Base fee in stroops for transactions. |
| `NEXT_PUBLIC_POINTS_PER_AMT` | No | `1000` | Points required per 1 `$AMT` token minted. |
| `NEXT_PUBLIC_LEADERBOARD_LIMIT` | No | `50` | Default record limit for leaderboard queries. |

---

## How to Get Testnet Contract IDs

To obtain fresh, functional contract IDs on Stellar Testnet:

1. Generate a testnet identity and fund it via Friendbot:
   ```bash
   stellar keys generate mykey --network testnet
   curl "https://friendbot.stellar.org/?addr=$(stellar keys address mykey)"
   ```

2. Run the automated contract deployment & initialization script:
   ```bash
   ./scripts/deploy.sh testnet mykey
   ```

3. The script compiles all 5 smart contracts (`registry`, `bot_nft`, `accrual`, `marketplace`, `token`), deploys them to Testnet, invokes their `initialize` functions, and populates `frontend/.env.local` automatically.

---

## Deployment Manifest (`deployments/<network>.json`)

`scripts/deploy.sh` records every deployed contract in
`deployments/<network>.json` **immediately after each step succeeds** (issues
#557 + #559), so a crash mid-script never loses a contract ID and re-running
resumes instead of redeploying. The manifest is gitignored — it holds live
deployment state, not source.

```json
{
  "network": "testnet",
  "git_sha": "047c77c…",
  "toolchain": "1.95.0",
  "created_at": "2024-…",
  "updated_at": "2024-…",
  "contracts": {
    "registry": {
      "contract_id": "C…",
      "initialized": true,
      "initialized_at": "2024-…",
      "deployed_at": "2024-…",
      "wasm_path": "target/wasm32-unknown-unknown/release/automint_registry.wasm",
      "wasm_hash": "<sha256 of the deployed wasm>",
      "git_sha": "047c77c…"
    }
    // … bot_nft, accrual, marketplace, token …
  }
}
```

Key properties:

- **Idempotent & resumable.** `deploy.sh` checks the manifest before each step:
  a recorded `contract_id` skips the deploy; a recorded `initialized: true`
  skips the init. `--force` bypasses both for a genuine full redeploy.
  `--dry-run` prints the plan without deploying or writing anything.
- **Contract IDs are validated** (56-char StrKey, `C` + 55 base32 chars) before
  anything is written to the manifest, so a malformed RPC response can never
  poison it.
- **Wasm hash + git SHA** are recorded per contract for reproducible-build
  verification below. If you bump any dependency or toolchain, rebuild and
  re-record the manifest before redeploying (see `docs/DEPENDENCIES.md`).

## Verifying a deployment (reproducible builds)

`scripts/verify-deployment.sh <network>` rebuilds each recorded contract from
the manifest's `git_sha` in a throwaway git worktree, **twice**, in two
separate Cargo target directories, and asserts both rebuilt wasm sha256 hashes
equal the `wasm_hash` recorded in the manifest (and therefore equal each
other). Building twice in separate target dirs is what makes the "two builds of
the same commit are byte-identical" guarantee directly checkable — a cached or
noop build would trivially match.

```bash
# Verify all contracts recorded in deployments/testnet.json
./scripts/verify-deployment.sh testnet

# Verify a single contract
./scripts/verify-deployment.sh testnet --contract token

# Keep worktrees/target dirs under /tmp for debugging
./scripts/verify-deployment.sh testnet --no-clean
```

Requirements: the pinned toolchain (`rust-toolchain.toml`) installed via
`rustup`, the `wasm32-unknown-unknown` target, and the manifest must contain a
non-empty `git_sha` and a `wasm_hash` for each contract being verified.

Reproducibility rests on three pins, so all three land together (issues #562
and #559):

1. `rust-toolchain.toml` pins an exact rustc (`1.95.0`).
2. `Cargo.toml` pins `soroban-sdk` to an exact version (`=21.7.7`).
3. `Cargo.lock` is committed, and verification builds use `--locked`.



## Hosting Options

### 1. Vercel Deployment

The application includes a `frontend/vercel.json` configuration file ready for Vercel integration.

- **Root Directory**: Set root directory to `frontend` in Vercel project settings.
- **Framework Preset**: Next.js.
- **Environment Variables**: Add all `NEXT_PUBLIC_*` contract IDs and RPC endpoints in the Vercel Dashboard project settings.

### 2. Docker & Containerized Deployment

A multi-stage `Dockerfile` is provided in `frontend/Dockerfile`.

Build and run locally:
```bash
cd frontend
docker build -t automint-frontend .
docker run -p 3000:3000 automint-frontend
```

Run using Docker Compose from the project root:
```bash
docker-compose up --build
```

---

## CI Preview Deployments

Every Pull Request targeting `main` automatically triggers `.github/workflows/preview-deployment.yml`.

- Injects contract IDs into the Next.js build environment.
- Executes a clean production build (`npm run build`).
- Comments the build status and deployment preview confirmation directly on the PR.
