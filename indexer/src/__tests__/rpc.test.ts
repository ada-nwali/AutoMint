import { describe, it, expect, vi, afterEach } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { isTransientError, SorobanRpcClient } from "../rpc.js";

/** An axios-style HTTP error: the status lives on `response.status`. */
function httpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

describe("isTransientError (#1229)", () => {
  it("does not treat 5-prefixed numbers in a message as a 5xx", () => {
    expect(
      isTransientError(new Error("startLedger must be between 51234 and 61234")),
    ).toBe(false);
  });

  it("does not retry JSON-RPC error objects", () => {
    expect(
      isTransientError({ code: -32600, message: "startLedger must be between 51234 and 61234" }),
    ).toBe(false);
  });

  it("retries 429 and 5xx responses by HTTP status", () => {
    expect(isTransientError(httpError(429))).toBe(true);
    expect(isTransientError(httpError(500))).toBe(true);
    expect(isTransientError(httpError(503))).toBe(true);
  });

  it("does not retry other HTTP statuses", () => {
    expect(isTransientError(httpError(400))).toBe(false);
    expect(isTransientError(httpError(404))).toBe(false);
  });

  it("retries network failures without an HTTP response", () => {
    expect(isTransientError(new Error("connect ECONNREFUSED 127.0.0.1:8000"))).toBe(true);
    expect(isTransientError(new Error("timeout of 30000ms exceeded"))).toBe(true);
  });
});

describe("SorobanRpcClient.getEvents pagination retry (#1231)", () => {
  afterEach(() => vi.restoreAllMocks());

  /** One `getEvents` page holding a single event with the given paging id. */
  function page(id: string, cursor: string) {
    return {
      events: [{ id, ledger: 10, txHash: "tx", topic: [], inSuccessfulContractCall: true }],
      cursor,
      latestLedger: 20,
    } as unknown as rpc.Api.GetEventsResponse;
  }

  it("retries only the failed page and keeps earlier pages and the cursor", async () => {
    const getEvents = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValueOnce(page("0000000042949672960-0000000001", "c1"))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(page("0000000042949672960-0000000002", ""));

    const result = await new SorobanRpcClient("https://rpc.invalid").getEvents({
      startLedger: 5,
      contractIds: ["C1"],
    });

    expect(getEvents).toHaveBeenCalledTimes(3);
    expect(getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 5 });
    for (const [request] of getEvents.mock.calls.slice(1)) {
      expect(request).toMatchObject({ cursor: "c1" });
      expect(request).not.toHaveProperty("startLedger");
    }
    expect(result.events.map((e) => e.eventIndex)).toEqual([1, 2]);
    expect(result.latestLedger).toBe(20);
  });
});
