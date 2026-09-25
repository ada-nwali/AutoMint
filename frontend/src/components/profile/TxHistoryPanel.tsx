"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { useTxStore, selectTransactions, type TxStatus } from "@/store/txStore";
import { getExplorerUrl } from "@/lib/explorer";

const METHOD_LABELS: Record<string, string> = {
  register: "Register",
  mint_basic: "Mint basic bot",
  mint: "Mint bot",
  start_accrual: "Start accrual",
  claim: "Claim points",
  list_bot: "List bot",
  buy_bot: "Buy bot",
  cancel_listing: "Cancel listing",
};

const STATUS_LABELS: Record<TxStatus, string> = {
  pending: "Confirming",
  success: "Confirmed",
  failed: "Failed",
};

const STATUS_STYLES: Record<TxStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface TxHistoryPanelProps {
  /** Wallet whose transactions are listed. */
  account: string;
}

/**
 * The connected wallet's persisted transaction history, newest first.
 *
 * Reads from the persisted tx store, so it survives reloads; entries still
 * `pending` after a reload are settled by `useResumePendingTransactions`, and
 * flip to Confirmed / Failed here as they resolve.
 */
export function TxHistoryPanel({ account }: TxHistoryPanelProps) {
  const transactions = useTxStore(selectTransactions);
  const mine = useMemo(
    () => transactions.filter((tx) => tx.account === account),
    [transactions, account]
  );

  return (
    <section
      aria-labelledby="tx-history-heading"
      className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      data-testid="tx-history-panel"
    >
      <h2 id="tx-history-heading" className="mb-4 text-xl font-bold text-gray-900 dark:text-white">
        Transaction History
      </h2>

      {mine.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No transactions yet. Actions you take on-chain will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {mine.map((tx) => (
            <li
              key={tx.hash}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              data-testid="tx-history-item"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white">
                  {METHOD_LABELS[tx.method] ?? tx.method}
                </p>
                <p className="truncate font-mono text-xs text-gray-600 dark:text-gray-400">
                  {tx.argsSummary || "no arguments"}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatTimestamp(tx.timestamp)} ·{" "}
                  <a
                    href={getExplorerUrl(tx.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {tx.hash.slice(0, 8)}…
                  </a>
                </p>
              </div>
              <span
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  STATUS_STYLES[tx.status]
                )}
                title={tx.status === "failed" ? tx.error : undefined}
              >
                {STATUS_LABELS[tx.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default TxHistoryPanel;
