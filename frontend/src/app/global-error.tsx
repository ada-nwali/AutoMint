"use client";

/**
 * Next.js App Router global error page.
 *
 * Rendered when an unhandled error escapes the root layout.  Automatically
 * forwards the error to Sentry (via `captureException`) before showing the
 * fallback UI.
 *
 * https://nextjs.org/docs/app/building-your-application/routing/error-handling#handling-global-errors
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-bg font-sans text-text">
        <div className="w-full max-w-md rounded-2xl border border-liner bg-card p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-bold text-text">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            An unexpected error occurred. Our team has been notified.
          </p>

          {error.digest && (
            <p className="mt-3 font-mono text-xs text-muted">
              Reference: <span className="rounded bg-card-2 px-1 py-0.5">{error.digest}</span>
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-xl border border-gold/30 bg-gold/10 px-6 py-3 text-sm font-medium text-gold transition-all hover:bg-gold/20 hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
