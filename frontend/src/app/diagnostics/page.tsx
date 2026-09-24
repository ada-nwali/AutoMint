"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, XCircle, RotateCw } from "lucide-react";
import clsx from "clsx";
import { preflight, type PreflightReport } from "@/lib/contracts";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { ErrorState } from "@/components/ui/ErrorState";

const KIND_LABEL: Record<string, string> = {
  ok: "Reachable",
  "unreachable-rpc": "Unreachable RPC",
  "contract-not-found": "Contract not found",
};

export default function DiagnosticsPage() {
  const publicKey = useWalletStore(selectPublicKey);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setReport(await preflight(publicKey ?? undefined));
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15">
          <Activity className="h-5 w-5 text-gold" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Contract diagnostics</h1>
          <p className="text-sm text-muted">
            One cheap read against each configured contract. Cached for the session.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Checking contracts"
          className="rounded-2xl border border-liner bg-card p-8 text-center text-sm text-muted"
        >
          Checking contracts…
        </div>
      ) : error ? (
        <ErrorState
          error={error}
          title="Diagnostics failed"
          onRetry={run}
          isRetrying={false}
          data-testid="diagnostics-error-state"
        />
      ) : report ? (
        <section
          aria-label="Contract reachability"
          data-testid="diagnostics-results"
          className="overflow-hidden rounded-2xl border border-liner bg-card"
        >
          <div
            className={clsx(
              "border-b border-liner px-5 py-3 text-sm font-semibold",
              report.ok ? "text-green-500" : "text-gold"
            )}
            role="status"
          >
            {report.ok
              ? "All 5 contracts reachable."
              : "One or more contracts failed — see which one below."}
          </div>
          <ul className="divide-y divide-liner">
            {report.results.map((r) => (
              <li
                key={r.name}
                data-testid={`diagnostics-row-${r.name}`}
                className="flex flex-col gap-1 px-5 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm font-semibold text-text">
                    {r.name}
                  </span>
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                      r.ok
                        ? "border-green-500/30 bg-green-500/10 text-green-500"
                        : "border-pink/30 bg-pink/10 text-pink"
                    )}
                  >
                    {r.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                </div>
                <code className="truncate font-mono text-xs text-muted" title={r.contractId}>
                  {r.contractId}
                </code>
                {!r.ok && r.error && (
                  <p className="text-xs text-muted">
                    <span className="font-semibold text-text">Error: </span>
                    {r.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {!report.ok && (
            <div className="border-t border-liner px-5 py-4">
              <button
                type="button"
                onClick={run}
                className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-xs font-semibold text-gold transition-all hover:bg-gold/20"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry check
              </button>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
