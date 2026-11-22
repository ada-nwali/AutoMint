import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IndexerDb } from "../db.js";
import { makeDecoder } from "../events.js";
import {
  G1,
  G2,
  CMAR,
  CTOK,
  addr,
  i128,
  makeRawEvent,
  sym,
  testConfig,
  u64,
  vec,
} from "./helpers.js";

describe("IndexerDb migrations", () => {
  let directory: string | undefined;
  let db: IndexerDb | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("rebuilds marketplace volume and listing state from events for pre-v2 databases", () => {
    directory = mkdtempSync(join(tmpdir(), "automint-indexer-migration-"));
    const databasePath = join(directory, "indexer.sqlite");
    const decoder = makeDecoder(testConfig());
    const insert = (
      seq: number,
      topics: ReturnType<typeof sym>[],
      value: Parameters<typeof makeRawEvent>[0]["value"],
    ) =>
      decoder.decode(
        makeRawEvent({
          contractId: CMAR,
          topics,
          value,
          ledger: 100 + seq,
          seq,
          closedAt: new Date().toISOString(),
        }),
      );

    const first = new IndexerDb(databasePath);
    first.insertEvents([
      insert(
        1,
        [sym("listed"), addr(G1), u64(1)],
        vec([u64(10), i128(500), addr(CTOK)]),
      ),
      insert(
        2,
        [sym("sold"), addr(G1), addr(G2)],
        vec([u64(1), u64(10), i128(500), addr(CTOK)]),
      ),
      insert(
        3,
        [sym("listed"), addr(G1), u64(2)],
        vec([u64(11), i128(800), addr(CTOK)]),
      ),
    ]);
    // Reproduce the state written by the version-1 indexer: a single mixed
    // volume total, no schema stamp, and listings never closed by `sold`.
    first.raw.prepare("DELETE FROM aggregates WHERE key = 'marketplace_schema'").run();
    first.raw
      .prepare("UPDATE aggregates SET value = '999' WHERE key = ?")
      .run(`marketplace_volume:${CTOK}`);
    first.raw.prepare("UPDATE listings SET status = 'active' WHERE listing_id = '1'").run();
    first.close();

    db = new IndexerDb(databasePath);
    expect(db.volumeByCurrency()).toEqual({ [CTOK]: "500" });
    expect(db.summary().markets).toEqual([
      { currency: CTOK, volume: "500", floor_price: "800", active_listings: 1 },
    ]);
  });

  it("rebuilds legacy listing state from exact marketplace event identifiers", () => {
    directory = mkdtempSync(join(tmpdir(), "automint-indexer-migration-"));
    const databasePath = join(directory, "indexer.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        contract TEXT NOT NULL,
        event TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        ledger_closed_at TEXT,
        topics_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE TABLE checkpoint (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_ledger INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE listings (
        listing_id INTEGER PRIMARY KEY,
        seller TEXT,
        bot_id INTEGER,
        bot_tier TEXT,
        price TEXT,
        currency TEXT,
        listed_at INTEGER,
        listed_ledger INTEGER,
        status TEXT NOT NULL
      );
    `);

    const firstId = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const secondId = firstId + 1n;
    const insertEvent = legacy.prepare(
      `INSERT INTO events
        (id, contract_id, contract, event, ledger, tx_hash, event_index,
         ledger_closed_at, topics_json, data_json, recorded_at)
       VALUES (?, ?, 'marketplace', ?, ?, ?, ?, NULL, ?, ?, ?)`,
    );
    const events = [
      ["listed", firstId],
      ["listed", secondId],
      ["cancel", firstId],
    ] as const;
    events.forEach(([eventName, listingId], index) => {
      insertEvent.run(
        `event-${index}`,
        "contract",
        eventName,
        index + 1,
        `tx-${index}`,
        index,
        JSON.stringify([G1, listingId.toString()]),
        eventName === "listed" ? JSON.stringify([listingId.toString(), "500"]) : "0",
        new Date().toISOString(),
      );
    });
    legacy.prepare("INSERT INTO listings (listing_id, status) VALUES (?, 'active')")
      .run(1);
    legacy.close();

    db = new IndexerDb(databasePath);
    const rows = db.raw
      .prepare("SELECT listing_id, status FROM listings ORDER BY rowid")
      .all() as { listing_id: string; status: string }[];
    expect(rows).toEqual([
      { listing_id: firstId.toString(), status: "cancelled" },
      { listing_id: secondId.toString(), status: "active" },
    ]);
    expect(db.countActiveListings()).toBe(1);
  });
});
