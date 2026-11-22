import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading UI for /dashboard.
 *
 * Deliberately static: a loading.tsx boundary must not call data hooks
 * (those live behind the page's providers/query lifecycle), so this is
 * pure skeleton markup. `Skeleton` handles prefers-reduced-motion itself.
 */
export default function DashboardLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-6 py-8"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <span className="sr-only">Loading dashboard...</span>

      <div className="mb-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-3 h-4 w-72" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column — points, claim, upgrade */}
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-liner bg-card p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="mt-4 h-7 w-48" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
            <Skeleton className="mt-4 h-10 w-full rounded-xl" />
          </div>
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>

        {/* Right column — bot grid */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
