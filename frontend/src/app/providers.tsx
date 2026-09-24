"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { retryQuery, retryMutation } from "@/lib/retry";
import { TxStatusList } from "@/components/ui/TxStatus";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Freshness is declared per query (lib/queryKeys.ts STALE_TIME); the
            // global default is 0 so a post-mutation invalidation refetches at
            // once instead of competing with a 5-minute window (#496).
            staleTime: 0,
            // Retry only network-class failures, never a contract error,
            // NotRegistered, or a user rejection (#497).
            retry: retryQuery,
            retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
          mutations: {
            // One retry for a pre-signature network blip; a submitted
            // transaction is never resubmitted (#497).
            retry: retryMutation,
            retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 8000),
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Persistent per-transaction status rows (#461) — one row per tx id,
          bottom-left so it never collides with the sonner toaster. */}
      <TxStatusList />
      <Toaster
        position="bottom-right"
        richColors
        toastOptions={{
          className: "!bg-card !border !border-liner !text-text",
        }}
      />
    </QueryClientProvider>
  );
}
