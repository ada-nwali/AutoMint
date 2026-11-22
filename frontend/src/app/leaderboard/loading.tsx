import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading UI for /leaderboard.
 *
 * Deliberately static: a loading.tsx boundary must not call data hooks
 * (those live behind the page's providers/query lifecycle), so this is
 * pure skeleton markup matching the page header and table rows.
 * `Skeleton` handles prefers-reduced-motion itself.
 */
export default function LeaderboardLoading() {
  return (
    <main
      className="mx-auto max-w-4xl px-4 py-10"
      role="status"
      aria-busy="true"
      aria-label="Loading leaderboard"
    >
      <span className="sr-only">Loading leaderboard...</span>

      <div className="mb-8 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-liner">
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
    </main>
  );
}
