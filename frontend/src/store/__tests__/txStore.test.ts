/**
 * Transaction history store (#466): submissions are recorded as pending,
 * survive a reload, and are pruned once older than 30 days.
 */

import {
  TX_HISTORY_MAX_AGE_MS,
  TX_HISTORY_STORAGE_KEY,
  pruneExpired,
  useTxStore,
  type NewTxRecord,
  type TxRecord,
} from "../txStore";

const DAY_MS = 24 * 60 * 60 * 1000;

const newRecord = (hash: string, timestamp: number): NewTxRecord => ({
  hash,
  account: "GACCOUNT",
  method: "list_bot",
  argsSummary: "7, 25000000",
  timestamp,
});

/** A fresh copy of the store module, rehydrated from localStorage — a "reload". */
function reload(): typeof useTxStore {
  let store!: typeof useTxStore;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    store = require("../txStore").useTxStore;
  });
  return store;
}

beforeEach(() => {
  localStorage.clear();
  useTxStore.setState({ transactions: [] });
});

describe("recording", () => {
  it("adds a submitted transaction as pending, newest first", () => {
    const now = Date.now();
    useTxStore.getState().addTransaction(newRecord("hash-a", now - 2_000));
    useTxStore.getState().addTransaction(newRecord("hash-b", now - 1_000));

    const { transactions } = useTxStore.getState();
    expect(transactions.map((tx) => tx.hash)).toEqual(["hash-b", "hash-a"]);
    expect(transactions[0]).toMatchObject({
      account: "GACCOUNT",
      method: "list_bot",
      argsSummary: "7, 25000000",
      status: "pending",
      timestamp: now - 1_000,
    });
  });

  it("stamps the submission time when none is given", () => {
    const before = Date.now();
    const { timestamp: _omitted, ...withoutTimestamp } = newRecord("hash-a", 0);
    useTxStore.getState().addTransaction(withoutTimestamp);

    expect(useTxStore.getState().transactions[0].timestamp).toBeGreaterThanOrEqual(before);
  });

  it("ignores a hash that is already recorded", () => {
    const now = Date.now();
    useTxStore.getState().addTransaction(newRecord("hash-a", now));
    useTxStore.getState().addTransaction(newRecord("hash-a", now));

    expect(useTxStore.getState().transactions).toHaveLength(1);
  });

  it("settles a pending transaction as success or failed", () => {
    const now = Date.now();
    useTxStore.getState().addTransaction(newRecord("hash-a", now));
    useTxStore.getState().addTransaction(newRecord("hash-b", now));

    useTxStore.getState().resolveTransaction("hash-a", "failed", "contract trapped");
    useTxStore.getState().resolveTransaction("hash-b", "success");

    const byHash = Object.fromEntries(
      useTxStore.getState().transactions.map((tx) => [tx.hash, tx])
    );
    expect(byHash["hash-a"]).toMatchObject({ status: "failed", error: "contract trapped" });
    expect(byHash["hash-b"]).toMatchObject({ status: "success" });
    expect(byHash["hash-b"].error).toBeUndefined();
  });
});

describe("persistence", () => {
  it("keeps the history across a reload", () => {
    const now = Date.now();
    useTxStore.getState().addTransaction(newRecord("hash-a", now - 1_000));
    useTxStore.getState().resolveTransaction("hash-a", "success");

    expect(reload().getState().transactions).toEqual([
      expect.objectContaining({ hash: "hash-a", status: "success", method: "list_bot" }),
    ]);
  });

  it("keeps a transaction that was still pending when the page closed", () => {
    useTxStore.getState().addTransaction(newRecord("hash-a", Date.now()));

    expect(reload().getState().transactions).toEqual([
      expect.objectContaining({ hash: "hash-a", status: "pending" }),
    ]);
  });

  it("starts empty when nothing has been stored", () => {
    expect(reload().getState().transactions).toEqual([]);
  });

  it("drops entries older than 30 days on rehydration, along with malformed ones", () => {
    const now = Date.now();
    const stored: unknown[] = [
      { ...newRecord("fresh", now - 29 * DAY_MS), status: "success" },
      { ...newRecord("stale", now - 31 * DAY_MS), status: "success" },
      { hash: "malformed" },
    ];
    localStorage.setItem(
      TX_HISTORY_STORAGE_KEY,
      JSON.stringify({ state: { transactions: stored }, version: 1 })
    );

    expect(reload().getState().transactions.map((tx) => tx.hash)).toEqual(["fresh"]);
  });
});

describe("pruning", () => {
  const record = (hash: string, timestamp: number): TxRecord => ({
    ...newRecord(hash, timestamp),
    status: "success",
    timestamp,
  });

  it("keeps an entry exactly at the retention limit and drops anything older", () => {
    const now = 10 * TX_HISTORY_MAX_AGE_MS;
    const kept = record("at-limit", now - TX_HISTORY_MAX_AGE_MS);
    const dropped = record("just-over", now - TX_HISTORY_MAX_AGE_MS - 1);

    expect(pruneExpired([kept, dropped], now)).toEqual([kept]);
  });

  it("prunes stale entries when a new transaction is recorded", () => {
    const now = Date.now();
    useTxStore.setState({ transactions: [record("stale", now - 40 * DAY_MS)] });

    useTxStore.getState().addTransaction(newRecord("fresh", now));

    expect(useTxStore.getState().transactions.map((tx) => tx.hash)).toEqual(["fresh"]);
  });

  it("prune() removes stale entries on demand", () => {
    const now = Date.now();
    useTxStore.setState({
      transactions: [record("fresh", now), record("stale", now - 40 * DAY_MS)],
    });

    useTxStore.getState().prune();

    expect(useTxStore.getState().transactions.map((tx) => tx.hash)).toEqual(["fresh"]);
  });
});
