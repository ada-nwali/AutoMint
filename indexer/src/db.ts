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
 *   - `listings`   — derived marketplace listing state (active/sold/cancelled/
 *                    reclaimed/deactivated) with its currency, so the per-currency
 *                    "floor price" can be computed as the min price over active
 *                    listings without replaying history.
 *
 * Event → derived-state updates happen inside the SAME transaction as the raw
 * insert and only when the insert actually landed (`changes() === 1`), so a
 * crash mid-batch can never leave derived state ahead of the raw log.
 */
import Database from "better-sqlite3";
import type {
  DailyRow,
  DecodedEvent,
  EventRow,
  MarketSummary,
  Summary,
} from "./types.js";
import { jsonStringify, toDecimal } from "./events.js";

/** Aggregate key prefix for marketplace volume; the suffix is the currency. */
const VOLUME_PREFIX = "marketplace_volume:";
const MARKETPLACE_SCHEMA_KEY = "marketplace_schema";
/**
 * Version of the marketplace derivation (listing state + per-currency volume).
 * Databases stamped with an older version are rebuilt from the event log.
 */
const MARKETPLACE_SCHEMA_VERSION = "2";

const LISTINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  listing_id    TEXT PRIMARY KEY,
  seller        TEXT,
  bot_id        TEXT,
  bot_tier      TEXT,
  price         TEXT,
  currency      TEXT,
  listed_at     INTEGER,
  listed_ledger INTEGER,
  status        TEXT NOT NULL
);
`;

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
CREATE INDEX IF NOT EXISTS idx_events_contract_event ON events(contract, event);
CREATE INDEX IF NOT EXISTS idx_events_closed_at ON events(ledger_closed_at);

CREATE TABLE IF NOT EXISTS checkpoint (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aggregates (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
${LISTINGS_SCHEMA}
`;

/**
 * Statements on the per-event write path, compiled once per connection rather
 * than once per event (#1237). Requires SCHEMA to exist; a later schema change
 * (the listings migration) is handled by SQLite re-preparing on next step.
 */
function prepareWriteStatements(db: Database.Database) {
  return {
    insertEvent: db.prepare(
      `INSERT OR IGNORE INTO events
         (id, contract_id, contract, event, ledger, tx_hash, event_index,
          ledger_closed_at, topics_json, data_json, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertListing: db.prepare(
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
    ),
    closeListing: db.prepare(
      `UPDATE listings SET status = ? WHERE listing_id = ?`,
    ),
    touchListing: db.prepare(
      `INSERT OR IGNORE INTO listings (listing_id, status) VALUES (?, 'unknown')`,
    ),
    updateListingPrice: db.prepare(
      `UPDATE listings SET price = ? WHERE listing_id = ? AND status = 'active'`,
    ),
    selectAggregate: db.prepare("SELECT value FROM aggregates WHERE key = ?"),
    upsertAggregate: db.prepare(
      `INSERT INTO aggregates (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
  };
}

export class IndexerDb {
  private readonly db: Database.Database;
  private readonly stmts: ReturnType<typeof prepareWriteStatements>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    // Before the migrations below: they replay events through these statements.
    this.stmts = prepareWriteStatements(this.db);
    this.migrateListingIdentifiers();
    this.initializeAggregates();
    this.migrateMarketplaceSchema();
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

  /** Close a listing on a lifecycle event (`sold`, `cancel`, ...). */
  private closeListing(listingId: unknown, status: string): void {
    const id = toDecimal(listingId);
    // Ensure a row exists even if we never saw the original `listed` event
    // (e.g. indexing started mid-history): the floor-price query only looks
    // at status = 'active', so an unknown/absent listing cannot distort it.
    this.stmts.touchListing.run(id);
    this.stmts.closeListing.run(status, id);
  }

  /**
   * Listing state from the marketplace event schemas in `docs/EVENTS.md`.
   * The listing id sits in a different slot for each event, so each is read
   * from its own position.
   */
  private applyListingState(
    event: Pick<DecodedEvent, "event" | "topics" | "data" | "ledger">,
  ): void {
    const data = (event.data as unknown[]) ?? [];
    switch (event.event) {
      case "listed": {
        // topics = [seller, listing_id]; data = [bot_id, price, currency]
        const [seller, listingId] = event.topics as [unknown, unknown];
        const [botId, price, currency] = data;
        this.stmts.insertListing.run(
          toDecimal(listingId),
          typeof seller === "string" ? seller : null,
          toDecimal(botId),
          null, // bot_tier not emitted by the contract today (AM-099 unresolved)
          toDecimal(price),
          typeof currency === "string" ? currency : null,
          null,
          event.ledger,
        );
        break;
      }
      case "sold":
        // topics = [seller, buyer]; data = [listing_id, bot_id, price, currency]
        this.closeListing(data[0], "sold");
        break;
      case "cancel":
        // topics = [seller, listing_id]; data = bot_id
        this.closeListing(event.topics[1], "cancelled");
        break;
      case "reclaimed":
        // topics = [seller, listing_id]; data = bot_id
        this.closeListing(event.topics[1], "reclaimed");
        break;
      case "deactive":
        // topics = [bot_id]; data = listing_id
        this.closeListing(event.data, "deactivated");
        break;
      case "price_upd":
        // topics = [seller, listing_id]; data = [old_price, new_price].
        // Only an active listing's price counts toward the floor.
        this.stmts.updateListingPrice.run(
          toDecimal(data[1]),
          toDecimal(event.topics[1]),
        );
        break;
      default:
        break;
    }
  }

  /** Listing state plus per-currency volume for one marketplace event. */
  private applyMarketplaceEvent(
    event: Pick<DecodedEvent, "event" | "topics" | "data" | "ledger">,
  ): void {
    this.applyListingState(event);
    if (event.event === "sold") {
      // Volume is keyed by currency: amounts in different tokens are never
      // summed together.
      const [, , price, currency] = (event.data as unknown[]) ?? [];
      if (typeof currency === "string") {
        this.addAggregate(`${VOLUME_PREFIX}${currency}`, price);
      }
    }
  }

  private applyDerivedState(event: DecodedEvent): void {
    if (event.contract === "marketplace") {
      this.applyMarketplaceEvent(event);
    }
    if (event.contract === "token" && event.event === "mint") {
      this.addAggregate("amt_minted", event.data);
    }
  }

  private addAggregate(key: string, rawAmount: unknown): void {
    let amount: bigint;
    try {
      amount = BigInt(toDecimal(rawAmount));
    } catch {
      return;
    }
    const row = this.stmts.selectAggregate.get(key) as
      | { value: string }
      | undefined;
    const current = row ? BigInt(row.value) : 0n;
    this.stmts.upsertAggregate.run(key, (current + amount).toString());
  }

  /** One-time migration for databases created before exact totals existed. */
  private initializeAggregates(): void {
    const existing = this.db
      .prepare("SELECT COUNT(*) AS n FROM aggregates")
      .get() as { n: number };
    if (existing.n > 0) return;

    const rows = this.db
      .prepare(
        `SELECT data_json FROM events WHERE contract = 'token' AND event = 'mint'`,
      )
      .all() as { data_json: string }[];

    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO aggregates (key, value) VALUES (?, '0')")
        .run("amt_minted");
      for (const row of rows) {
        try {
          this.addAggregate("amt_minted", JSON.parse(row.data_json) as unknown);
        } catch {
          // Keep migration resilient to malformed historical payloads.
        }
      }
    })();
  }

  /**
   * Marketplace listing state and volume are derived from the raw event log.
   * Databases built before version 2 mixed currencies in one volume total and
   * never closed listings on `sold`/`cancel` (those names were not handled),
   * so they are rebuilt once from the stored marketplace events.
   */
  private migrateMarketplaceSchema(): void {
    const current = this.db
      .prepare("SELECT value FROM aggregates WHERE key = ?")
      .get(MARKETPLACE_SCHEMA_KEY) as { value: string } | undefined;
    if (current?.value === MARKETPLACE_SCHEMA_VERSION) return;

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM listings").run();
      this.db
        .prepare("DELETE FROM aggregates WHERE key GLOB 'marketplace_volume*'")
        .run();
      const events = this.db
        .prepare(
          `SELECT event, topics_json, data_json, ledger
           FROM events WHERE contract = 'marketplace' ORDER BY rowid`,
        )
        .iterate() as Iterable<{
        event: string;
        topics_json: string;
        data_json: string;
        ledger: number;
      }>;
      for (const event of events) {
        this.applyMarketplaceEvent({
          event: event.event,
          topics: JSON.parse(event.topics_json) as unknown[],
          data: JSON.parse(event.data_json) as unknown,
          ledger: event.ledger,
        });
      }
      this.db
        .prepare(
          `INSERT INTO aggregates (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(MARKETPLACE_SCHEMA_KEY, MARKETPLACE_SCHEMA_VERSION);
    })();
  }

  private migrateListingIdentifiers(): void {
    const columns = this.db.pragma("table_info(listings)") as {
      name: string;
      type: string;
    }[];
    const listingIdType = columns
      .find(({ name }) => name === "listing_id")
      ?.type.toUpperCase();
    const botIdType = columns
      .find(({ name }) => name === "bot_id")
      ?.type.toUpperCase();
    if (listingIdType === "TEXT" && botIdType === "TEXT") {
      return;
    }

    this.db.transaction(() => {
      this.db.exec("ALTER TABLE listings RENAME TO listings_legacy");
      this.db.exec(LISTINGS_SCHEMA);
      this.db.exec("DROP TABLE listings_legacy");
      const existingEvents = this.db
        .prepare(
          `SELECT event, topics_json, data_json, ledger
           FROM events WHERE contract = 'marketplace' ORDER BY rowid`,
        )
        .iterate() as Iterable<{
        event: string;
        topics_json: string;
        data_json: string;
        ledger: number;
      }>;
      for (const event of existingEvents) {
        this.applyListingState({
          event: event.event,
          topics: JSON.parse(event.topics_json) as unknown[],
          data: JSON.parse(event.data_json) as unknown,
          ledger: event.ledger,
        });
      }
    })();
  }

  /**
   * Insert a batch of events + derived state atomically.
   * Returns the number of NEW events persisted (0 for pure replays).
   */
  insertEvents(events: DecodedEvent[]): number {
    let inserted = 0;
    const tx = this.db.transaction((evts: DecodedEvent[]) => {
      for (const ev of evts) {
        const res = this.stmts.insertEvent.run(
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

  // ── Aggregate queries ──────────────────────────────────────────────────────

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
    return this.aggregateValue("amt_minted");
  }

  /** Marketplace volume per currency: sum of `sold` prices (i128 strings). */
  volumeByCurrency(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT key, value FROM aggregates WHERE key GLOB ?")
      .all(`${VOLUME_PREFIX}*`) as { key: string; value: string }[];
    return Object.fromEntries(
      rows.map(({ key, value }) => [key.slice(VOLUME_PREFIX.length), value]),
    );
  }

  private aggregateValue(key: string): string {
    const row = this.db
      .prepare("SELECT value FROM aggregates WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? "0";
  }

  /** Min price among active listings, per currency (decimal strings). */
  floorPriceByCurrency(): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT currency, price FROM listings
         WHERE status = 'active' AND price IS NOT NULL AND currency IS NOT NULL`,
      )
      .all() as { currency: string; price: string }[];
    const floors = new Map<string, bigint>();
    for (const { currency, price } of rows) {
      try {
        const p = BigInt(price);
        const current = floors.get(currency);
        if (current === undefined || p < current) floors.set(currency, p);
      } catch {
        /* ignore malformed price */
      }
    }
    return new Map(
      [...floors].map(([currency, p]) => [currency, p.toString()] as const),
    );
  }

  /** Volume, floor and active-listing count for each currency in use. */
  marketSummaries(): MarketSummary[] {
    const volumes = this.volumeByCurrency();
    const floors = this.floorPriceByCurrency();
    const counts = this.db
      .prepare(
        `SELECT currency, COUNT(*) AS n FROM listings
         WHERE status = 'active' AND currency IS NOT NULL GROUP BY currency`,
      )
      .all() as { currency: string; n: number }[];
    const activeByCurrency = new Map(
      counts.map(({ currency, n }) => [currency, n] as const),
    );

    const currencies = new Set([
      ...Object.keys(volumes),
      ...floors.keys(),
      ...activeByCurrency.keys(),
    ]);
    return [...currencies].sort().map((currency) => ({
      currency,
      volume: volumes[currency] ?? "0",
      floor_price: floors.get(currency) ?? null,
      active_listings: activeByCurrency.get(currency) ?? 0,
    }));
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
         WHERE ledger_closed_at >= ?
         ORDER BY ledger_closed_at`,
      )
      .all(fromDay) as {
      day: string;
      contract: string;
      event: string;
      data_json: string;
    }[];

    const emptyDay = () => ({
      claims: 0,
      amt: 0n,
      volume: new Map<string, bigint>(),
    });
    const byDay = new Map<string, ReturnType<typeof emptyDay>>();
    for (const r of rows) {
      let entry = byDay.get(r.day);
      if (!entry) {
        entry = emptyDay();
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
      if (r.contract === "marketplace" && r.event === "sold") {
        try {
          // data = [listing_id, bot_id, price, currency]
          const [, , price, currency] = JSON.parse(r.data_json) as unknown[];
          if (typeof currency === "string") {
            const prior = entry.volume.get(currency) ?? 0n;
            entry.volume.set(currency, prior + BigInt(toDecimal(price)));
          }
        } catch {
          /* ignore */
        }
      }
    }

    const out: DailyRow[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(from.getTime() + i * 86_400_000);
      const day = d.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? emptyDay();
      out.push({
        day,
        claims: entry.claims,
        amt_minted: entry.amt.toString(),
        volume_by_currency: Object.fromEntries(
          [...entry.volume].map(([currency, v]) => [currency, v.toString()]),
        ),
      });
    }
    return out;
  }

  /** Total indexed events — the pagination total for `recentEvents`. */
  countEvents(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM events`)
      .get() as { n: number };
    return row.n;
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
      markets: this.marketSummaries(),
      active_listings: this.countActiveListings(),
      latest_ledger: this.latestLedger(),
      last_indexed_at: this.lastIndexedAt(),
    };
  }
}
