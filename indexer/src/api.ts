/**
 * Aggregate REST API + ops dashboard for the AutoMint indexer.
 *
 * Endpoints:
 *   GET /                  — ops dashboard (static HTML in `public/index.html`)
 *   GET /api/summary       — top-level aggregates (users, claims, AMT minted,
 *                            volume, floor price, latest ledger)
 *   GET /api/claims/daily  — per-day claims / AMT minted / volume
 *   GET /api/events        — recent raw events (dashboard table)
 *   GET /api/health        — indexer liveness + checkpoint
 *
 * All i128 amounts are returned as decimal strings to avoid JS number
 * precision loss (the contracts store prices/amounts as i128).
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
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    res.json({ days, rows: db.daily(days) });
  });

  app.get("/api/events", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    res.json({ total: db.recentEvents(limit, offset).length, events: db.recentEvents(limit, offset) });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      network: config.network,
      checkpoint_ledger: db.latestLedger(),
      last_indexed_at: db.lastIndexedAt(),
      contracts: config.contracts,
      ...(opts.extraHealth ? opts.extraHealth() : {}),
    });
  });

  return app;
}
