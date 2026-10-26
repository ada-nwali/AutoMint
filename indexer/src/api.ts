/**
 * Aggregate REST API + ops dashboard for the AutoMint indexer.
 *
 * Endpoints:
 *   GET /                  — ops dashboard (static HTML in `public/index.html`)
 *   GET /api/summary       — top-level aggregates (users, claims, AMT minted,
 *                            latest ledger) and per-currency marketplace
 *                            figures (`markets`: volume, floor price, listings)
 *   GET /api/claims/daily  — per-day claims / AMT minted / volume
 *   GET /api/events        — recent raw events (dashboard table)
 *   GET /api/health        — indexer liveness + checkpoint
 *
 * All i128 amounts are returned as decimal strings to avoid JS number
 * precision loss (the contracts store prices/amounts as i128).
 *
 * `days`, `limit` and `offset` must be whole numbers; anything else is
 * rejected with HTTP 400 (#660).
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexerDb } from "./db.js";
import type { ContractConfig } from "./types.js";

export interface ApiOptions {
  db: IndexerDb;
  config: ContractConfig;
  /** Additional health info (e.g. last poll error/timestamp) fed by the caller. */
  extraHealth?: () => Record<string, unknown>;
}

/** Raised for a query parameter that is not a whole number; mapped to HTTP 400. */
class InvalidQueryParam extends Error {}

/**
 * Parse an integer query parameter (#660). Only plain decimal integers are
 * accepted, so `abc`, `1.5`, `NaN` and `1e3` are rejected instead of reaching
 * `toISOString()` or SQLite. Valid integers are clamped to `[min, max]`.
 */
function integerParam(
  raw: unknown,
  name: string,
  opts: { fallback: number; min: number; max: number },
): number {
  if (raw === undefined) return opts.fallback;
  const text = typeof raw === "string" ? raw.trim() : "";
  const value = Number(text);
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value)) {
    throw new InvalidQueryParam(`${name} must be an integer`);
  }
  return Math.min(Math.max(value, opts.min), opts.max);
}

export function createApiServer(opts: ApiOptions): express.Express {
  const { db, config } = opts;
  const app = express();

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(dir, "..", "public");
  app.use(express.static(publicDir));

  app.get("/api/summary", (_req, res) => {
    res.json(db.summary());
  });

  app.get("/api/claims/daily", (req, res) => {
    const days = integerParam(req.query.days, "days", { fallback: 30, min: 1, max: 365 });
    res.json({ days, rows: db.daily(days) });
  });

  app.get("/api/events", (req, res) => {
    const limit = integerParam(req.query.limit, "limit", { fallback: 50, min: 1, max: 500 });
    const offset = integerParam(req.query.offset, "offset", { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
    res.json({ total: db.countEvents(), events: db.recentEvents(limit, offset) });
  });

  app.get("/api/health", (_req, res) => {
    const extra = opts.extraHealth ? opts.extraHealth() : {};
    const health = {
      ok: true,
      network: config.network,
      checkpoint_ledger: db.latestLedger(),
      last_indexed_at: db.lastIndexedAt(),
      contracts: config.contracts,
      ...extra,
    };
    const statusCode = health.ok ? 200 : 503;
    res.status(statusCode).json(health);
  });

  app.get("/livez", (_req, res) => {
    res.status(200).send("OK");
  });

  app.get("/readyz", (_req, res) => {
    const extra = opts.extraHealth ? opts.extraHealth() : {};
    const isReady = extra.ok !== false;
    res.status(isReady ? 200 : 503).send(isReady ? "READY" : "NOT_READY");
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof InvalidQueryParam) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  });

  return app;
}
