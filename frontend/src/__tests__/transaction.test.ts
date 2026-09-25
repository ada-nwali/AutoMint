/**
 * The transaction pipeline, end to end, against a mocked RPC (#467).
 *
 * The real pieces run: `useListBot` -> `executeTransaction` -> `signTx` -> the
 * real stellar-sdk building a real `list_bot` invocation, and the real tx
 * store. Only the edges are faked — the Soroban RPC server, the Freighter
 * wallet, the SDK's `assembleTransaction` and the toast library — so nothing
 * here touches the network.
 *
 * Every failure path asserts the same invariant: no stage of a failed
 * transaction ever fires a success toast.
 *
 * Fixtures below cover the whole RPC surface the pipeline uses:
 * getAccount, simulateTransaction (whose response feeds the "assemble" step),
 * sendTransaction and the getTransaction poll.
 */

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Account, Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { toast } from "sonner";
import { useListBot } from "@/hooks/useMarketplace";
import { resumePendingTransactions, __resetSequenceStateForTests } from "@/lib/transaction";
import { MARKETPLACE_CONTRACT_ID, STELLAR_NETWORK_PASSPHRASE } from "@/lib/constants";
import { useTxStore, type TxRecord } from "@/store/txStore";
import { useWalletStore } from "@/store/walletStore";

// ── Test doubles for the pipeline's edges ───────────────────────────────────

// The placeholder contract IDs in constants are not valid strkeys, and the
// real Contract / Address encoders validate their checksum.
jest.mock("@/lib/constants", () => {
  const { StrKey } = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...jest.requireActual("@/lib/constants"),
    MARKETPLACE_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 1)),
    TOKEN_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 2)),
  };
});

const mockServer = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
};

// Keep the real signTx / ScVal helpers; only the RPC server is replaced.
jest.mock("@/lib/stellar", () => ({
  ...jest.requireActual("@/lib/stellar"),
  getServer: () => mockServer,
  rpcCall: (fn: (server: unknown) => unknown) => fn(mockServer),
}));

// `assembleTransaction` needs a byte-accurate simulation response to run for
// real; it is replaced so the test can assert exactly what reaches it and what
// gets signed afterwards. Everything else in the SDK is real.
const mockAssemble = jest.fn();
jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      assembleTransaction: (...args: unknown[]) => mockAssemble(...args),
    },
  };
});

const mockSignTransaction = jest.fn();
jest.mock("@stellar/freighter-api", () => ({
  __esModule: true,
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

jest.mock("sonner", () => ({
  toast: { loading: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

// ── RPC fixtures ────────────────────────────────────────────────────────────

const LEDGER_INFO = {
  latestLedger: 100,
  latestLedgerCloseTime: 1_700_000_000,
  oldestLedger: 1,
  oldestLedgerCloseTime: 1_690_000_000,
};

const TX_HASH = "ab".repeat(32);
const ASSEMBLED_XDR = "ASSEMBLED_TX_XDR";
const SIGNED_XDR = "SIGNED_TX_XDR";

/** simulateTransaction, contract call would succeed. */
const simulateSuccess = {
  ...LEDGER_INFO,
  minResourceFee: "58181",
  result: { auth: [], retval: nativeToScVal(1n, { type: "u64" }) },
};

/** simulateTransaction, contract call would trap. */
const simulateFailure = {
  ...LEDGER_INFO,
  error: "HostError: Error(Contract, #4)",
};

/** sendTransaction accepted the transaction. */
const sendPending = { ...LEDGER_INFO, status: "PENDING", hash: TX_HASH };

/** sendTransaction rejected the transaction outright. */
const sendError = {
  ...LEDGER_INFO,
  status: "ERROR",
  hash: TX_HASH,
  errorResultXdr: "AAAAAAAAAGT/////AAAAAQAAAAAAAAAB////+gAAAAA=",
};

/** sendTransaction rejected the transaction for a stale sequence number. */
const sendBadSeq = { ...sendError, errorResultXdr: "txBAD_SEQ" };

/** getTransaction poll responses. */
const getNotFound = { ...LEDGER_INFO, status: "NOT_FOUND" };
const getSuccess = {
  ...LEDGER_INFO,
  status: "SUCCESS",
  ledger: 101,
  returnValue: nativeToScVal(1n, { type: "u64" }),
};
const getFailed = {
  ...LEDGER_INFO,
  status: "FAILED",
  ledger: 101,
  resultXdr: "FAILED_RESULT_XDR",
};

/** Freighter's answers to a sign request. */
const signApproved = { signedTxXdr: SIGNED_XDR, signerAddress: "GSIGNER" };
const signRejected = { error: { code: -4, message: "User declined access" } };

// ── Harness ─────────────────────────────────────────────────────────────────

const realSetTimeout = global.setTimeout;

let seller: string;
let clock: jest.SpyInstance | undefined;
let timers: jest.SpyInstance | undefined;
let consoleError: jest.SpyInstance;

const successToast = toast.success as jest.Mock;
const errorToast = toast.error as jest.Mock;
const loadingToast = toast.loading as jest.Mock;

beforeAll(() => {
  // The hook reads the contract ID straight from the environment; resume polls
  // at 1ms so its real-timer loops stay instant.
  process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID = MARKETPLACE_CONTRACT_ID;
  process.env.NEXT_PUBLIC_POLL_INTERVAL_MS = "1";
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID;
  delete process.env.NEXT_PUBLIC_POLL_INTERVAL_MS;
});

beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  useTxStore.setState({ transactions: [] });
  __resetSequenceStateForTests();

  seller = Keypair.random().publicKey();
  useWalletStore.setState({ status: "connected", publicKey: seller, network: "TESTNET" });

  // The confirmation poll sleeps 1s..8s between reads; collapse those waits so
  // the loop runs at full speed. Every other timer is left alone.
  timers = jest.spyOn(global, "setTimeout").mockImplementation(((
    callback: () => void,
    ms?: number,
    ...args: unknown[]
  ) =>
    realSetTimeout(
      callback,
      typeof ms === "number" && ms >= 1_000 && ms <= 8_000 ? 0 : ms,
      ...args
    )) as unknown as typeof setTimeout);

  // The mutation's onError logs; keep the output readable.
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

  mockServer.getAccount.mockImplementation(async (address: string) => new Account(address, "100"));
  mockServer.simulateTransaction.mockResolvedValue(simulateSuccess);
  mockAssemble.mockImplementation(() => ({
    build: () => ({ fee: "58281", toXDR: () => ASSEMBLED_XDR }),
  }));
  mockSignTransaction.mockResolvedValue(signApproved);
  mockServer.sendTransaction.mockResolvedValue(sendPending);
  mockServer.getTransaction.mockResolvedValue(getSuccess);
});

afterEach(() => {
  clock?.mockRestore();
  clock = undefined;
  timers?.mockRestore();
  timers = undefined;
  consoleError.mockRestore();
});

/**
 * Make `Date.now()` jump 5s per call, so the pipeline's confirmation window
 * elapses after a handful of instant polls instead of a real minute.
 */
function accelerateClock(): void {
  let now = Date.now();
  clock = jest.spyOn(Date, "now").mockImplementation(() => (now += 5_000));
}

/** Run one `list_bot` submission through the real hook and pipeline. */
async function submitListing(): Promise<{ result?: unknown; error?: Error }> {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useListBot(), { wrapper });

  let outcome: { result?: unknown; error?: Error } = {};
  await act(async () => {
    try {
      outcome = { result: await result.current.mutateAsync({ botId: 7n, price: 100n }) };
    } catch (error) {
      outcome = { error: error as Error };
    }
  });
  return outcome;
}

const storedTransactions = (): TxRecord[] => useTxStore.getState().transactions;

// ── The seven pipeline paths ────────────────────────────────────────────────

describe("transaction pipeline", () => {
  it("happy path: simulates, assembles, signs, submits, confirms, and toasts success", async () => {
    mockServer.getTransaction.mockResolvedValueOnce(getNotFound).mockResolvedValue(getSuccess);

    const { error } = await submitListing();

    expect(error).toBeUndefined();

    // The built transaction is a real list_bot invocation with the contract's
    // argument types, and it is what gets simulated.
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(1);
    const built = mockServer.simulateTransaction.mock.calls[0][0];
    const invocation = built
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction()
      .invokeContract();
    expect(invocation.functionName().toString()).toBe("list_bot");
    expect(invocation.args().map((arg: { switch(): { name: string } }) => arg.switch().name)).toEqual(
      ["scvAddress", "scvU64", "scvI128", "scvAddress"]
    );

    // Assemble step: the simulation result is folded into the built
    // transaction, and the wallet is asked to sign the *assembled* result —
    // not the bare build, which lacks the resource fee and footprint.
    expect(mockAssemble).toHaveBeenCalledTimes(1);
    expect(mockAssemble).toHaveBeenCalledWith(built, simulateSuccess);
    expect(mockSignTransaction).toHaveBeenCalledWith(
      ASSEMBLED_XDR,
      expect.objectContaining({
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        address: seller,
      })
    );
    expect(mockServer.sendTransaction).toHaveBeenCalledWith(SIGNED_XDR);
    expect(mockServer.getTransaction).toHaveBeenCalledWith(TX_HASH);

    expect(loadingToast.mock.calls.map(([message]) => message)).toEqual([
      "Preparing listing transaction...", // building
      "Preparing listing transaction...", // simulating
      "Preparing listing transaction...", // assembling
      "Waiting for wallet signature...",
      "Submitting listing to blockchain...",
      `Confirming on-chain... (${TX_HASH.slice(0, 8)})`,
    ]);
    expect(successToast).toHaveBeenCalledTimes(1);
    expect(successToast).toHaveBeenCalledWith("Bot listed successfully!", expect.anything());
    expect(errorToast).not.toHaveBeenCalled();

    expect(storedTransactions()).toEqual([
      expect.objectContaining({
        hash: TX_HASH,
        account: seller,
        method: "list_bot",
        status: "success",
      }),
    ]);
  });

  it("simulation error: surfaces the contract error and never signs or submits", async () => {
    mockServer.simulateTransaction.mockResolvedValue(simulateFailure);

    const { error } = await submitListing();

    expect(error?.message).toContain("HostError: Error(Contract, #4)");
    expect(errorToast).toHaveBeenCalledWith(
      expect.stringContaining("HostError: Error(Contract, #4)"),
      expect.anything()
    );
    expect(mockAssemble).not.toHaveBeenCalled();
    expect(mockSignTransaction).not.toHaveBeenCalled();
    expect(mockServer.sendTransaction).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    expect(storedTransactions()).toEqual([]);
  });

  it("user rejection: a declined signature stops before submission", async () => {
    mockSignTransaction.mockResolvedValue(signRejected);

    const { error } = await submitListing();

    expect(error?.message).toBe("User declined access");
    expect(errorToast).toHaveBeenCalledWith(
      "Listing failed: User declined access",
      expect.anything()
    );
    expect(mockServer.sendTransaction).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    expect(storedTransactions()).toEqual([]);
  });

  it("sendTransaction error: a rejected submission is reported and never polled", async () => {
    mockServer.sendTransaction.mockResolvedValue(sendError);

    const { error } = await submitListing();

    expect(error?.message).toContain("Transaction submission failed");
    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(mockServer.getTransaction).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    // Never accepted by the network, so there is nothing to resume later.
    expect(storedTransactions()).toEqual([]);
  });

  it("FAILED result: an on-chain failure is an error, not a success", async () => {
    mockServer.getTransaction.mockResolvedValueOnce(getNotFound).mockResolvedValue(getFailed);

    const { error } = await submitListing();

    expect(error?.message).toContain("Transaction failed on-chain");
    expect(errorToast).toHaveBeenCalledWith(
      expect.stringContaining("Transaction failed on-chain"),
      expect.anything()
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(storedTransactions()).toEqual([
      expect.objectContaining({ hash: TX_HASH, status: "failed", error: "FAILED_RESULT_XDR" }),
    ]);
  });

  it("poll timeout: never confirming is an error, and the transaction stays pending", async () => {
    mockServer.getTransaction.mockResolvedValue(getNotFound);
    accelerateClock();

    const { error } = await submitListing();

    expect(error?.message).toContain("not confirmed within");
    expect(errorToast).toHaveBeenCalledWith(
      expect.stringContaining("not confirmed within"),
      expect.anything()
    );
    expect(successToast).not.toHaveBeenCalled();
    // It may still land on-chain, so it is left for resumePendingTransactions.
    expect(storedTransactions()).toEqual([
      expect.objectContaining({ hash: TX_HASH, status: "pending" }),
    ]);
  });

  it("txBAD_SEQ retry: a sequence conflict is rebuilt, re-signed and resubmitted once", async () => {
    mockServer.sendTransaction.mockResolvedValueOnce(sendBadSeq).mockResolvedValue(sendPending);

    const { error } = await submitListing();

    expect(error).toBeUndefined();
    // The retry starts over from a refreshed account: it is a new build, a new
    // assembly and a new signature — not a resend of the stale signed XDR.
    expect(mockAssemble).toHaveBeenCalledTimes(2);
    expect(mockSignTransaction).toHaveBeenCalledTimes(2);
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(2);
    expect(successToast).toHaveBeenCalledTimes(1);
    expect(errorToast).not.toHaveBeenCalled();
    expect(storedTransactions()).toEqual([
      expect.objectContaining({ hash: TX_HASH, status: "success" }),
    ]);
  });
});

// ── Pending transactions resumed on the next load (#466) ────────────────────

describe("resumePendingTransactions", () => {
  const pendingRecord = (timestamp: number): TxRecord => ({
    hash: TX_HASH,
    account: "GACCOUNT",
    method: "list_bot",
    argsSummary: "7, 100",
    status: "pending",
    timestamp,
  });

  it("resolves a transaction left pending by a poll timeout once it lands", async () => {
    mockServer.getTransaction.mockResolvedValue(getNotFound);
    accelerateClock();
    await submitListing();
    expect(storedTransactions()[0]?.status).toBe("pending");
    clock?.mockRestore();
    clock = undefined;

    // "Next load": the network has since confirmed it.
    mockServer.getTransaction.mockResolvedValue(getSuccess);
    await resumePendingTransactions();

    expect(storedTransactions()).toEqual([
      expect.objectContaining({ hash: TX_HASH, status: "success" }),
    ]);
  });

  it("records an on-chain failure", async () => {
    useTxStore.setState({ transactions: [pendingRecord(Date.now())] });
    mockServer.getTransaction.mockResolvedValue(getFailed);

    await resumePendingTransactions();

    expect(storedTransactions()).toEqual([
      expect.objectContaining({ status: "failed", error: "FAILED_RESULT_XDR" }),
    ]);
  });

  it("fails a transaction the network never saw once its time bounds have passed", async () => {
    useTxStore.setState({ transactions: [pendingRecord(Date.now() - 10 * 60_000)] });
    mockServer.getTransaction.mockResolvedValue(getNotFound);

    await resumePendingTransactions();

    expect(storedTransactions()).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "Transaction expired before it was confirmed",
      }),
    ]);
  });

  it("leaves a transaction pending when the RPC is unreachable", async () => {
    // Old enough to have expired — but an unreachable RPC proves nothing.
    useTxStore.setState({ transactions: [pendingRecord(Date.now() - 10 * 60_000)] });
    mockServer.getTransaction.mockRejectedValue(new Error("network down"));
    accelerateClock();

    await resumePendingTransactions();

    expect(storedTransactions()).toEqual([expect.objectContaining({ status: "pending" })]);
  });

  it("does nothing when nothing is pending", async () => {
    useTxStore.setState({ transactions: [{ ...pendingRecord(Date.now()), status: "success" }] });

    await resumePendingTransactions();

    expect(mockServer.getTransaction).not.toHaveBeenCalled();
  });
});
