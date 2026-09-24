"use client";

/**
 * Root route-segment error boundary.
 *
 * Catches any render-time throw in a page below `app/` — a `parseBotNFT`
 * shape the contract never returns, a bigint conversion on a malformed
 * simulation result, a tier lookup that misses — and renders a fallback
 * instead of the blank white page React leaves behind when an error escapes
 * unhandled.
 *
 * The root layout stays mounted, so the header, footer and providers survive
 * and `reset()` re-renders only the segment that threw. An error thrown by
 * the root layout itself renders above this boundary and is caught by
 * `global-error.tsx` instead.
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/error
 */

import { RouteError } from "@/components/ui/RouteError";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      boundary="app"
      description="This page failed to render. You can retry without reloading the app."
    />
  );
}
