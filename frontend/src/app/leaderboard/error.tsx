"use client";

/**
 * Leaderboard route-segment error boundary.
 *
 * The board decodes registry rows, lifetime accruals and batch profiles for
 * up to fifty users. A row the contract returns in an unexpected shape would
 * otherwise bubble to the root boundary and lose the route context.
 */

import { RouteError } from "@/components/ui/RouteError";

export default function LeaderboardError({
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
      boundary="leaderboard"
      title="Leaderboard failed to load"
      description="Rankings could not be rendered. Your points and rank on-chain are unaffected."
    />
  );
}
