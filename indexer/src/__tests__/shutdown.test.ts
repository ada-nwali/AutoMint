import { describe, it, expect } from "vitest";
import { Poller } from "../poller.js";
import { IndexerDb } from "../db.js";
import type { GetEventsResult, RpcClient } from "../rpc.js";
import {
  G1,
  CACC,
  addr,
  makeRawEvent,
  sym,
  u64,
  vec,
  testConfig,
  toRawRpcEvent,
} from "./helpers.js";

describe("Poller shutdown (#662, #1240)", () => {
  it("abandons an in-flight cycle on abort without writing or recording a failure", async () => {
    const db = new IndexerDb(":memory:");
    const controller = new AbortController();
    const event = toRawRpcEvent(
      makeRawEvent({
        contractId: CACC,
        topics: [sym("claim"), addr(G1)],
        value: vec([u64(10), u64(0)]),
        ledger: 200,
        closedAt: "2024-01-01T00:00:00Z",
      }),
    );

    // The RPC call is still pending when shutdown starts; it resolves afterwards.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rpc: RpcClient = {
      async getEvents(): Promise<GetEventsResult> {
        await gate;
        return { events: [event], latestLedger: 201 };
      },
    };
    const poller = new Poller({
      rpc,
      db,
      config: testConfig(),
      defaultStartLedger: 200,
      log: () => {},
    });

    const running = poller.run(10, controller.signal);
    controller.abort();
    release();
    await running;

    // The database is still usable after run() settles, so the caller can close it once.
    expect(db.countClaims()).toBe(0);
    expect(db.getCheckpoint()).toBeNull();
    expect(poller.health(60_000).readiness.last_failure_at).toBeNull();
    db.close();
  });

  it("settles without polling again once abort has been requested", async () => {
    const db = new IndexerDb(":memory:");
    const controller = new AbortController();
    let calls = 0;
    const rpc: RpcClient = {
      async getEvents(): Promise<GetEventsResult> {
        calls += 1;
        controller.abort();
        return { events: [], latestLedger: 0 };
      },
    };
    const poller = new Poller({
      rpc,
      db,
      config: testConfig(),
      defaultStartLedger: 200,
      log: () => {},
    });

    await poller.run(10, controller.signal);

    expect(calls).toBe(1);
    db.close();
  });
});
