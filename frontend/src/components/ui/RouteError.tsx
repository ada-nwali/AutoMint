"use client";

/**
 * Shared fallback for the App Router `error.tsx` boundaries.
 *
 * Next.js renders a route segment's `error.tsx` in place of the segment that
 * threw, keeping the root layout — header, footer, providers — mounted. That
 * is what turns a render-time throw from a blank white page into a recoverable
 * panel, so this component is deliberately scoped to a panel rather than a
 * full page.
 *
 * `global-error.tsx` does not use this component: it replaces the root layout
 * itself, so it cannot assume the design system or any provider is still
 * mounted and has to stand alone.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle, RotateCw, LifeBuoy } from "lucide-react";

const SUPPORT_URL = "https://github.com/Ada-Girly881/AutoMint/issues";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Re-renders the segment that threw. Supplied by Next.js. */
  reset: () => void;
  /** Which boundary caught this, tagged on the reported event. */
  boundary: string;
  title?: string;
  description?: string;
}

export function RouteError({
  error,
  reset,
  boundary,
  title = "Something went wrong",
  description = "This section failed to render. The rest of the app is still working.",
}: RouteErrorProps) {
  useEffect(() => {
    // The reporter's `beforeSend` scrubs Stellar addresses and e-mails, so
    // the stack trace can be sent as-is. See src/lib/sentry.client.ts.
    Sentry.captureException(error, { tags: { boundary } });
  }, [error, boundary]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="route-error"
      className="mx-auto my-10 flex max-w-md flex-col items-center justify-center rounded-2xl border border-liner bg-card p-8 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-liner bg-card-2">
        <AlertTriangle className="h-6 w-6 text-gold" aria-hidden="true" />
      </div>

      <h2 className="font-display text-lg font-semibold text-text">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{description}</p>

      {/* The digest is the only handle support has on a production error —
          Next.js replaces the real message with it so nothing leaks to the
          client, so it has to be visible and copyable. */}
      {error.digest && (
        <p className="mt-3 text-xs text-muted" data-testid="route-error-digest">
          Reference:{" "}
          <span className="rounded bg-card-2 px-1 py-0.5 font-mono">{error.digest}</span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-all hover:border-gold/50 hover:bg-gold/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </button>

        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-liner bg-card-2 px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-liner-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
          Get Support
        </a>
      </div>
    </div>
  );
}

export default RouteError;
