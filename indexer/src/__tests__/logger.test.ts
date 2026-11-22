import { describe, it, expect, vi } from "vitest";
import { Poller } from "../poller.js";
import type { IndexerDb } from "../db.js";
import type { RpcClient } from "../rpc.js";
import { FakeRpcClient, testConfig } from "./helpers.js";

/** Just enough of IndexerDb for one poll iteration. */
function fakeDb(): IndexerDb {
  return {
    getCheckpoint: async () => null,
    insertEvents: () => 0,
    saveCheckpoint: () => {},
  } as unknown as IndexerDb;
}

describe("default poller logger", () => {
  it("prints the meta argument as JSON on 'poll complete'", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const rpc = new FakeRpcClient([
        { events: [], latestLedger: 1000, cursor: null },
      ]);
      const poller = new Poller({
        rpc,
        db: fakeDb(),
        config: testConfig(),
        defaultStartLedger: 1000,
      });

      await poller.pollOnce();

      const lines = spy.mock.calls.map((call) => String(call[0]));
      expect(
        lines.some(
          (line) =>
            line.startsWith("[poller] poll complete ") &&
            line.includes('"fetched":0') &&
            line.includes('"inserted":0'),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("prints the failure error on 'poll iteration failed'", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      // Stop the loop as soon as the failure has been logged.
      if (String(message).includes("poll iteration failed")) controller.abort();
    });
    try {
      const rpc = {
        getEvents: async () => {
          throw new Error("RPC down");
        },
        getOldestLedger: async () => 1,
      } as unknown as RpcClient;
      const poller = new Poller({
        rpc,
        db: fakeDb(),
        config: testConfig(),
        defaultStartLedger: 1000,
      });

      await poller.run(1_000, controller.signal);

      const lines = spy.mock.calls.map((call) => String(call[0]));
      expect(
        lines.some(
          (line) =>
            line.includes("poll iteration failed") &&
            line.includes('"error":"RPC down"'),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
