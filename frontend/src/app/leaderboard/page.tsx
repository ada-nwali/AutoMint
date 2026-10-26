"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import { useLeaderboard, useRank, useSeason } from "@/hooks/useLeaderboard";
import { useLeaderboardAccruals } from "@/hooks/useLeaderboardAccruals";
import { useProfiles } from "@/hooks/useProfiles";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";

// Code-split the table (framer-motion row animations) out of the route's
// initial bundle — it's only needed once data has loaded.
const LeaderboardTable = dynamic(
  () => import("@/components/leaderboard/LeaderboardTable").then((mod) => mod.LeaderboardTable),
  { ssr: false },
);

export default function LeaderboardPage() {
  // #371 — "All-time" vs the current season board. `null` = all-time.
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const { data: season } = useSeason();
  const seasonAvailable = typeof season === "number" && season > 0;
  const activeSeason =
    selectedSeason !== null && seasonAvailable ? selectedSeason : undefined;
  const seasonView = activeSeason !== undefined;

  const {
    data: leaderboardData,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useLeaderboard(undefined, activeSeason);
  // Season rows carry their own display names; the all-time overlays
  // (lifetime accruals, batch profiles, personal pin) stay all-time only —
  // an empty address list keeps both batch queries disabled in season view.
  const rowAddresses = seasonView
    ? []
    : (leaderboardData ?? []).map((user) => user.address);
  // One accrual call per poll for every visible row (#420).
  const { data: accrualStates } = useLeaderboardAccruals(rowAddresses);
  // One batch profile call for all visible rows instead of per-row get_user lookups.
  const { data: profiles } = useProfiles(rowAddresses);
  const publicKey = useWalletStore(selectPublicKey);
  // #506 — the table only holds the top 50; this is how everyone else finds
  // out where they stand. Disabled while no wallet is connected.
  const { data: currentUserRank } = useRank(selectedSeason ?? undefined);

  // #202 — surface load failures the same way the rest of the app does
  // (sonner toast), in addition to the inline ErrorState component.
  const hasToastedError = useRef(false);
  useEffect(() => {
    if (isError && !hasToastedError.current) {
      hasToastedError.current = true;
      toast.error("Failed to load leaderboard. Please try again later.");
    } else if (!isError) {
      hasToastedError.current = false;
    }
  }, [isError]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Page header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15">
          <Trophy className="h-5 w-5 text-gold" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Leaderboard</h1>
          <p className="text-sm text-muted">Top earners across the network</p>
        </div>
      </div>

      {/* #371 — period toggle; hidden until the registry reports a season. */}
      {seasonAvailable && (
        <div
          className="mb-6 flex gap-2"
          data-testid="season-toggle"
          role="group"
          aria-label="Leaderboard period"
        >
          <button
            type="button"
            onClick={() => setSelectedSeason(null)}
            aria-pressed={selectedSeason === null}
            data-testid="toggle-all-time"
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              selectedSeason === null
                ? "border-gold/60 bg-gold/15 text-gold"
                : "border-liner text-muted hover:text-text",
            )}
          >
            All-time
          </button>
          <button
            type="button"
            onClick={() => setSelectedSeason(season)}
            aria-pressed={selectedSeason !== null}
            data-testid="toggle-season"
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              selectedSeason !== null
                ? "border-gold/60 bg-gold/15 text-gold"
                : "border-liner text-muted hover:text-text",
            )}
          >
            Season {season}
          </button>
        </div>
      )}

      {/* Loading state — skeleton rows matching the real table shape */}
      {isLoading && (
        <div
          className="overflow-hidden rounded-2xl border border-liner"
          data-testid="leaderboard-loading"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="flex border-b border-liner px-4 py-3">
            <Skeleton className="h-3 w-10" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-liner px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-5 w-6 rounded" />
              <Skeleton className="h-4 flex-1 max-w-[10rem]" />
              <Skeleton className="ml-auto h-4 w-14" />
              <Skeleton className="hidden h-3 w-20 sm:block" />
            </div>
          ))}
        </div>
      )}

      {/* Error state with retry and network vs contract diagnosis (#513) */}
      {isError && !isLoading && (
        <ErrorState
          error={error}
          title="Failed to Load Leaderboard"
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          data-testid="leaderboard-error"
        />
      )}

      {/* Empty state */}
      {!isLoading && !isError && (!leaderboardData || leaderboardData.length === 0) && (
        <div
          className="rounded-2xl border border-liner bg-card px-6 py-10 text-center text-muted"
          data-testid="leaderboard-empty"
        >
          <Trophy className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p className="text-sm">No rankings yet. Be the first to earn points!</p>
        </div>
      )}

      {/* Populated table */}
      {!isLoading && !isError && leaderboardData && leaderboardData.length > 0 && (
        <LeaderboardTable
          users={leaderboardData.map((user, index) => ({ ...user, rank: index + 1 }))}
          currentAddress={publicKey}
          currentUserRank={currentUserRank ?? null}
          accrualStates={accrualStates}
          profiles={profiles}
        />
      )}
    </main>
  );
}
