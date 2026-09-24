/**
 * Endpoint failover tests (#454).
 *
 * `NEXT_PUBLIC_SOROBAN_RPC_URL` accepts a comma-separated list. After
 * `NEXT_PUBLIC_RPC_FAILOVER_AFTER` consecutive transient failures the
 * active endpoint rotates to the next URL, and every retry attempt
 * re-resolves the server so the very next call already uses the backup.
 *
 * Env vars are set before the module is required (plain `require`, not
 * `import`, so the assignment runs first).
 */

const mockGetAccount = jest.fn();

const constructedUrls: string[] = [];

jest.mock("@stellar/stellar-sdk", () => ({
  __esModule: true,
  SorobanRpc: {
    Server: jest.fn().mockImplementation((url: string) => {
      constructedUrls.push(url);
      return {
        getAccount: mockGetAccount,
        simulateTransaction: jest.fn(),
        prepareTransaction: jest.fn(),
        getLatestLedger: jest.fn(),
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
      };
    }),
    Api: {
      isSimulationError: jest.fn(() => false),
    },
  },
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn(() => ({ op: true })),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn(() => ({ tx: true })),
  })),
  scValToNative: jest.fn((v) => v),
  nativeToScVal: jest.fn((v) => v),
  xdr: {},
}));

jest.mock("@stellar/freighter-api", () => ({
  __esModule: true,
  isConnected: jest.fn(),
  requestAccess: jest.fn(),
  getNetwork: jest.fn(),
}));

process.env.NEXT_PUBLIC_SOROBAN_RPC_URL =
  "http://rpc-one.test,http://rpc-two.test";
process.env.NEXT_PUBLIC_RPC_FAILOVER_AFTER = "2";

// Required AFTER the env assignment above — babel hoists `import`s, so this
// file deliberately uses `require` for the module under test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  rpcCall,
  getActiveRpcUrl,
  getRpcEndpoints,
  __resetRpcFailoverStateForTests,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("../stellar");

const RPC_ONE = "http://rpc-one.test";
const RPC_TWO = "http://rpc-two.test";

const err502 = () => new Error("Request failed with status code 502");

describe("RPC endpoint failover (#454)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    constructedUrls.length = 0;
    __resetRpcFailoverStateForTests();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("exposes every configured endpoint, primary first", () => {
    expect(getRpcEndpoints()).toEqual([RPC_ONE, RPC_TWO]);
    expect(getActiveRpcUrl()).toBe(RPC_ONE);
  });

  it("fails over to the second URL after the configured failure count", async () => {
    // Threshold = 2: two consecutive 502s rotate the endpoint, the third
    // attempt runs against the backup and succeeds.
    mockGetAccount
      .mockRejectedValueOnce(err502())
      .mockRejectedValueOnce(err502())
      .mockResolvedValueOnce({ sequenceNumber: () => "7" });

    const promise = rpcCall((server: { getAccount: typeof mockGetAccount }) =>
      server.getAccount("GADDR")
    );
    await jest.advanceTimersByTimeAsync(60_000);
    const account = await promise;

    expect(account).toEqual({ sequenceNumber: expect.any(Function) });
    expect(mockGetAccount).toHaveBeenCalledTimes(3);
    expect(constructedUrls).toEqual([RPC_ONE, RPC_TWO]);
    // The active endpoint is now the backup — surfaced for the status UI.
    expect(getActiveRpcUrl()).toBe(RPC_TWO);
  });

  it("stays on the primary endpoint when failures stay below the threshold", async () => {
    mockGetAccount
      .mockRejectedValueOnce(err502())
      .mockResolvedValueOnce({ ok: true });

    const promise = rpcCall((server: { getAccount: typeof mockGetAccount }) =>
      server.getAccount("GADDR")
    );
    await jest.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(getActiveRpcUrl()).toBe(RPC_ONE);
    expect(constructedUrls).toEqual([RPC_ONE]);
  });

  it("a success resets the consecutive-failure counter", async () => {
    mockGetAccount
      .mockRejectedValueOnce(err502()) // failure 1 of 2
      .mockResolvedValueOnce({ ok: true }) // resets to 0
      .mockRejectedValueOnce(err502()) // failure 1 of 2 again
      .mockResolvedValueOnce({ ok: true });

    for (let i = 0; i < 2; i++) {
      const promise = rpcCall((server: { getAccount: typeof mockGetAccount }) =>
        server.getAccount("GADDR")
      );
      await jest.advanceTimersByTimeAsync(60_000);
      await promise;
    }

    // Four transient failures total, but never two *consecutive* — the
    // endpoint never rotates.
    expect(getActiveRpcUrl()).toBe(RPC_ONE);
    expect(constructedUrls).toEqual([RPC_ONE]);
  });

  it("does not rotate on a deterministic contract failure", async () => {
    mockGetAccount.mockRejectedValueOnce(
      new Error("Simulation failed for get_user: Error(Contract, #1)")
    );

    await expect(
      rpcCall((server: { getAccount: typeof mockGetAccount }) =>
        server.getAccount("GADDR")
      )
    ).rejects.toThrow(/Simulation failed/);

    expect(getActiveRpcUrl()).toBe(RPC_ONE);
    expect(constructedUrls).toEqual([RPC_ONE]);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
  });
});
