/**
 * Indexer entry point.
 *
 * Starts:
 *   - the polling loop (Soroban RPC `getEvents` → decode → SQLite upsert),
 *   - the aggregate REST API + ops dashboard (Express).
 *
 * Contract IDs are resolved from the deployment manifest
 * (`deployments/<network>.json` from scripts/deploy.sh) or env vars.
 *
 * Env vars:
 *   AM_NETWORK                 network name (default: testnet)
 *   AM_RPC_URL                 Soroban RPC URL (default: testnet public RPC)
 *   AM_DB_PATH                 SQLite file (default: <repo>/indexer/data/am-indexer.db)
 *   AM_START_LEDGER            first ledger to index on a cold start
 *   AM_POLL_INTERVAL_MS        poll loop delay (default 5000)
 *   AM_PORT                    API port (default 8765)
 *   AM_MANIFEST                explicit path to the deployment manifest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IndexerDb } from "./db.js";
import { SorobanRpcClient } from "./rpc.js";
import { Poller } from "./poller.js";
import { createApiServer } from "./api.js";
import { loadContractConfig, assertCompleteConfig } from "./config.js";
import type { ContractConfig } from "./types.js";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_PORT = 8765;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

function indexerRoot(): string {
  // src/index.ts → indexer (works for dist/index.js too)
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export interface IndexerRuntime {
  db: IndexerDb;
  poller: Poller;
  config: ContractConfig;
}

export function buildRuntime(
  opts: { dbPath?: string; rpcUrl?: string; startLedger?: number } = {},
): IndexerRuntime {
  const loaded = loadContractConfig();
  assertCompleteConfig(loaded);
  const { config } = loaded;

  const root = indexerRoot();
  const dbPath =
    opts.dbPath ??
    process.env.AM_DB_PATH ??
    path.join(root, "data", `am-indexer-${config.network}.db`);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new IndexerDb(dbPath);
  const rpcUrl = opts.rpcUrl ?? process.env.AM_RPC_URL ?? DEFAULT_RPC_URL;
  const rpc = new SorobanRpcClient(rpcUrl);

  const startLedger =
    opts.startLedger ?? Number(process.env.AM_START_LEDGER ?? 0);

  const poller = new Poller({
    rpc,
    db,
    config,
    defaultStartLedger: startLedger,
  });

  return { db, poller, config };
}

export async function main(): Promise<void> {
  const { db, poller, config } = buildRuntime();

  const port = Number(process.env.AM_PORT ?? DEFAULT_PORT);
  const intervalMs = Number(process.env.AM_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);

  const controller = new AbortController();
  const shutdown = () => {
    controller.abort();
    setTimeout(() => {
      db.close();
      process.exit(0);
    }, 300);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const app = createApiServer({ db, config });
  const server = app.listen(port, () => {
    console.log(`[indexer] aggregate API + dashboard on http://localhost:${port}`);
    console.log(`[indexer] network=${config.network} contracts=${
      Object.values(config.contracts).join(",")
    }`);
  });

  try {
    await poller.run(intervalMs, controller.signal);
  } finally {
    server.close();
    db.close();
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
// Invoke `main()` when this module is executed directly (not imported):
//   node dist/index.js   (npm start)
//   tsx src/index.ts     (npm run dev)
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((error) => {
    console.error("[indexer] fatal:", error);
    process.exit(1);
  });
}
