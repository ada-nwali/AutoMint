import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IndexerDb } from "../db.js";
import { Poller } from "../poller.js";
import { makeDecoder } from "../events.js";
import {
  G1,
  CACC,
  CTOK,
  addr,
  i128,
  makeRawEvent,
  sym,
  u64,
  vec,
  testConfig,
  FakeRpcClient,
  toRawRpcEvent,
} from "./helpers.js";

const config = testConfig();

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-indexer-test-"));
  return path.join(dir, "index.db");
}

describe("restart recovery + idempotency (#563 acceptance)", () => {
  it("resumes from the checkpoint without skipping or double-counting", async () => {
    const dbPath = tmpDbPath();

    // ── Run 1: index ledgers 1000-1004, then "crash" ──────────────────────
    const events1 = [
      makeRawEvent({ contractId: CACC, topics: [sym("claim"), addr(G1)], value: vec([u64(100), u64(0)]), ledger: 1000, seq: 0, closedAt: "2024-01-01T00:00:00Z" }),
      makeRawEvent({ contractId: CACC, topics: [sym("claim"), addr(G1)], value: vec([u64(100), u64(0)]), ledger: 1001, seq: 0, closedAt: "2024-01-01T00:00:00Z" }),
      makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(10), ledger: 1002, seq: 0, closedAt: "2024-01-01T00:00:00Z" }),
      makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(10), ledger: 1003, seq: 0, closedAt: "2024-01-01T00:00:00Z" }),
      makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(10), ledger: 1004, seq: 0, closedAt: "2024-01-01T00:00:00Z" }),
    ].map(toRawRpcEvent);

    {
      const db = new IndexerDb(dbPath);
      const rpc = new FakeRpcClient([{ events: events1, latestLedger: 1004, cursor: null }]);
      const poller = new Poller({ rpc, db, config });
      const res = await poller.pollOnce();
      expect(res.inserted).toBe(5);
      expect(db.getCheckpoint()).toBe(1004);
      db.close(); // simulate a crash: no further writes
    }

    // ── Run 2: "restart" — RPC replays 1000-1004 (overlap) + new 1005-1007 ─
    const events2 = [
      ...events1, // overlapping window re-fetched by the RPC
      toRawRpcEvent(makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(10), ledger: 1005, seq: 0, closedAt: "2024-01-01T00:00:00Z" })),
      toRawRpcEvent(makeRawEvent({ contractId: CACC, topics: [sym("claim"), addr(G1)], value: vec([u64(100), u64(0)]), ledger: 1006, seq: 0, closedAt: "2024-01-01T00:00:00Z" })),
      toRawRpcEvent(makeRawEvent({ contractId: CACC, topics: [sym("claim"), addr(G1)], value: vec([u64(100), u64(0)]), ledger: 1007, seq: 0, closedAt: "2024-01-01T00:00:00Z" })),
    ];

    const db2 = new IndexerDb(dbPath);
    const rpc2 = new FakeRpcClient([{ events: events2, latestLedger: 1007, cursor: null }]);
    const poller2 = new Poller({ rpc: rpc2, db: db2, config });

    const res = await poller2.pollOnce();

    // The restart must resume from checkpoint+1 = 1005, not from 1000.
    const startCall = rpc2.calls[0].startLedger;
    expect(startCall).toBe(1005);

    // Only the 3 NEW events inserted; the 5 overlapping ones were ignored.
    expect(res.inserted).toBe(3);

    const summary = db2.summary();
    expect(summary.total_claims).toBe(4); // 2 + 2, not 5, not 8
    expect(summary.total_mints).toBe(4); // 3 + 1, not 10
    expect(summary.amt_minted).toBe("40"); // 4 * 10, not 8 * 10
    expect(db2.getCheckpoint()).toBe(1007);
    expect(db2.recentEvents(100).length).toBe(8); // no duplicates in the raw log

    db2.close();
  });

  it("checkpoint survives db reopen (crash between checkpoint and next batch)", () => {
    const dbPath = tmpDbPath();
    const db = new IndexerDb(dbPath);
    expect(db.getCheckpoint()).toBeNull();
    db.saveCheckpoint(555);
    db.close();

    const reopened = new IndexerDb(dbPath);
    expect(reopened.getCheckpoint()).toBe(555);
    reopened.close();
  });

  it("insertEvents is idempotent for the same event id", () => {
    const db = new IndexerDb(":memory:");
    const raw = makeRawEvent({
      contractId: CTOK,
      topics: [sym("mint"), addr(G1)],
      value: i128(10),
      ledger: 1000,
      seq: 0,
    });
    const decoded = makeDecoder(config).decode(raw); // stamps contract = "token"

    expect(db.insertEvents([decoded])).toBe(1);
    expect(db.insertEvents([decoded])).toBe(0); // replay → no change
    expect(db.sumAmtMinted()).toBe("10"); // not 20
    db.close();
  });
});
