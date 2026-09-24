import { DASHBOARD_POLL_MS } from "./queryKeys";

/**
 * A `refetchInterval` that pauses entirely while the tab is hidden (#495).
 *
 * The dashboard previously kept polling in the background because
 * `refetchOnWindowFocus` was disabled rather than made smart — eight hooks,
 * each firing its own RPC request (and its own `getAccount`) every 30 seconds,
 * whether or not anyone was looking. Returning `false` from `refetchInterval`
 * suspends the poll; React Query resumes it on the next visibility change.
 *
 * Pass the same `baseMs` (default `DASHBOARD_POLL_MS`) to every polled query so
 * the cadence is controlled from one place.
 */
export function pollWhenVisible(
  baseMs: number = DASHBOARD_POLL_MS,
): () => number | false {
  return () => {
    if (typeof document !== "undefined" && document.hidden) return false;
    return baseMs;
  };
}
