"use client";

/**
 * Dashboard route-segment error boundary.
 *
 * The dashboard composes several independent panels — bot grid, animated
 * points counter, claim button, registration banner — each decoding contract
 * data. Without a boundary on this segment, one panel throwing would bubble
 * to the root boundary and take the whole route with it.
 */

import { RouteError } from "@/components/ui/RouteError";

export default function DashboardError({
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
      boundary="dashboard"
      title="Dashboard failed to load"
      description="Your bots and points could not be rendered. Your on-chain balance is unaffected."
    />
  );
}
