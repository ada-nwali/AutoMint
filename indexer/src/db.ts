/**
 * SQLite persistence for the AutoMint indexer.
 *
 * Three tables:
 *   - `events`     — append-only log of decoded events, keyed by a stable,
 *                    unique event id (`<ledger>-<txHash>-<eventIndex>`).
 *                    `INSERT OR IGNORE` makes re-processing idempotent: a
 *                    double-fetched event (e.g. after a restart that replays
 *                    from an earlier ledger) is never duplicated.
 *   - `checkpoint` — the last ledger whose events were fully processed, so a
 *                    restart resumes from `last_ledger + 1` instead of the
 *                    beginning.
 *   - `listings`   — derived marketplace listing state (active/sold/cancelled)
 *                    so the "floor price" aggregate can be computed as the min
 *                    price over active listings without replaying history.
 *
 * Event → derived-state updates happen inside the SAME transaction as the raw
 * insert and only when the insert actually landed (`changes() === 1`), so a
 * crash mid-batch can never leave derived state ahead of the raw log.
 */
import Database from "better-sqlite3";
import type { DailyRow, DecodedEvent, EventRow, Summary } from "./types.js";
import { jsonStringify, toDecimal, toNum } from "./events.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS events (
  id               TEXT PRIMARY KEY,
  contract_id      TEXT NOT NULL,
  contract         TEXT NOT NULL,
  event            TEXT NOT NULL,
  ledger           INTEGER NOT NULL,
  tx_hash          TEXT NOT NULL,
  event_index      INTEGER NOT NULL,
  ledger_closed_at TEXT,
  topics_json      TEXT NOT NULL,
  data_json        TEXT NOT NULL,
  recorded_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract);
CREATE INDEX IF NOT EXISTS idx_events_event    ON events(event);
CREATE INDEX IF NOT EXISTS idx_events_ledger   ON events(ledger);

CREATE TABLE IF NOT EXISTS checkpoint (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  listing_id    INTEGER PRIMARY KEY,
  seller        TEXT,
  bot_id        INTEGER,
  bot_tier      TEXT,
  price         TEXT,
  currency      TEXT,
  listed_at     INTEGER,
  listed_ledger INTEGER,
  status        TEXT NOT NULL
);
`;

export class IndexerDb {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  get raw(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  // ── Checkpoint (restart recovery) ─────────────────────────────────────────

  getCheckpoint(): number | null {
    const row = this.db
      .prepare("SELECT last_ledger FROM checkpoint WHERE id = 1")
      .get() as { last_ledger: number } | undefined;
    return row ? row.last_ledger : null;
  }

  saveCheckpoint(lastLedger: number): void {
    this.db
      .prepare(
        `INSERT INTO checkpoint (id, last_ledger, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_ledger = excluded.last_ledger,
                                       updated_at = excluded.updated_at`,
      )
      .run(lastLedger, new Date().toISOString());
  }

  // ── Raw events (idempotent insert) ────────────────────────────────────────

  private insertEventStmt() {
    return this.db.prepare(
      `INSERT OR IGNORE INTO events
         (id, contract_id, contract, event, ledger, tx_hash, event_index,
          ledger_closed_at, topics_json, data_json, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  private insertListingStmt() {
    return this.db.prepare(
      `INSERT INTO listings
         (listing_id, seller, bot_id, bot_tier, price, currency,
          listed_at, listed_ledger, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT(listing_id) DO UPDATE SET
         seller = excluded.seller,
         bot_id = excluded.bot_id,
         bot_tier = excluded.bot_tier,
         price = excluded.price,
         currency = excluded.currency,
         listed_at = excluded.listed_at,
         listed_ledger = excluded.listed_ledger,
         status = 'active'`,
    );
  }

  private closeListingStmt() {
    return this.db.prepare(
      `UPDATE listings SET status = ? WHERE listing_id = ?`,
    );
  }

  private touchListingStmt() {
    return this.db.prepare(
      `INSERT OR IGNORE INTO listings (listing_id, status) VALUES (?, 'unknown')`,
    );
  }

  private applyDerivedState(event: DecodedEvent): void {
    if (event.contract !== "marketplace") return;

    if (event.event === "listed") {
      // data = [bot_id, price]
      const [botId, price] = (event.data as unknown[]) ?? [];
      const [seller, listingId] = event.topics as [unknown, unknown];
      this.insertListingStmt().run(
        toNum(listingId),
        typeof seller === "string" ? seller : null,
        toNum(botId),
        null, // bot_tier not emitted by the contract today (AM-099 unresolved)
        toDecimal(price),
        null,
        null,
        event.ledger,
      );
    } else if (event.event === "bought" || event.event === "cancelled") {
      const listingId = toNum(event.topics[1]);
      // Ensure a row exists even if we never saw the original `listed` event
      // (e.g. indexing started mid-history): the floor-price query only looks
      // at status = 'active', so an unknown/absent listing cannot distort it.
      this.touchListingStmt().run(listingId);
      this.closeListingStmt().run(event.event === "bought" ? "sold" : "cancelled", listingId);
    }
  }

  /**
   * Insert a batch of events + derived state atomically.
   * Returns the number of NEW events persisted (0 for pure replays).
   */
  insertEvents(events: DecodedEvent[]): number {
    let inserted = 0;
    const tx = this.db.transaction((evts: DecodedEvent[]) => {
      for (const ev of evts) {
        const res = this.insertEventStmt().run(
          ev.id,
          ev.contractId,
          ev.contract,
          ev.event,
          ev.ledger,
          ev.txHash,
          ev.eventIndex,
          ev.ledgerClosedAt,
          jsonStringify(ev.topics),
          jsonStringify(ev.data),
          new Date().toISOString(),
        );
        if (res.changes === 1) {
          inserted += 1;
          this.applyDerivedState(ev);
        }
      }
    });
    tx(events);
    return inserted;
  }

  // ── Aggregate queries (computed at read time) ─────────────────────────────

  /** Unique registered users (distinct user addresses on `register`). */
  countUsers(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT json_extract(topics_json, '$[0]')) AS n
         FROM events WHERE contract = 'registry' AND event = 'register'`,
      )
      .get() as { n: number };
    return row.n;
  }

  countClaims(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE contract = 'accrual' AND event = 'claim'`,
      )
      .get() as { n: number };
    return row.n;
  }

  countTokenMints(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE contract = 'token' AND event = 'mint'`,
      )
      .get() as { n: number };
    return row.n;
  }

  /** Total AMT minted by the token contract (i128 sum as decimal string). */
  sumAmtMinted(): string {
    const rows = this.db
      .prepare(`SELECT data_json FROM events WHERE contract = 'token' AND event = 'mint'`)
      .all() as { data_json: string }[];
    let total = 0n;
    for (const { data_json } of rows) {
      const amount = toDecimal(JSON.parse(data_json));
      try {
        total += BigInt(amount);
      } catch {
        /* non-numeric payload — ignore rather than crash the aggregate */
      }
    }
    return total.toString();
  }

  /** Marketplace volume: sum of prices from `bought` events (i128). */
  sumVolume(): string {
    const rows = this.db
      .prepare(
        `SELECT data_json FROM events WHERE contract = 'marketplace' AND event = 'bought'`,
      )
      .all() as { data_json: string }[];
    let total = 0n;
    for (const { data_json } of rows) {
      const data = JSON.parse(data_json) as unknown[];
      const price = data[1];
      try {
        total += BigInt(toDecimal(price));
      } catch {
        /* ignore malformed payloads */
      }
    }
    return total.toString();
  }

  /** Min price among active listings (decimal string) or null. */
  floorPrice(): string | null {
    const rows = this.db
      .prepare(`SELECT price FROM listings WHERE status = 'active' AND price IS NOT NULL`)
      .all() as { price: string }[];
    let min: bigint | null = null;
    for (const { price } of rows) {
      try {
        const p = BigInt(price);
        if (min === null || p < min) min = p;
      } catch {
        /* ignore malformed price */
      }
    }
    return min === null ? null : min.toString();
  }

  countActiveListings(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM listings WHERE status = 'active'`)
      .get() as { n: number };
    return row.n;
  }

  latestLedger(): number {
    return this.getCheckpoint() ?? 0;
  }

  lastIndexedAt(): string | null {
    const row = this.db
      .prepare(`SELECT MAX(recorded_at) AS t FROM events`)
      .get() as { t: string | null };
    return row.t;
  }

  /** Per-day claims / AMT minted / volume for the last `days` days. */
  daily(days = 30): DailyRow[] {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const fromDay = from.toISOString().slice(0, 10);

    const rows = this.db
      .prepare(
        `SELECT substr(ledger_closed_at, 1, 10) AS day,
                contract, event, data_json
         FROM events
         WHERE ledger_closed_at IS NOT NULL
           AND substr(ledger_closed_at, 1, 10) >= ?
         ORDER BY day`,
      )
      .all(fromDay) as {
      day: string;
      contract: string;
      event: string;
      data_json: string;
    }[];

    const byDay = new Map<string, { claims: number; amt: bigint; volume: bigint }>();
    for (const r of rows) {
      let entry = byDay.get(r.day);
      if (!entry) {
        entry = { claims: 0, amt: 0n, volume: 0n };
        byDay.set(r.day, entry);
      }
      if (r.contract === "accrual" && r.event === "claim") entry.claims += 1;
      if (r.contract === "token" && r.event === "mint") {
        try {
          entry.amt += BigInt(toDecimal(JSON.parse(r.data_json)));
        } catch {
          /* ignore */
        }
      }
      if (r.contract === "marketplace" && r.event === "bought") {
        try {
          const data = JSON.parse(r.data_json) as unknown[];
          entry.volume += BigInt(toDecimal(data[1]));
        } catch {
          /* ignore */
        }
      }
    }

    const out: DailyRow[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(from.getTime() + i * 86_400_000);
      const day = d.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { claims: 0, amt: 0n, volume: 0n };
      out.push({
        day,
        claims: entry.claims,
        amt_minted: entry.amt.toString(),
        volume: entry.volume.toString(),
      });
    }
    return out;
  }

  /** Recent raw events (dashboard / debug). */
  recentEvents(limit = 50, offset = 0): EventRow[] {
    return this.db
      .prepare(
        `SELECT id, contract_id, contract, event, ledger, tx_hash, event_index,
                ledger_closed_at, topics_json, data_json, recorded_at
         FROM events ORDER BY ledger DESC, event_index DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as EventRow[];
  }

  summary(): Summary {
    return {
      users: this.countUsers(),
      total_claims: this.countClaims(),
      total_mints: this.countTokenMints(),
      amt_minted: this.sumAmtMinted(),
      volume: this.sumVolume(),
      floor_price: this.floorPrice(),
      active_listings: this.countActiveListings(),
      latest_ledger: this.latestLedger(),
      last_indexed_at: this.lastIndexedAt(),
    };
  }
}


