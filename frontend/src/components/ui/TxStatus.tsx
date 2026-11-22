"use client";

import { create } from "zustand";
import clsx from "clsx";
import { Loader2, CheckCircle2, XCircle, ExternalLink, X } from "lucide-react";
import type { TransactionStatus, TransactionStage } from "@/lib/transaction";
import { classifyError } from "@/lib/errorMap";

/** One tracked transaction — each concurrent tx gets its own row. */
export interface TxEntry {
  id: string;
  label: string;
  status: TransactionStatus;
  updatedAt: number;
}

interface TxStatusState {
  txs: Record<string, TxEntry>;
  track: (id: string, label: string, status: TransactionStatus) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

/**
 * Module-level store for concurrent transactions (#461).
 *
 * Mutation hooks feed every `onStatus` callback into `track()`; the list
 * renders one persistent row per tx id so two concurrent transactions never
 * clobber each other the way a single `toast.loading({ id })` does.
 */
export const useTxStatusStore = create<TxStatusState>()((set) => ({
  txs: {},
  track: (id, label, status) =>
    set((s) => ({ txs: { ...s.txs, [id]: { id, label, status, updatedAt: Date.now() } } })),
  dismiss: (id) =>
    set((s) => {
      const next = { ...s.txs };
      delete next[id];
      return { txs: next };
    }),
  clear: () => set({ txs: {} }),
}));

/** Push an `onStatus` update into the store (call from any mutation hook). */
export function trackStatus(id: string, label: string, status: TransactionStatus): void {
  useTxStatusStore.getState().track(id, label, status);
}

/** Build an `onStatus` callback that forwards into the store. */
export function createTxStatusHandler(
  id: string,
  label: string
): (status: TransactionStatus) => void {
  return (status) => trackStatus(id, label, status);
}

/** Unique id per mutation invocation so concurrent txs get separate rows. */
export function newTxId(label: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${label}-${Date.now()}-${rand}`;
}

const STAGE_META: Record<TransactionStage, { label: string; dot: string; spin: boolean }> = {
  building: { label: "Building transaction", dot: "bg-muted", spin: true },
  simulating: { label: "Simulating", dot: "bg-sky-400", spin: true },
  assembling: { label: "Assembling", dot: "bg-sky-400", spin: true },
  signing: { label: "Waiting for wallet signature", dot: "bg-gold", spin: true },
  submitting: { label: "Submitting to blockchain", dot: "bg-blue-400", spin: true },
  polling: { label: "Confirming on-chain", dot: "bg-blue-400", spin: true },
  success: { label: "Confirmed", dot: "bg-green-500", spin: false },
  error: { label: "Failed", dot: "bg-pink", spin: false },
};

function truncateHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

export function TxStatusRow({ entry }: { entry: TxEntry }) {
  const { status, label, id } = entry;
  const meta = STAGE_META[status.stage];
  const dismiss = useTxStatusStore((s) => s.dismiss);
  const classified = status.stage === "error" && status.error ? classifyError(status.error) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`txstatus-row-${id}`}
      data-stage={status.stage}
      className={clsx(
        "w-80 rounded-2xl border border-liner bg-card p-4 shadow-lg",
        status.stage === "success" && "border-green-500/40",
        status.stage === "error" && "border-pink/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        <button
          type="button"
          onClick={() => dismiss(id)}
          aria-label={`Dismiss ${label} transaction status`}
          className="rounded p-0.5 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <span className={clsx("h-2 w-2 shrink-0 rounded-full", meta.dot)} aria-hidden="true" />
        {meta.spin ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden="true" />
        ) : status.stage === "success" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-pink" aria-hidden="true" />
        )}
        <span className="text-sm font-medium text-text">{meta.label}</span>
      </div>

      {status.hash && (
        <p className="mt-1.5 font-mono text-xs text-muted" title={status.hash}>
          Hash: {truncateHash(status.hash)}
        </p>
      )}

      {status.explorerUrl && (
        <a
          href={status.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          View in explorer
        </a>
      )}

      {status.stage === "error" && (
        <p className="mt-1.5 text-xs text-pink">
          {classified ? (
            <>
              <span className="font-semibold">{classified.title}: </span>
              {classified.message}
            </>
          ) : (
            (status.error ?? "Unknown error")
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Persistent bottom-sheet list of in-flight and recently finished
 * transactions (#461). Rendered once in `app/providers.tsx` so every
 * `onStatus` update is visible for the full 5–10s pipeline.
 */
export function TxStatusList() {
  const txs = useTxStatusStore((s) => s.txs);
  const entries = Object.values(txs).sort((a, b) => a.updatedAt - b.updatedAt);
  if (entries.length === 0) return null;

  return (
    <div
      data-testid="txstatus-list"
      aria-label="Transaction status"
      className="fixed bottom-4 left-4 z-50 flex flex-col gap-2"
    >
      {entries.map((entry) => (
        <TxStatusRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

export default TxStatusList;
