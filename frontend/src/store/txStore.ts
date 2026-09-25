import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** localStorage key the transaction history is persisted under. */
export const TX_HISTORY_STORAGE_KEY = "automint-tx-history";

/** History entries older than this are dropped (30 days). */
export const TX_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `pending` — accepted by the network, outcome not yet known. This is the
 * state a transaction is left in when the tab closes mid-confirmation; it is
 * resolved on the next load.
 */
export type TxStatus = "pending" | "success" | "failed";

export interface TxRecord {
  hash: string;
  /** Wallet that submitted it — the history is shown per connected account. */
  account: string;
  /** Contract method invoked, e.g. `list_bot`. */
  method: string;
  /** Short human-readable rendering of the call arguments. */
  argsSummary: string;
  status: TxStatus;
  /** Submission time, milliseconds since the epoch. */
  timestamp: number;
  /** Failure detail, set when `status` is `failed`. */
  error?: string | undefined;
}

export type NewTxRecord = Omit<TxRecord, "status" | "timestamp" | "error"> & {
  timestamp?: number;
};

/** Drop every record older than {@link TX_HISTORY_MAX_AGE_MS}. */
export function pruneExpired(records: readonly TxRecord[], now: number = Date.now()): TxRecord[] {
  return records.filter((record) => now - record.timestamp <= TX_HISTORY_MAX_AGE_MS);
}

/** Guards against hand-edited or stale-shaped storage contents. */
function isTxRecord(value: unknown): value is TxRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.hash === "string" &&
    typeof record.account === "string" &&
    typeof record.method === "string" &&
    typeof record.argsSummary === "string" &&
    typeof record.timestamp === "number" &&
    (record.status === "pending" || record.status === "success" || record.status === "failed")
  );
}

export interface TxState {
  /** Newest first. */
  transactions: TxRecord[];
  /** Record a submitted transaction as `pending`. A repeated hash is ignored. */
  addTransaction: (record: NewTxRecord) => void;
  /** Settle a pending transaction once its outcome is known. */
  resolveTransaction: (hash: string, status: Exclude<TxStatus, "pending">, error?: string) => void;
  /** Drop entries past the retention window. */
  prune: () => void;
}

/**
 * Persisted transaction history.
 *
 * A transaction is written here the moment the network accepts it — before
 * confirmation — so closing the tab mid-confirmation does not lose it. On the
 * next load `resumePendingTransactions` (lib/transaction.ts) settles whatever
 * is still `pending`. Entries older than 30 days are pruned on rehydration and
 * on every new submission.
 */
export const useTxStore = create<TxState>()(
  persist(
    (set) => ({
      transactions: [],
      addTransaction: (record) =>
        set((state) => {
          if (state.transactions.some((tx) => tx.hash === record.hash)) return state;
          const entry: TxRecord = {
            ...record,
            status: "pending",
            timestamp: record.timestamp ?? Date.now(),
          };
          return { transactions: pruneExpired([entry, ...state.transactions]) };
        }),
      resolveTransaction: (hash, status, error) =>
        set((state) => ({
          transactions: state.transactions.map((tx) =>
            tx.hash === hash ? { ...tx, status, error } : tx
          ),
        })),
      prune: () => set((state) => ({ transactions: pruneExpired(state.transactions) })),
    }),
    {
      name: TX_HISTORY_STORAGE_KEY,
      version: 1,
      // Resolves lazily and tolerates a missing `localStorage` (SSR, blocked
      // storage): persistence quietly degrades to in-memory.
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ transactions: state.transactions }),
      merge: (persisted, current) => {
        const stored = (persisted as { transactions?: unknown } | undefined)?.transactions;
        const records = Array.isArray(stored) ? stored.filter(isTxRecord) : [];
        return { ...current, transactions: pruneExpired(records) };
      },
    }
  )
);

export const selectTransactions = (s: TxState): TxRecord[] => s.transactions;
