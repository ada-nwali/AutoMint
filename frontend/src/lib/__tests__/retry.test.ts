import { retryQuery, retryMutation, wasSignatureRequested } from "../retry";

describe("retryQuery (#497)", () => {
  it("retries a network / RPC failure, up to the cap", () => {
    const err = new Error("failed to fetch: soroban rpc timeout");
    expect(retryQuery(0, err)).toBe(true);
    expect(retryQuery(1, err)).toBe(true);
    expect(retryQuery(2, err)).toBe(false); // MAX_QUERY_RETRIES reached
  });

  it("never retries a contract error — it errors immediately", () => {
    expect(retryQuery(0, new Error("Error(Contract, #4): simulation failed"))).toBe(false);
    expect(retryQuery(0, new Error("HostError: contract call failed"))).toBe(false);
  });

  it("never retries a NotRegistered state", () => {
    expect(retryQuery(0, new Error("NotRegistered"))).toBe(false);
    expect(retryQuery(0, new Error("user is not registered"))).toBe(false);
  });

  it("never retries a user rejection", () => {
    expect(retryQuery(0, new Error("User declined the transaction"))).toBe(false);
    expect(retryQuery(0, "Request rejected in wallet")).toBe(false);
  });
});

describe("retryMutation (#497)", () => {
  it("retries one pre-signature network blip", () => {
    expect(retryMutation(0, new Error("fetch failed while reading account"))).toBe(true);
    expect(retryMutation(1, new Error("fetch failed while reading account"))).toBe(false);
  });

  it("never retries once a signature has been requested", () => {
    expect(retryMutation(0, new Error("network error after submit"))).toBe(false);
    expect(wasSignatureRequested(new Error("failed to submit signed transaction"))).toBe(true);
  });

  it("never retries a contract or wallet error", () => {
    expect(retryMutation(0, new Error("Error(Contract, #1)"))).toBe(false);
    expect(retryMutation(0, new Error("Freighter is locked"))).toBe(false);
  });
});
