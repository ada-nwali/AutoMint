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
import type { Server } from "node:http";
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

/**
 * Validate a numeric environment variable is a non-negative finite integer.
 */
function validateNonNegativeInt(
  value: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;

  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error(
      `Invalid ${name}="${value}": must be a non-negative integer`,
    );
  }
  return parsed;
}

/**
 * Validate a numeric environment variable is a positive finite integer.
 */
function validatePositiveInt(
  value: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}="${value}": must be a positive integer`,
    );
  }
  return parsed;
}

function indexerRoot(): string {
  // src/index.ts → indexer (works for dist/index.js too)
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export interface IndexerRuntime {
  db: IndexerDb;
  poller: Poller;
  config: ContractConfig;
  extraHealth: () => Record<string, unknown>;
}

export function buildRuntime(
  opts: {
    dbPath?: string;
    rpcUrl?: string;
    startLedger?: number;
    pollIntervalMs?: number;
  } = {},
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
    opts.startLedger ?? validateNonNegativeInt(process.env.AM_START_LEDGER, "AM_START_LEDGER", 0);

  const poller = new Poller({
    rpc,
    db,
    config,
    defaultStartLedger: startLedger,
  });

  const pollIntervalMs =
    opts.pollIntervalMs ??
    validatePositiveInt(
      process.env.AM_POLL_INTERVAL_MS,
      "AM_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
    );
  const staleAfterMs = Math.max(pollIntervalMs * 3, 30_000);

  return {
    db,
    poller,
    config,
    extraHealth: () => ({ ...poller.health(staleAfterMs) }),
  };
}

export async function main(): Promise<void> {
  const port = validatePositiveInt(process.env.AM_PORT, "AM_PORT", DEFAULT_PORT);
  const intervalMs = validatePositiveInt(
    process.env.AM_POLL_INTERVAL_MS,
    "AM_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );

  const { db, poller, config, extraHealth } = buildRuntime({
    pollIntervalMs: intervalMs,
  });

  // A signal only aborts the poller. `poller.run` settles once its in-flight
  // cycle has stopped, then the HTTP server drains and the database is closed
  // exactly once (#662, #1240). A second signal falls through to the default handler.
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const app = createApiServer({ db, config, extraHealth });
  const server = app.listen(port, () => {
    console.log(
      `[indexer] aggregate API + dashboard on http://localhost:${port}`,
    );
    console.log(
      `[indexer] network=${config.network} contracts=${Object.values(
        config.contracts,
      ).join(",")}`,
    );
  });

  try {
    await poller.run(intervalMs, controller.signal);
  } finally {
    await closeServer(server);
    db.close();
  }
}

/** Stop accepting connections and resolve once open ones have finished. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
// Invoke `main()` when this module is executed directly (not imported):
//   node dist/index.js   (npm start)
//   tsx src/index.ts     (npm run dev)
const isEntry =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("[indexer] fatal:", error);
      process.exit(1);
    });
}
