/**
 * Retry/backoff engine tests (#454).
 *
 * Pins three guarantees:
 *   1. Transient RPC failures (502, rate limits, transport errors) are
 *      retried with exponential backoff + jitter and can succeed.
 *   2. Deterministic failures (contract rejections, wallet errors) are
 *      surfaced immediately — never retried.
 *   3. Non-idempotent calls (`{ idempotent: false }`, i.e. the rule for
 *      sendTransaction) run exactly once.
 */

import {
  withRetry,
  isRetryableRpcError,
  MAX_RETRIES,
  BASE_DELAY_MS,
  MAX_JITTER_MS,
} from "../rpcRetry";

/** Deterministic jitter so backoff assertions are exact. */
function pinJitter(value = 0.5) {
  return jest.spyOn(Math, "random").mockReturnValue(value);
}

function noSleep() {
  return jest.fn(() => Promise.resolve());
}

describe("isRetryableRpcError (#454)", () => {
  it("treats gateway and rate-limit failures as transient", () => {
    expect(isRetryableRpcError(new Error("Request failed with status code 502"))).toBe(true);
    expect(isRetryableRpcError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableRpcError(new Error("504 Gateway Timeout"))).toBe(true);
    expect(isRetryableRpcError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryableRpcError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableRpcError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableRpcError(new Error("timeout of 30000ms exceeded"))).toBe(true);
  });

  it("treats 5xx / 429 Response objects as transient", () => {
    expect(isRetryableRpcError(new Response("bad", { status: 502 }))).toBe(true);
    expect(isRetryableRpcError(new Response("slow down", { status: 429 }))).toBe(true);
    expect(isRetryableRpcError(new Response("nope", { status: 400 }))).toBe(false);
  });

  it("honours a numeric status property on thrown errors", () => {
    const err502 = Object.assign(new Error("upstream sad"), { status: 502 });
    const err404 = Object.assign(new Error("missing"), { status: 404 });
    expect(isRetryableRpcError(err502)).toBe(true);
    expect(isRetryableRpcError(err404)).toBe(false);
  });

  it("never retries contract or wallet failures", () => {
    expect(isRetryableRpcError(new Error("Simulation failed for balance: Error(Contract, #4)"))).toBe(false);
    expect(isRetryableRpcError(new Error("HostError: contract call failed"))).toBe(false);
    expect(isRetryableRpcError(new Error("NotRegistered"))).toBe(false);
    expect(isRetryableRpcError(new Error("User declined the transaction"))).toBe(false);
    expect(isRetryableRpcError(new Error("txBAD_SEQ"))).toBe(false);
  });

  it("does not retry unrelated or empty errors", () => {
    expect(isRetryableRpcError(new Error("Invalid contract ID"))).toBe(false);
    expect(isRetryableRpcError(undefined)).toBe(false);
    expect(isRetryableRpcError("plain string")).toBe(false);
  });
});

describe("withRetry (#454)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("retries a simulated 502 and eventually succeeds", async () => {
    const delay = noSleep();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("Request failed with status code 502"))
      .mockRejectedValueOnce(Object.assign(new Error("upstream"), { status: 502 }))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { delay });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially with jitter between attempts", async () => {
    const delay = noSleep();
    pinJitter(0.5); // jitter = 250ms

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockResolvedValue("ok");

    await withRetry(fn, { delay });

    const waits = delay.mock.calls.map((call) => call[0]);
    expect(waits).toEqual([
      BASE_DELAY_MS * 2 ** 0 + MAX_JITTER_MS * 0.5,
      BASE_DELAY_MS * 2 ** 1 + MAX_JITTER_MS * 0.5,
      BASE_DELAY_MS * 2 ** 2 + MAX_JITTER_MS * 0.5,
    ]);
  });

  it("gives up after the retry budget and rethrows the last error", async () => {
    const delay = noSleep();
    const fn = jest.fn().mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(withRetry(fn, { delay })).rejects.toThrow("503 Service Unavailable");
    expect(fn).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("does not retry a contract simulation failure", async () => {
    const delay = noSleep();
    const fn = jest
      .fn()
      .mockRejectedValue(new Error("Simulation failed for register: Error(Contract, #1)"));

    await expect(withRetry(fn, { delay })).rejects.toThrow(/Simulation failed/i);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("never retries a non-idempotent call such as sendTransaction", async () => {
    const delay = noSleep();
    const fn = jest.fn().mockRejectedValue(new Error("502 Bad Gateway"));

    await expect(
      withRetry(fn, { delay, idempotent: false })
    ).rejects.toThrow("502 Bad Gateway");

    // Exactly one attempt — a submission is never automatically repeated.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("honours a server Retry-After hint over the exponential delay", async () => {
    const delay = noSleep();
    const throttled = new Response("slow down", {
      status: 429,
      headers: { "Retry-After": "2" },
    });
    const fn = jest
      .fn()
      .mockRejectedValueOnce(throttled)
      .mockResolvedValue("ok");

    await withRetry(fn, { delay });

    expect(delay).toHaveBeenCalledWith(expect.any(Number));
    const [waitMs] = delay.mock.calls[0];
    expect(waitMs).toBeGreaterThanOrEqual(2000);
    expect(waitMs).toBeLessThan(2000 + MAX_JITTER_MS);
  });

  it("returns the value of the first successful attempt", async () => {
    const delay = noSleep();
    await expect(withRetry(async () => 42, { delay })).resolves.toBe(42);
  });
});
