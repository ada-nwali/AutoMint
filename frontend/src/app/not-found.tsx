/**
 * Root 404 page.
 *
 * Rendered for unknown routes and for `notFound()` calls (e.g. a bot id that
 * does not exist). It sits inside the root layout, so the header and footer
 * stay mounted, and it reuses the look of `RouteError` so a missing page
 * feels like part of the app rather than Next.js's default 404.
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/not-found
 */

import Link from "next/link";
import { Compass, LayoutDashboard, Store } from "lucide-react";

export default function NotFound() {
  return (
    <div
      role="alert"
      data-testid="not-found"
      className="mx-auto my-10 flex max-w-md flex-col items-center justify-center rounded-2xl border border-liner bg-card p-8 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-liner bg-card-2">
        <Compass className="h-6 w-6 text-gold" aria-hidden="true" />
      </div>

      <h1 className="font-display text-lg font-semibold text-text">Page not found</h1>
      <p className="mt-1.5 text-sm text-muted">
        The page you are looking for does not exist or has moved.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-all hover:border-gold/50 hover:bg-gold/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
          Go to dashboard
        </Link>

        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 rounded-xl border border-liner bg-card-2 px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-liner-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Store className="h-3.5 w-3.5" aria-hidden="true" />
          Browse marketplace
        </Link>
      </div>
    </div>
  );
}
