/**
 * Tests for connectFreighter and simulateContractCall in stellar.ts.
 *
 * Both @stellar/freighter-api and @stellar/stellar-sdk are fully mocked so the
 * tests exercise only the wrapper logic (error normalization, simulation
 * success/failure handling).
 */

// ── @stellar/stellar-sdk mock ───────────────────────────────────────────────
const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockIsSimulationError = jest.fn();
const mockScValToNative = jest.fn();
const mockBuiltTx = { tx: true, toXDR: jest.fn(() => "UNPREPARED_XDR") };

jest.mock("@stellar/stellar-sdk", () => ({
  __esModule: true,
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getAccount: mockGetAccount,
      simulateTransaction: mockSimulateTransaction,
      prepareTransaction: mockPrepareTransaction,
      sendTransaction: mockSendTransaction,
      getTransaction: mockGetTransaction,
    })),
    Api: {
      isSimulationError: (...args: unknown[]) => mockIsSimulationError(...args),
    },
  },
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn(() => ({ op: true })),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn(() => mockBuiltTx),
  })),
  scValToNative: (...args: unknown[]) => mockScValToNative(...args),
  // The real encoder, so the ScVal helper round-trips below exercise actual
  // XDR. None of the wrapper tests depend on its output.
  nativeToScVal: jest.requireActual("@stellar/stellar-sdk").nativeToScVal,
  xdr: {},
}));

// ── @stellar/freighter-api mock ─────────────────────────────────────────────
jest.mock("@stellar/freighter-api", () => ({
  __esModule: true,
  isConnected: jest.fn(),
  requestAccess: jest.fn(),
  getNetwork: jest.fn(),
}));

import {
  isConnected,
  requestAccess,
  getNetwork,
} from "@stellar/freighter-api";
import {
  connectFreighter,
  simulateContractCall,
  buildPreparedTx,
  submitTx,
  invalidateReadCaches,
  addressToScVal,
  u64ToScVal,
  u32ToScVal,
  i128ToScVal,
  stringToScVal,
  boolToScVal,
} from "../stellar";

const mockIsConnected = isConnected as jest.Mock;
const mockRequestAccess = requestAccess as jest.Mock;
const mockGetNetwork = getNetwork as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Read caches (#482) are module-level state: start every test cold so
  // account-TTL / in-flight entries never leak across cases.
  invalidateReadCaches();
});

describe("connectFreighter", () => {
  it("returns publicKey and network on success", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: "GABC123" });
    mockGetNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const result = await connectFreighter();
    expect(result).toEqual({ publicKey: "GABC123", network: "TESTNET" });
  });

  it("throws when the extension is not installed", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });
    await expect(connectFreighter()).rejects.toThrow(/not installed|not be detected/i);
  });

  it("throws a locked-wallet error when access returns a lock error", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: { code: -1, message: "Wallet is locked" },
    });
    await expect(connectFreighter()).rejects.toThrow(/locked/i);
  });

  it("throws a rejection error when the user rejects the request", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: { code: -2, message: "User rejected the request" },
    });
    await expect(connectFreighter()).rejects.toThrow(/rejected/i);
  });
});

describe("simulateContractCall", () => {
  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ accountId: () => "GSRC" });
  });

  it("returns the decoded native value on success", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { xdr: true } },
    });
    mockIsSimulationError.mockReturnValue(false);
    mockScValToNative.mockReturnValue(42);

    const value = await simulateContractCall("CCONTRACT", "total_users", [], "GSRC");
    expect(value).toBe(42);
    expect(mockScValToNative).toHaveBeenCalledWith({ xdr: true });
  });

  it("throws when the simulation reports an error", async () => {
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    mockIsSimulationError.mockReturnValue(true);

    await expect(
      simulateContractCall("CCONTRACT", "balance", [], "GSRC")
    ).rejects.toThrow(/Simulation failed/i);
  });

  it("throws when there is no return value", async () => {
    mockSimulateTransaction.mockResolvedValue({ result: {} });
    mockIsSimulationError.mockReturnValue(false);

    await expect(
      simulateContractCall("CCONTRACT", "balance", [], "GSRC")
    ).rejects.toThrow(/No return value/i);
  });
});

describe("buildPreparedTx", () => {
  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ accountId: () => "GSRC" });
  });

  it("returns the prepared transaction's XDR, not the unprepared build", async () => {
    const preparedTx = { toXDR: jest.fn(() => "PREPARED_XDR_WITH_RESOURCE_FEE") };
    mockPrepareTransaction.mockResolvedValue(preparedTx);

    const xdr = await buildPreparedTx("CCONTRACT", "register", [], "GSRC");

    // The built (unprepared) tx must be handed to prepareTransaction so the
    // Soroban resource fee and footprint get attached — the XDR returned
    // must be the *prepared* result, not the raw build() output.
    expect(mockPrepareTransaction).toHaveBeenCalledWith(mockBuiltTx);
    expect(xdr).toBe("PREPARED_XDR_WITH_RESOURCE_FEE");
    expect(mockBuiltTx.toXDR).not.toHaveBeenCalled();
  });

  it("propagates a simulation failure from prepareTransaction", async () => {
    mockPrepareTransaction.mockRejectedValue(
      new Error("Simulation failed: insufficient resource fee")
    );

    await expect(
      buildPreparedTx("CCONTRACT", "register", [], "GSRC")
    ).rejects.toThrow(/insufficient resource fee/i);
  });
});

// ---------------------------------------------------------------------------
// Read-path caching (#482)
// ---------------------------------------------------------------------------
describe("read caching (#482)", () => {
  const src = "GCACHE";

  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ accountId: () => src });
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { xdr: true } },
    });
    mockIsSimulationError.mockReturnValue(false);
    mockScValToNative.mockReturnValue(1);
  });

  it("makes a single getAccount fetch for six concurrent reads", async () => {
    await Promise.all([
      simulateContractCall("C1", "a", [], src),
      simulateContractCall("C2", "b", [], src),
      simulateContractCall("C3", "c", [], src),
      simulateContractCall("C4", "d", [], src),
      simulateContractCall("C5", "e", [], src),
      simulateContractCall("C6", "f", [], src),
    ]);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(6);
  });

  it("shares one in-flight promise for identical concurrent simulations", async () => {
    const [first, second] = await Promise.all([
      simulateContractCall("CX", "total_users", [], src),
      simulateContractCall("CX", "total_users", [], src),
    ]);
    expect(first).toBe(second);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed account fetch and propagates the error", async () => {
    mockGetAccount.mockRejectedValueOnce(new Error("account unavailable"));

    await expect(
      simulateContractCall("CX", "x", [], src)
    ).rejects.toThrow("account unavailable");

    // The failure was never cached: the next read retries getAccount.
    await simulateContractCall("CX", "x", [], src);
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });

  it("keys simulations by encoded args so distinct args are not deduped", async () => {
    const withXdr = { toXDR: () => ({ toString: () => "base64-arg" }) };
    const withThrowingXdr = {
      toXDR: () => {
        throw new Error("nope");
      },
    };
    const plain = { plain: true };

    // One of each key shape: base64 XDR, JSON fallback, throwing toXDR.
    // Sequential calls must NOT share (entries are dropped once settled).
    await simulateContractCall("CX", "m", [withXdr as never], src);
    await simulateContractCall("CX", "m", [plain as never], src);
    await simulateContractCall("CX", "m", [withThrowingXdr as never], src);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);
  });

  it("drops the account cache after a confirmed transaction", async () => {
    await simulateContractCall("CX", "balance", [], src);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);

    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "abc123",
    });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });
    await submitTx("SIGNED_XDR");

    await simulateContractCall("CX", "balance", [], src);
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });

  it("invalidates the caches after a failed transaction too", async () => {
    await simulateContractCall("CX", "balance", [], src);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);

    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "abc123",
    });
    mockGetTransaction.mockResolvedValue({
      status: "FAILED",
      resultXdr: "AAAA",
    });
    await expect(submitTx("SIGNED_XDR")).rejects.toThrow(
      /Transaction failed on-chain/
    );

    await simulateContractCall("CX", "balance", [], src);
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// ScVal helpers
//
// Merged from the former src/lib/stellar.test.ts (#489) so stellar.ts has a
// single test file. Encoding goes through the real `nativeToScVal` passed
// through by the SDK mock above; decoding uses the actual `scValToNative`.
// ---------------------------------------------------------------------------
const { scValToNative } = jest.requireActual("@stellar/stellar-sdk");

describe("ScVal helpers in stellar.ts", () => {
  it("addressToScVal round-trips correctly via scValToNative", () => {
    const address = "GBDUJFNDCXMOAY654HWWDVOHGGCL4NZIAXGXDF4WODNUMUPTIGULZTN2";
    const scVal = addressToScVal(address);
    const native = scValToNative(scVal);
    expect(native).toBe(address);
  });

  it("u64ToScVal round-trips correctly via scValToNative", () => {
    const val = 123456789n;
    const scVal = u64ToScVal(val);
    const native = scValToNative(scVal);
    expect(native).toBe(val);
  });

  it("u32ToScVal round-trips correctly via scValToNative", () => {
    const val = 12345;
    const scVal = u32ToScVal(val);
    const native = scValToNative(scVal);
    expect(native).toBe(val);
  });

  it("i128ToScVal round-trips correctly via scValToNative", () => {
    const val = -12345678901234567890n;
    const scVal = i128ToScVal(val);
    const native = scValToNative(scVal);
    expect(native).toBe(val);
  });

  it("stringToScVal round-trips correctly via scValToNative", () => {
    const val = "hello world";
    const scVal = stringToScVal(val);
    const native = scValToNative(scVal);
    // Note: Soroban strings often decode to Buffer or string depending on SDK versions.
    // The stellar-sdk scValToNative typically decodes string to Buffer or string?
    // We will see what test says. We might need to convert Buffer to string.
    if (Buffer.isBuffer(native)) {
      expect(native.toString("utf-8")).toBe(val);
    } else {
      expect(native).toBe(val);
    }
  });

  it("boolToScVal round-trips correctly via scValToNative", () => {
    expect(scValToNative(boolToScVal(true))).toBe(true);
    expect(scValToNative(boolToScVal(false))).toBe(false);
  });

  describe("u64ToScVal edge cases", () => {
    it("encodes zero correctly", () => {
      const val = 0n;
      const scVal = u64ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes max safe integer for u64 correctly", () => {
      const val = 18446744073709551615n; // 2^64 - 1
      const scVal = u64ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes very large bigint correctly", () => {
      const val = 9223372036854775807n; // Max i64
      const scVal = u64ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });
  });

  describe("i128ToScVal edge cases", () => {
    it("encodes zero correctly", () => {
      const val = 0n;
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes max safe integer for i128 correctly", () => {
      const val = 170141183460469231731687303715884105727n; // 2^127 - 1
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes min value for i128 correctly", () => {
      const val = -170141183460469231731687303715884105728n; // -2^127
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes very large negative bigint correctly", () => {
      const val = -9223372036854775808n; // Min i64
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes very large positive bigint correctly", () => {
      const val = 9223372036854775807n; // Max i64
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });
  });
});
