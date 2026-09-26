import { describe, it, expect } from "vitest";
import { Poller } from "../poller.js";
import { IndexerDb } from "../db.js";
import {
  G1,
  G2,
  CTOK,
  CACC,
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

describe("Poller", () => {
  it("fetches a full page, inserts events, advances the checkpoint", async () => {
    const db = new IndexerDb(":memory:");
    const page = [
      toRawRpcEvent(makeRawEvent({ contractId: CACC, topics: [sym("claim"), addr(G1)], value: vec([u64(10), u64(0)]), ledger: 200, seq: 0, closedAt: "2024-01-01T00:00:00Z" })),
      toRawRpcEvent(makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(5), ledger: 201, seq: 0, closedAt: "2024-01-01T00:00:00Z" })),
    ];
    const rpc = new FakeRpcClient([{ events: page, latestLedger: 201, cursor: null }]);
    const poller = new Poller({ rpc, db, config, defaultStartLedger: 200 });

    const res = await poller.pollOnce();
    expect(res.fetched).toBe(2);
    expect(res.inserted).toBe(2);
    expect(res.latestLedger).toBe(201);
    expect(db.getCheckpoint()).toBe(201);
    expect(db.countClaims()).toBe(1);
    expect(db.sumAmtMinted()).toBe("5");
    db.close();
  });

  it("skips events from failed (reverted) contract calls", async () => {
    const db = new IndexerDb(":memory:");
    const good = toRawRpcEvent(makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(5), ledger: 300, seq: 0 }));
    const bad = toRawRpcEvent(
      makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(999), ledger: 301, seq: 0, inSuccessful: false }),
    );
    const rpc = new FakeRpcClient([{ events: [good, bad], latestLedger: 301, cursor: null }]);
    const poller = new Poller({ rpc, db, config });

    const res = await poller.pollOnce();
    expect(res.skipped).toBe(1);
    expect(res.inserted).toBe(1);
    expect(db.sumAmtMinted()).toBe("5");
    db.close();
  });

  it("run() loops until aborted and stops cleanly", async () => {
    const db = new IndexerDb(":memory:");
    const page = [
      toRawRpcEvent(makeRawEvent({ contractId: CTOK, topics: [sym("mint"), addr(G1)], value: i128(1), ledger: 400, seq: 0 })),
    ];
    const rpc = new FakeRpcClient([
      { events: page, latestLedger: 400, cursor: null },
      { events: [], latestLedger: 401, cursor: null },
      { events: [], latestLedger: 402, cursor: null },
    ]);
    const poller = new Poller({ rpc, db, config, defaultStartLedger: 400 });

    const controller = new AbortController();
    const done = poller.run(1, controller.signal);
    // Let it run a couple of iterations, then abort.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await done;

    expect(db.sumAmtMinted()).toBe("1");
    expect(db.getCheckpoint()).toBe(402);
    expect(rpc.calls.length).toBeGreaterThanOrEqual(3);
    db.close();
  });
});
