"use client";

/**
 * Marketplace route-segment error boundary.
 *
 * Listing decode failures (a price outside the expected range, a listing
 * shape the contract changed) are contained to this route rather than
 * blanking the app.
 */

import { RouteError } from "@/components/ui/RouteError";

export default function MarketplaceError({
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
      boundary="marketplace"
      title="Marketplace failed to load"
      description="Listings could not be rendered. Any bot you have listed is still in escrow."
    />
  );
}
