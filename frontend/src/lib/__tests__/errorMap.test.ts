import { classifyError } from "../errorMap";

describe("classifyError (AM-035)", () => {
  it("classifies network errors and RPC outages correctly", () => {
    const errors = [
      new Error("Failed to fetch"),
      new Error("Network connection timeout"),
      new Error("Soroban RPC node unreachable"),
      new Error("ECONNREFUSED 127.0.0.1:8000"),
      new Error("429 Too Many Requests"),
      new Error("504 Gateway Timeout"),
    ];

    for (const err of errors) {
      const result = classifyError(err);
      expect(result.category).toBe("network");
      expect(result.title).toBe("Network Connection Error");
      expect(result.isRetryable).toBe(true);
    }
  });

  it("classifies wallet and Freighter errors correctly", () => {
    const errors = [
      new Error("Freighter wallet is locked"),
      new Error("User rejected the access request"),
      new Error("Wallet connection denied"),
      new Error("Wallet not connected"),
    ];

    for (const err of errors) {
      const result = classifyError(err);
      expect(result.category).toBe("wallet");
      expect(result.title).toBe("Wallet Error");
      expect(result.isRetryable).toBe(true);
    }
  });

  it("classifies contract simulation and execution errors correctly", () => {
    const errors = [
      new Error("Simulation failed for list_bot: HostError"),
      new Error("Error(Contract, #3) InvalidPrice"),
      new Error("Error(Contract, #6) Unauthorized"),
      new Error("ListingNotFound in marketplace storage"),
    ];

    for (const err of errors) {
      const result = classifyError(err);
      expect(result.category).toBe("contract");
      expect(result.title).toBe("Contract Error");
      expect(result.isRetryable).toBe(true);
    }
  });

  it("handles null / undefined / unknown errors gracefully", () => {
    expect(classifyError(null).category).toBe("unknown");
    expect(classifyError(undefined).category).toBe("unknown");
    expect(classifyError(new Error("Random unhandled crash")).category).toBe("unknown");
  });
});
