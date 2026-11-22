import { describe, it, expect, beforeEach } from "vitest";
import { IndexerDb } from "../db.js";
import { decodeRawEvent, makeDecoder } from "../events.js";
import type { DecodedEvent, MarketSummary } from "../types.js";
import {
  G1,
  G2,
  CREG,
  CBOT,
  CACC,
  CMAR,
  CTOK,
  addr,
  i128,
  makeRawEvent,
  sym,
  u64,
  vec,
  testConfig,
} from "./helpers.js";

const config = testConfig();
const decoder = makeDecoder(config);

function today(): string {
  return new Date().toISOString();
}

let db: IndexerDb;

beforeEach(() => {
  db = new IndexerDb(":memory:");
});

function insert(
  contractId: string,
  topics: unknown[],
  value: unknown,
  seq: number,
): void {
  const raw = makeRawEvent({
    contractId,
    topics: topics as never,
    value: value as never,
    ledger: 1000 + seq,
    seq,
    closedAt: today(),
  });
  db.insertEvents([decoder.decode(raw)]);
}

/** Marketplace events, built to the payload shapes in docs/EVENTS.md. */
function list(seq: number, listingId: bigint, botId: bigint, price: bigint, currency: string) {
  insert(
    CMAR,
    [sym("listed"), addr(G1), u64(listingId)],
    vec([u64(botId), i128(price), addr(currency)]),
    seq,
  );
}

function sold(seq: number, listingId: bigint, botId: bigint, price: bigint, currency: string) {
  insert(
    CMAR,
    [sym("sold"), addr(G1), addr(G2)],
    vec([u64(listingId), u64(botId), i128(price), addr(currency)]),
    seq,
  );
}

/** Markets keyed by currency, so assertions don't depend on sort order. */
function marketsByCurrency(): Record<string, MarketSummary> {
  return Object.fromEntries(db.summary().markets.map((m) => [m.currency, m]));
}

describe("IndexerDb aggregates", () => {
  it("counts users, claims, mints; sums AMT + volume; tracks listings/floor price", () => {
    // Two users register (G1 twice — must count once).
    insert(CREG, [sym("register"), addr(G1)], u64(1), 1);
    insert(CREG, [sym("register"), addr(G1)], u64(2), 2);
    insert(CREG, [sym("register"), addr(G2)], u64(3), 3);

    // Two claims by G1.
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(1500), u64(200)]), 4);
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(900), u64(50)]), 5);

    // Token mints: 1000 + 250.
    insert(CTOK, [sym("mint"), addr(G1)], i128(1000), 6);
    insert(CTOK, [sym("mint"), addr(G2)], i128(250), 7);

    // Two listings in the same currency: 500 and 1000.
    list(8, 1n, 10n, 500n, CTOK);
    list(9, 2n, 11n, 1000n, CTOK);

    // Sell listing 1 (price 500).
    sold(10, 1n, 10n, 500n, CTOK);

    const s = db.summary();
    expect(s.users).toBe(2);
    expect(s.total_claims).toBe(2);
    expect(s.total_mints).toBe(2);
    expect(s.amt_minted).toBe("1250");
    expect(s.markets).toEqual([
      { currency: CTOK, volume: "500", floor_price: "1000", active_listings: 1 },
    ]);
    expect(s.active_listings).toBe(1);
    expect(s.latest_ledger).toBe(0); // no checkpoint saved yet
  });

  it("handles large i128 amounts without precision loss", () => {
    const big = 170141183460469231731687303715884105727n; // i128::MAX
    insert(CTOK, [sym("mint"), addr(G1)], i128(big), 1);
    insert(CTOK, [sym("mint"), addr(G1)], i128(big), 2);
    expect(db.sumAmtMinted()).toBe((big + big).toString());
  });

  it("reads summary totals from constant-size aggregate rows", () => {
    insert(CTOK, [sym("mint"), addr(G1)], i128(100), 1);
    list(2, 1n, 1n, 75n, CTOK);
    sold(3, 1n, 1n, 75n, CTOK);

    db.raw.prepare("DELETE FROM events").run();

    expect(db.sumAmtMinted()).toBe("100");
    expect(db.volumeByCurrency()).toEqual({ [CTOK]: "75" });
  });

  it("does not double-count aggregate totals when an event is replayed", () => {
    const raw = makeRawEvent({
      contractId: CTOK,
      topics: [sym("mint"), addr(G1)],
      value: i128(42),
      ledger: 1001,
      seq: 1,
      closedAt: today(),
    });
    const event = decoder.decode(raw);

    expect(db.insertEvents([event])).toBe(1);
    expect(db.insertEvents([event])).toBe(0);
    expect(db.sumAmtMinted()).toBe("42");
  });

  it("derives daily claims / amt / volume rows", () => {
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(1500), u64(0)]), 1);
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(900), u64(0)]), 2);
    insert(CTOK, [sym("mint"), addr(G1)], i128(1000), 3);
    list(4, 5n, 10n, 777n, CTOK);
    sold(5, 5n, 10n, 777n, CTOK);

    const rows = db.daily(7);
    const todayRow = rows[rows.length - 1];
    expect(todayRow.claims).toBe(2);
    expect(todayRow.amt_minted).toBe("1000");
    expect(todayRow.volume_by_currency).toEqual({ [CTOK]: "777" });
  });

  it("tracks listing lifecycle through cancel", () => {
    list(1, 7n, 20n, 600n, CTOK);
    list(2, 8n, 21n, 900n, CTOK);
    insert(CMAR, [sym("cancel"), addr(G1), u64(8)], u64(21), 3);

    expect(db.countActiveListings()).toBe(1);
    expect(db.floorPriceByCurrency().get(CTOK)).toBe("600");
  });

  it("applies price updates, reclaims and deactivations to derived state", () => {
    list(1, 1n, 10n, 600n, CTOK);
    insert(
      CMAR,
      [sym("price_upd"), addr(G1), u64(1)],
      vec([i128(600), i128(650)]),
      2,
    );
    list(3, 2n, 11n, 900n, CTOK);
    // The bot in listing 2 was moved out of the marketplace.
    insert(CMAR, [sym("deactive"), u64(11)], u64(2), 4);
    list(5, 3n, 12n, 700n, CTOK);
    insert(CMAR, [sym("reclaimed"), addr(G1), u64(3)], u64(12), 6);

    expect(db.countActiveListings()).toBe(1);
    expect(db.floorPriceByCurrency().get(CTOK)).toBe("650");
    expect(
      db.raw
        .prepare("SELECT listing_id, status FROM listings ORDER BY listing_id")
        .all(),
    ).toEqual([
      { listing_id: "1", status: "active" },
      { listing_id: "2", status: "deactivated" },
      { listing_id: "3", status: "reclaimed" },
    ]);
  });

  it("keeps volume and floor separate for each currency", () => {
    list(1, 1n, 10n, 500n, CTOK);
    list(2, 2n, 11n, 100n, CBOT);
    list(3, 3n, 12n, 300n, CTOK);
    sold(4, 2n, 11n, 100n, CBOT);

    const markets = marketsByCurrency();
    expect(markets[CBOT]).toEqual({
      currency: CBOT,
      volume: "100",
      floor_price: null,
      active_listings: 0,
    });
    expect(markets[CTOK]).toEqual({
      currency: CTOK,
      volume: "0",
      floor_price: "300",
      active_listings: 2,
    });
    expect(db.summary().active_listings).toBe(2);
  });

  it("keeps distinct full-width listing IDs distinct in SQLite", () => {
    const firstId = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const secondId = firstId + 1n;
    list(1, firstId, firstId, 600n, CTOK);
    list(2, secondId, secondId, 900n, CTOK);

    const rows = db.raw
      .prepare(
        "SELECT listing_id, typeof(listing_id) AS storage_type FROM listings ORDER BY rowid",
      )
      .all() as { listing_id: string; storage_type: string }[];
    expect(rows).toEqual([
      { listing_id: firstId.toString(), storage_type: "text" },
      { listing_id: secondId.toString(), storage_type: "text" },
    ]);
    expect(db.countActiveListings()).toBe(2);

    insert(CMAR, [sym("cancel"), addr(G1), u64(firstId)], u64(firstId), 3);
    expect(db.countActiveListings()).toBe(1);
    expect(
      db.raw
        .prepare("SELECT status FROM listings WHERE listing_id = ?")
        .get(firstId.toString()),
    ).toEqual({ status: "cancelled" });
  });

  it("rejects events from failed contract calls at the DB layer is not needed — poller filters", () => {
    // The poller filters inSuccessfulContractCall; here we just confirm the
    // insert path accepts events regardless and counts them.
    insert(CTOK, [sym("mint"), addr(G1)], i128(5), 1);
    expect(db.sumAmtMinted()).toBe("5");
  });

  it("summary and daily queries are index-backed, not full scans (#1245)", () => {
    const plan = (sql: string, ...args: unknown[]) =>
      (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
        .map((r) => r.detail)
        .join("\n");

    expect(
      plan("SELECT COUNT(*) FROM events WHERE contract = ? AND event = ?", "accrual", "claim"),
    ).toContain("idx_events_contract_event");
    expect(
      plan("SELECT 1 FROM events WHERE ledger_closed_at >= ? ORDER BY ledger_closed_at", "2026-01-01"),
    ).toContain("idx_events_closed_at");
  });

  it("daily() buckets by UTC day with the range filter (#1245)", () => {
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(100), u64(1)]), 1);
    const rows = db.daily(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe(today().slice(0, 10));
    expect(rows[0].claims).toBe(1);
  });
});
