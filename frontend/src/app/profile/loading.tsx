import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading UI for /profile.
 *
 * Deliberately static: a loading.tsx boundary must not call data hooks
 * (those live behind the page's providers/query lifecycle), so this is
 * pure skeleton markup matching the profile header and stat cards.
 * `Skeleton` handles prefers-reduced-motion itself.
 */
export default function ProfileLoading() {
  return (
    <div
      className="mx-auto max-w-4xl px-4 py-8"
      role="status"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <span className="sr-only">Loading profile...</span>

      <div className="mb-8">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-liner bg-card p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}
