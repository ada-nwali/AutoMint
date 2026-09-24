# AutoMint Contract Deployment Runbook

Operator runbook for deploying the five AutoMint Soroban contracts to Stellar **testnet** and wiring the frontend to them.

- For the contract call graph, authorization matrix, and storage/TTL policy, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- For **frontend** hosting (Vercel, Docker, CI previews) and the full environment-variable reference, see [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- For post-deploy end-to-end verification, see [`MANUAL_TEST_REPORT.md`](./MANUAL_TEST_REPORT.md).

---

## 0. Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Rust toolchain | `rustc --version` | 1.74+ recommended |
| `wasm32v1-none` target | `rustup target list --installed \| grep wasm32` | Install with `rustup target add wasm32v1-none` |
| Stellar CLI | `stellar --version` (v21.4.0) | Install with `cargo install --locked stellar-cli --version 21.4.0` |
| Network reachability | `curl -s https://horizon-testnet.stellar.org` | Deploy needs outbound HTTPS to Horizon and Soroban RPC |

Configure the testnet network once so `--network testnet` resolves:

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

Confirm the workspace builds before you spend anything on-chain:

```bash
stellar contract build
ls -la target/wasm32-unknown-unknown/release/automint_*.wasm
```

You should see five artifacts: `automint_registry.wasm`, `automint_bot_nft.wasm`, `automint_accrual.wasm`, `automint_marketplace.wasm`, `automint_token.wasm`.

---

## 1. Generate and Fund a Deployer Key

The deployer key becomes the **admin** of all five contracts. It is the only account that can `Token::mint`, `Token::set_admin`, and receive marketplace fees, so treat it accordingly — see [ADR-0005](./adr/0005-admin-and-upgrade-strategy.md).

### 1.1 Generate the identity

```bash
stellar keys generate deployer --network testnet
stellar keys address deployer
```

`stellar keys generate` writes the secret to the CLI's local identity store (`~/.config/stellar/identity/deployer.toml` on Linux, `~/Library/Preferences/org.stellar.cli/identity/` on macOS). Record the **public** key (`G...`) — you will need it repeatedly below.

```bash
export DEPLOYER=deployer
export ADMIN_ADDRESS=$(stellar keys address "$DEPLOYER")
echo "$ADMIN_ADDRESS"
```

### 1.2 Fund it via Friendbot

Testnet accounts do not exist until funded. Friendbot grants 10,000 test XLM:

```bash
curl "https://friendbot.stellar.org/?addr=$ADMIN_ADDRESS"
```

### 1.3 Verify funding before deploying

```bash
curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_ADDRESS" | grep -o '"balance":"[^"]*"'
```

A `404` here means the account was never funded and every subsequent step will fail. Re-run Friendbot; if it rate-limits, wait a minute and retry.

> **Do not reuse a mainnet key as the testnet deployer**, and do not commit a secret key to the repo. `.gitignore` already excludes `frontend/.env.local`, but the identity store is outside the repo and should stay there.

---

## 2. Run `scripts/deploy.sh`

```bash
./scripts/deploy.sh testnet "$DEPLOYER"
```

The script takes `NETWORK` and `IDENTITY` as positional arguments (defaults: `testnet` and `mykey`) and runs `set -e`, so it stops at the first failure. It performs five phases:

| Phase | Action |
|---|---|
| 1 | `stellar contract build` — compiles all five contracts to WASM |
| 2 | Resolves `ADMIN_ADDRESS` from the supplied identity |
| 3 | Deploys the five WASMs, capturing `REGISTRY_ID`, `BOT_NFT_ID`, `ACCRUAL_ID`, `MARKETPLACE_ID`, `TOKEN_ID` |
| 4 | Invokes `initialize` on each contract in dependency order |
| 5 | Writes the contract IDs and network settings into `frontend/.env.local` |

The initialization calls it makes, in order:

```
Registry.initialize    --admin $ADMIN_ADDRESS
BotNFT.initialize      --admin $ADMIN_ADDRESS --registry $REGISTRY_ID
Accrual.initialize     --admin $ADMIN_ADDRESS --points_per_amt 100
Marketplace.initialize --admin $ADMIN_ADDRESS --bot-nft $BOT_NFT_ID --fee-bps 250
Token.initialize       --admin $ADMIN_ADDRESS --decimal 7 --name "AutoMint Token" --symbol "AMT"
```

Capture the full output — the contract IDs (`C...`) are printed once and are the only record outside `.env.local`:

```bash
./scripts/deploy.sh testnet "$DEPLOYER" 2>&1 | tee deploy-$(date +%Y%m%d-%H%M).log
```

### If the script fails partway

Deployment is **not** transactional. A failure in phase 4 leaves deployed-but-uninitialized contracts on-chain.

| Symptom | Cause | Recovery |
|---|---|---|
| `error: account not found` | Deployer never funded | Re-run §1.2, then re-run the script |
| `AlreadyInitialized` (error #1) | Re-running the script against contracts that already initialized | Contracts are already wired; skip to §3 with the IDs from the earlier log |
| `wasm file not found` | `stellar contract build` produced nothing | Confirm the `wasm32-unknown-unknown` target is installed, then rebuild |
| Deploy succeeded, initialize failed | Partial state on-chain | Re-run only the failed `stellar contract invoke ... -- initialize` by hand with the IDs already printed |

Every `initialize` is one-time and guarded by an `Initialized` flag, so a clean re-deploy of fresh contracts is always the safe fallback — testnet IDs are disposable.

---

## 3. Verify the Contracts on Stellar Expert

For each of the five contract IDs, open:

```
https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>
```

Check on each page:

1. **The contract exists** and shows a creation transaction from your deployer address.
2. **The WASM hash** is present under the contract's code section, and the same hash is shared by contracts deployed from the same build.
3. **The `initialize` invocation** appears in the contract's invocation history and succeeded.
4. **Storage entries** are populated — Registry shows `Admin`/`Initialized`, Marketplace shows its `Config`, and so on.

You can also confirm the deployer's account activity in one place:

```
https://stellar.expert/explorer/testnet/account/<ADMIN_ADDRESS>
```

### Verify from the CLI

Explorer indexing can lag by a few seconds; the CLI is the authoritative check. Read back the admin each contract actually stored:

```bash
for ID in "$REGISTRY_ID" "$BOT_NFT_ID" "$ACCRUAL_ID" "$TOKEN_ID"; do
  echo "== $ID"
  stellar contract invoke --id "$ID" --source "$DEPLOYER" --network testnet -- admin
done
```

Each must return your `ADMIN_ADDRESS`. Then confirm the two stored cross-contract wirings:

```bash
# Marketplace config must contain the BotNFT ID and fee_bps = 250
stellar contract invoke --id "$MARKETPLACE_ID" --source "$DEPLOYER" --network testnet -- config

# Accrual config must report points_per_amt = 100
stellar contract invoke --id "$ACCRUAL_ID" --source "$DEPLOYER" --network testnet -- config

# Token metadata
stellar contract invoke --id "$TOKEN_ID" --source "$DEPLOYER" --network testnet -- symbol
stellar contract invoke --id "$TOKEN_ID" --source "$DEPLOYER" --network testnet -- decimals
```

Optionally publish the source for on-explorer verification:

```bash
stellar contract info build --id "$REGISTRY_ID" --network testnet
```

A deployment is only considered good when all five `admin` reads return the deployer and the Marketplace `config` points at the BotNFT ID from the same run — a Marketplace wired to a *stale* BotNFT is the most common silent misconfiguration, and it only surfaces later as `BotTransferFailed` during a purchase.

---

## 4. Update `frontend/.env.local`

`scripts/deploy.sh` writes this file for you. It creates it from `frontend/.env.example` if missing, then upserts each key (updating in place if present, appending if not), so re-running the script refreshes IDs without duplicating lines.

After a successful run the file contains:

```bash
NEXT_PUBLIC_NETWORK=TESTNET
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=C...
NEXT_PUBLIC_BOT_NFT_CONTRACT_ID=C...
NEXT_PUBLIC_ACCRUAL_CONTRACT_ID=C...
NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID=C...
NEXT_PUBLIC_TOKEN_CONTRACT_ID=C...
```

Confirm the values match the deploy log:

```bash
grep NEXT_PUBLIC_ frontend/.env.local
```

### Values the script does not set

`scripts/deploy.sh` writes only the eight keys above. If your environment needs the rest of the frontend configuration, add them by hand (full reference in [`DEPLOYMENT.md`](./DEPLOYMENT.md)):

```bash
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_TX_TIMEOUT=30
NEXT_PUBLIC_BASE_FEE=100
NEXT_PUBLIC_POINTS_PER_AMT=100
NEXT_PUBLIC_LEADERBOARD_LIMIT=50
```

> `NEXT_PUBLIC_POINTS_PER_AMT` must match the `--points_per_amt` value the Accrual contract was initialized with (`100` in `scripts/deploy.sh`). If they disagree, the UI will predict a different claim payout than the contract actually mints.

### Apply the new values

`NEXT_PUBLIC_*` variables are inlined at **build time**, so a running dev server will not pick up new contract IDs:

```bash
cd frontend
npm ci
npm run build   # or: npm run dev — restart it either way
```

For hosted environments, update the same keys in the Vercel project settings (or your container's environment) and redeploy — editing `.env.local` alone has no effect on a hosted build.

`frontend/.env.local` is git-ignored and must stay that way. Contract IDs are public information, but the file is per-environment and should not be committed.

---

## 5. Post-Deploy Smoke Test

A two-minute confidence check before handing the environment to testers:

```bash
# Registry starts empty
stellar contract invoke --id "$REGISTRY_ID" --source "$DEPLOYER" --network testnet -- total_users

# Tier table is readable — returns (name, rate, price)
stellar contract invoke --id "$BOT_NFT_ID" --source "$DEPLOYER" --network testnet -- get_tier_info --tier Basic

# Marketplace has no listings yet
stellar contract invoke --id "$MARKETPLACE_ID" --source "$DEPLOYER" --network testnet \
  -- get_active_listings --start 0 --limit 10
```

Then start the frontend, connect a wallet, and register a user. Full end-to-end flows — buying a listed bot and refreshing the leaderboard — are scripted in [`MANUAL_TEST_REPORT.md`](./MANUAL_TEST_REPORT.md).

---

## 6. Redeployment

Contracts in this workspace have no upgrade entrypoint, so shipping new contract code on testnet means deploying fresh contracts:

1. Re-run `./scripts/deploy.sh testnet "$DEPLOYER"`.
2. Re-verify per §3 — pay particular attention to the Marketplace `config`, which must point at the **new** BotNFT ID.
3. Confirm `frontend/.env.local` picked up all five new IDs, and rebuild the frontend.
4. Update contract IDs in any hosted environment (Vercel, Docker, CI) as well.

State does not migrate. New contracts start with zero users, zero bots, zero listings, and zero token balances; previously minted `$AMT` and bots exist only against the old contract IDs. Archive the previous deploy log rather than deleting it — it is the only record of which IDs a given test report referred to.
