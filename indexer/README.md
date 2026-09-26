# AutoMint Indexer

A minimal Soroban event indexer for the five AutoMint contracts (registry,
bot_nft, accrual, marketplace, token). It polls the Soroban RPC `getEvents`
endpoint with cursor-based pagination, decodes the contract events, and stores
them in SQLite. A REST API exposes aggregate operational figures and a small
ops dashboard renders them.

Built for **issue #563**. The event schemas it depends on are documented in
[`docs/EVENTS.md`](docs/EVENTS.md).

## Architecture

```
Soroban RPC (getEvents, cursor pagination)
        │  poll every AM_POLL_INTERVAL_MS
        ▼
  src/poller.ts ── decode (src/events.ts) ──► src/db.ts (SQLite)
        │                                          │  checkpoint (last ledger)
        │                                          │  events (idempotent upsert by event id)
        ▼                                          ▼
  src/api.ts (Express REST) ◄──── src/index.ts ──► data/am-indexer-<network>.db
        │
        ▼
  public/index.html (ops dashboard, auto-refresh)
```

**Restart recovery:** the last fully-processed ledger is persisted to the
`checkpoint` table. On restart the poller resumes from `checkpoint + 1`.
Events are keyed by their unique RPC event id and inserted with
`INSERT OR IGNORE`, so any overlapping re-fetch after a restart is a no-op —
no gaps, no double-counts (verified by `src/__tests__/resume.test.ts`).

## Setup

```bash
cd indexer
npm install
```

Contract IDs are resolved, in order of precedence, from:

1. the deployment manifest `deployments/<network>.json` (produced by
   `scripts/deploy.sh` — issues #557/#559),
2. `AM_<CONTRACT>_CONTRACT_ID` env vars,
3. `frontend/.env.local` (`NEXT_PUBLIC_*_CONTRACT_ID`).

## Run

```bash
# dev (watch mode)
npm run dev

# production build + start
npm run build
npm start
```

Environment variables:

| Var | Default | Description |
|-----|---------|-------------|
| `AM_NETWORK` | `testnet` | Network name; also selects `deployments/<name>.json` |
| `AM_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `AM_DB_PATH` | `indexer/data/am-indexer-<network>.db` | SQLite file |
| `AM_START_LEDGER` | `0` | Ledger to start from when no checkpoint exists |
| `AM_POLL_INTERVAL_MS` | `5000` | Poll loop delay |
| `AM_PORT` | `8765` | API + dashboard port |
| `AM_MANIFEST` | — | Explicit path to a deployment manifest |

## API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Ops dashboard (auto-refreshes every 15s) |
| `GET /api/summary` | users, claims, AMT minted, volume, floor price, active listings, latest ledger |
| `GET /api/claims/daily?days=30` | per-day claims / AMT minted / volume |
| `GET /api/events?limit=50&offset=0` | recent raw events |
| `GET /api/health` | checkpoint ledger, last indexed at, contract IDs |

All `i128` amounts are returned as **decimal strings** to avoid JS number
precision loss.

## Tests

```bash
npm test          # vitest: decode, aggregates, idempotency, resume, API
npm run typecheck
```

Test coverage highlights (issue #563 acceptance criteria):

- **decode.test.ts** — every event type across all five contracts decodes to
  the documented shape (cross-checked against the real contract emissions).
- **aggregates.test.ts** — the aggregate API returns correct figures for a
  known set of events, including i128-scale amounts.
- **resume.test.ts** — kill-and-restart: a re-fetch of the overlapping window
  neither skips nor double-counts events.
- **indexer.test.ts** — poller lifecycle, pagination, reverted-call filtering.
- **api.test.ts** — live HTTP checks of every endpoint.

## Production notes / unresolved dependencies

The four internal tickets the issue references (AM-030, AM-053, AM-099,
AM-124) could not be located anywhere in the repo. See
[`docs/EVENTS.md`](docs/EVENTS.md) → "Known limitations & unresolved
dependencies" for the assumptions made and what needs confirming before this
is considered production-complete.
