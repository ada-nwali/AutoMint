"use client";

/**
 * AutoMint global error boundary.
 *
 * Wraps the entire React tree and catches any unhandled render error.
 * The error is forwarded to Sentry **after** stripping Stellar addresses
 * and any PII via the `beforeSend` hook registered in sentry.client.ts.
 *
 * Usage
 * -----
 * Wrap a subtree that should fail gracefully:
 *
 * ```tsx
 * <ErrorBoundary fallback={<p>Something went wrong.</p>}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 *
 * Or use the simpler `withErrorBoundary` HOC:
 *
 * ```tsx
 * export default withErrorBoundary(MyComponent, { fallback: <p>Error</p> });
 * ```
 */

import * as Sentry from "@sentry/nextjs";
import React from "react";

export interface ErrorBoundaryProps {
  /** Fallback UI to render when a render error is caught. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  eventId: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const eventId = Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.setState({ eventId });
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            role="alert"
            className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-liner bg-card p-8 text-center"
          >
            <p className="text-sm font-medium text-text">Something went wrong.</p>
            <p className="mt-1 text-xs text-muted">
              Our team has been notified. Please refresh and try again.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, eventId: null })}
              className="mt-4 rounded-lg border border-liner bg-card-2 px-4 py-2 text-xs font-medium text-text transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * HOC variant — wraps `Component` in an `ErrorBoundary`.
 *
 * @example
 * export default withErrorBoundary(MyPage, { fallback: <ErrorPage /> });
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  options: Omit<ErrorBoundaryProps, "children"> = {},
): React.FC<P> {
  const Wrapped: React.FC<P> = (props) => (
    <ErrorBoundary {...options}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `WithErrorBoundary(${Component.displayName ?? Component.name})`;
  return Wrapped;
}
