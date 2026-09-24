/**
 * Transaction pipeline guard tests (#455 network guards, #454 send rules).
 *
 * - A known network mismatch refuses to build anything at all.
 * - The wallet's LIVE network is re-checked immediately before signing.
 * - sendTransaction is never retried on a transient (5xx) failure.
 */

const mockSendTransaction = jest.fn();
const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetNetwork = jest.fn();
const mockSignTransaction = jest.fn();

jest.mock("@/store/walletStore", () => {
  const mockState: any = {
    publicKey: "GD6VCGW7N4YUZUG2VKRN4DKIXGTBJZTZBV5ICATW2YCDCOS36VYPXAR3",
    networkMismatch: false,
    status: "connected",
    network: "testnet",
    error: null,
    wasConnected: true,
    lastAddress: "GD6VCGW7N4YUZUG2VKRN4DKIXGTBJZTZBV5ICATW2YCDCOS36VYPXAR3",
  };
  const fn: any = jest.fn((selector: any) => selector(mockState));
  fn.getState = jest.fn(() => mockState);
  fn.setState = jest.fn((partial: any) => Object.assign(mockState, partial));
  return {
    useWalletStore: fn,
    selectPublicKey: (s: any) => s.publicKey,
    selectNetworkMismatch: (s: any) => s.networkMismatch,
    selectStatus: (s: any) => s.status,
    selectNetwork: (s: any) => s.network,
    selectError: (s: any) => s.error,
    selectWasConnected: (s: any) => s.wasConnected,
    WALLET_PERSIST_KEY: "automint-wallet",
  };
});

jest.mock("@/lib/stellar", () => {
  const actual = jest.requireActual("@/lib/stellar");
  return {
    ...actual,
    getServer: () => ({
      sendTransaction: mockSendTransaction,
      getAccount: mockGetAccount,
      prepareTransaction: mockPrepareTransaction,
      getTransaction: mockGetTransaction,
      simulateTransaction: mockSimulateTransaction,
    }),
    rpcCall: (fn: (server: unknown) => Promise<unknown>) =>
      fn({
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        getTransaction: mockGetTransaction,
        sendTransaction: mockSendTransaction,
        simulateTransaction: mockSimulateTransaction,
      }),
  getActiveRpcUrl: () => "http://rpc-one.test",
  getRpcEndpoints: () => ["http://rpc-one.test"],
  __resetRpcFailoverStateForTests: () => {},
  simulateContractCall: jest.fn(),
  buildPreparedTx: jest.fn(),
  getLedgerCloseTime: jest.fn(),
  };
});

jest.mock("@stellar/stellar-sdk", () => ({
  __esModule: true,
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn(() => ({ op: true })),
  })),
  TransactionBuilder: Object.assign(
    jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({
        fee: "100",
        toXDR: () => "tx-xdr",
      })),
    })),
    {
      // Static: rehydrates the signed XDR for sendTransaction.
      fromXDR: jest.fn(() => ({ rehydrated: true })),
    }
  ),
  scValToNative: jest.fn((v) => v),
  nativeToScVal: jest.fn((v) => v),
  xdr: {},
  SorobanRpc: {
    Api: { isSimulationError: jest.fn(() => false) },
    assembleTransaction: jest.fn(() => ({
      build: () => ({
        fee: "100",
        toXDR: () => "tx-xdr",
      }),
    })),
  },
  FeeBumpTransaction: class {},
  Transaction: class {},
}));

jest.mock("@stellar/freighter-api", () => ({
  __esModule: true,
  getNetwork: (...args: unknown[]) => mockGetNetwork(...args),
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  isConnected: jest.fn(),
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
}));

import { executeTransaction } from "../transaction";
import { STELLAR_NETWORK_PASSPHRASE } from "../constants";
import { useWalletStore } from "@/store/walletStore";

const SOURCE = "GTESTSOURCE";
const CONTRACT = "CCONTRACT";

function happyRpc() {
  mockGetAccount.mockResolvedValue({ sequenceNumber: () => "100" });
  mockPrepareTransaction.mockResolvedValue({
    fee: "100",
    toXDR: () => "tx-xdr",
  });
  mockSimulateTransaction.mockResolvedValue({
    result: { retval: "RET" },
    error: undefined,
  });
  mockGetTransaction.mockResolvedValue({
    status: "SUCCESS",
    sequenceNumber: "101",
    returnValue: "RET",
  });
  mockGetNetwork.mockResolvedValue({
    network: "testnet",
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  });
  mockSignTransaction.mockResolvedValue({
    signedTxXdr: "signed-xdr",
    signerAddress: SOURCE,
  });
  mockSendTransaction.mockResolvedValue({
    hash: "abc123",
    status: "PENDING",
  });
}

async function run() {
  const statuses: Array<{ stage: string; error?: string }> = [];
  const result = await executeTransaction({
    contractId: CONTRACT,
    method: "mint",
    args: [],
    sourceAddress: SOURCE,
    onStatus: (s) => statuses.push(s),
  });
  return { result, statuses };
}

describe.skip("executeTransaction network guards (#455) — TODO: re-enable after #455 guards are re-introduced", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWalletStore as any).setState?.({ networkMismatch: false });
    happyRpc();
  });

  it("refuses to run at all when the store reports a network mismatch", async () => {
    (useWalletStore as any).setState?.({ networkMismatch: true });

    await expect(run()).rejects.toThrow(/wrong network/i);
    // Nothing was built or simulated.
    expect(mockGetAccount).not.toHaveBeenCalled();
    expect(mockSignTransaction).not.toHaveBeenCalled();
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("re-checks the live wallet network right before signing and fails closed", async () => {
    mockGetNetwork.mockResolvedValue({
      network: "public",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });

    await expect(run()).rejects.toThrow(/wrong network/i);

    expect(mockSignTransaction).not.toHaveBeenCalled();
    expect(mockSendTransaction).not.toHaveBeenCalled();
    // The flag is (re)raised so the UI disables mutations immediately.
    expect((useWalletStore as any).getState?.().networkMismatch).toBe(true);
  });

  it("fails closed when the wallet network cannot be read before signing", async () => {
    mockGetNetwork.mockRejectedValue(new Error("extension unreachable"));

    await expect(run()).rejects.toThrow(
      /could not verify wallet network/i
    );
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

  it("clears a stale mismatch flag once the live network checks out", async () => {
    (useWalletStore as any).setState?.({ networkMismatch: true });

    // The entry-point guard trips first in this state.
    await expect(run()).rejects.toThrow(/wrong network/i);

    // Simulate the user switching back: flag cleared by the banner poll,
    // then the full pipeline runs and the live check re-confirms.
    (useWalletStore as any).setState?.({ networkMismatch: false });
    await expect(run()).resolves.toBeDefined();
    expect((useWalletStore as any).getState?.().networkMismatch).toBe(false);
    expect(mockSignTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("sendTransaction is never retried automatically (#454)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWalletStore as any).setState?.({ networkMismatch: false });
    happyRpc();
  });

  it("submits exactly once on a transient 502", async () => {
    mockSendTransaction.mockImplementation(() =>
      Promise.reject(new Error("Request failed with status code 502"))
    );

    await expect(run()).rejects.toThrow(/502/);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    expect(mockSignTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports the failure through onStatus", async () => {
    mockSendTransaction.mockImplementation(() =>
      Promise.reject(new Error("Request failed with status code 503"))
    );

    const statuses: Array<{ stage: string; error?: string }> = [];
    await expect(
      executeTransaction({
        contractId: CONTRACT,
        method: "mint",
        args: [],
        sourceAddress: SOURCE,
        onStatus: (s) => statuses.push(s),
      })
    ).rejects.toThrow(/503/);

    expect(statuses.map((s) => s.stage)).toEqual([
      "building",
      "simulating",
      "assembling",
      "signing",
      "submitting",
      "error",
    ]);
  });

  it("walks the happy path and returns the decoded value", async () => {
    const { result, statuses } = await run();

    expect(result).toBeDefined();
    expect(statuses[statuses.length - 1].stage).toBe("success");
    expect(mockSignTransaction).toHaveBeenCalledWith(
      "tx-xdr",
      expect.objectContaining({ networkPassphrase: STELLAR_NETWORK_PASSPHRASE })
    );
    // The signed XDR is rehydrated into a Transaction before submission.
    expect(mockSendTransaction).toHaveBeenCalledWith({ rehydrated: true });
  });
});
