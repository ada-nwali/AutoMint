"use client";

import { AlertTriangle } from "lucide-react";
import { usePauseStatus } from "@/hooks/usePauseStatus";

/**
 * Site-wide notice shown while the marketplace (`is_paused`) or the AMT
 * token (`paused`) is paused (#1416), so users learn before a buy, list or
 * claim fails with a contract error. The affected buttons read the same
 * `usePauseStatus` query and disable themselves.
 */
export default function PauseBanner() {
  const { marketplacePaused, tokenPaused } = usePauseStatus();

  if (!marketplacePaused && !tokenPaused) return null;

  let message: string;
  if (marketplacePaused && tokenPaused) {
    message =
      "The marketplace and the AMT token are temporarily paused. Buying, listing, minting paid bots and claiming rewards are unavailable.";
  } else if (marketplacePaused) {
    message =
      "The marketplace is temporarily paused. Buying and listing bots are unavailable until it resumes.";
  } else {
    message =
      "The AMT token is temporarily paused. Buying bots, minting paid bots and claiming rewards are unavailable until it resumes.";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pause-banner"
      className="border-b border-amber-500/30 bg-amber-500/10"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-2 px-6 py-2.5 text-sm text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </div>
  );
}
