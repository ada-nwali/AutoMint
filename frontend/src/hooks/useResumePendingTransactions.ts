import { useEffect } from "react";
import { useTxStore } from "@/store/txStore";

/**
 * On mount, resume polling for any transaction the persisted history still
 * lists as `pending` — i.e. one whose tab was closed while it was confirming.
 * Each resolves to success or failed in the store, which the history panel
 * renders.
 *
 * The transaction module (and with it the Stellar SDK) is loaded on demand, so
 * routes with nothing to resume never pay for it.
 */
export function useResumePendingTransactions(): void {
  useEffect(() => {
    const hasPending = useTxStore.getState().transactions.some((tx) => tx.status === "pending");
    if (!hasPending) return;

    import("@/lib/transaction")
      .then(({ resumePendingTransactions }) => resumePendingTransactions())
      .catch(() => {
        // Entries left unresolved stay `pending`; the next load retries them.
      });
  }, []);
}
