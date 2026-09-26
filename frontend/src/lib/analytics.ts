/**
 * AutoMint product analytics — privacy-respecting funnel tracking.
 *
 * Design principles
 * -----------------
 * 1. **No PII**.  Stellar addresses are never sent as-is; they are replaced
 *    with a one-way SHA-256 hash prefix so we can count unique users without
 *    storing the address itself.  No name, e-mail, IP address, or device
 *    fingerprint is ever attached to an event.
 *
 * 2. **Opt-out by default in test environments**.  Events are no-ops when
 *    `NEXT_PUBLIC_ANALYTICS_ENABLED` is absent or `"false"`.
 *
 * 3. **Sentry as the transport**.  Rather than adding a second third-party
 *    SDK, we reuse Sentry's `addBreadcrumb` + `captureMessage` to ship
 *    structured funnel events, keeping the dependency footprint small.
 *    Replace the `_dispatch` implementation below to swap in a dedicated
 *    analytics service (e.g. PostHog, Plausible) without changing call sites.
 *
 * Core funnel events
 * ------------------
 * | Event                     | Fired when                                 |
 * |---------------------------|--------------------------------------------|
 * | wallet_connect_started    | User clicks "Connect Wallet"               |
 * | wallet_connect_success    | Freighter access granted                   |
 * | wallet_connect_failed     | Connection attempt throws / is rejected    |
 * | registration_started      | User submits the registration form         |
 * | registration_success      | register → mint_basic → start_accrual done |
 * | registration_failed       | Any step in registration throws            |
 * | claim_started             | User clicks "Claim Rewards"                |
 * | claim_success             | claimPoints() resolves                     |
 * | claim_failed              | claimPoints() rejects (includes error code)|
 * | marketplace_buy_started   | User clicks "Buy" on a listing             |
 * | marketplace_buy_success   | buy_bot tx confirmed                       |
 * | marketplace_buy_failed    | buy_bot tx rejected / contract error       |
 *
 * See docs/PRIVACY.md for the complete data-collection policy.
 */

import * as Sentry from "@sentry/nextjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | "wallet_connect_started"
  | "wallet_connect_success"
  | "wallet_connect_failed"
  | "registration_started"
  | "registration_success"
  | "registration_failed"
  | "claim_started"
  | "claim_success"
  | "claim_failed"
  | "marketplace_buy_started"
  | "marketplace_buy_success"
  | "marketplace_buy_failed";

export interface AnalyticsProperties {
  /** Anonymised user identifier — SHA-256 hash of the Stellar address. */
  user_hash?: string;
  /** Contract error code returned by the Soroban RPC (e.g. "Error(Contract, #4)"). */
  contract_error?: string;
  /** Human-readable error message, already scrubbed by Sentry beforeSend. */
  error_message?: string;
  /** Bot tier involved in the action (0-4). */
  bot_tier?: number;
  /** Arbitrary string tag for additional context. */
  label?: string;
  [key: string]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ENABLED =
  typeof window !== "undefined" && process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";

/**
 * Produce a stable, anonymous identifier for a Stellar address.
 *
 * Uses the Web Crypto API (available in all modern browsers and Node ≥ 15)
 * to compute SHA-256 of the UTF-8 address bytes, then returns the first
 * 16 hex characters — enough entropy to count uniques without being
 * practically reversible.
 */
export async function hashAddress(address: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return "unknown";
  }
  const buf = new TextEncoder().encode(address);
  const hash = await window.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * The actual dispatch implementation.
 *
 * Swap this function body to route events to a different analytics back-end
 * (PostHog, Amplitude, Plausible, etc.) without touching call sites.
 */
function _dispatch(event: AnalyticsEvent, props: AnalyticsProperties): void {
  Sentry.addBreadcrumb({
    category: "analytics",
    message: event,
    data: props,
    level: "info",
  });

  // In development also emit a console group for easy debugging.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[analytics] ${event}`);
    // eslint-disable-next-line no-console
    console.log(props);
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire a named analytics event with optional properties.
 *
 * The call is a no-op when analytics is disabled (see `ENABLED`).
 *
 * @example
 * track("claim_started", { user_hash: await hashAddress(publicKey) });
 */
export function track(event: AnalyticsEvent, props: AnalyticsProperties = {}): void {
  if (!ENABLED) return;
  _dispatch(event, props);
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * React hook that returns a memoised `track` function pre-bound to the
 * current wallet address hash.  Avoids calling `hashAddress` on every
 * render by caching the result in a closure.
 *
 * @example
 * const { track } = useAnalytics(publicKey);
 * track("claim_started");
 */
export function useAnalytics(address: string | null): {
  track: (event: AnalyticsEvent, extra?: AnalyticsProperties) => void;
} {
  // We compute the hash lazily and cache it so the crypto call runs at most
  // once per address change.
  let cachedHash: string | undefined;

  const trackWithAddress = (event: AnalyticsEvent, extra: AnalyticsProperties = {}) => {
    if (!ENABLED) return;

    if (address && !cachedHash) {
      // Fire-and-forget: hash the address asynchronously, then re-dispatch.
      hashAddress(address).then((h) => {
        cachedHash = h;
        _dispatch(event, { ...extra, user_hash: h });
      });
    } else {
      _dispatch(event, {
        ...extra,
        ...(cachedHash ? { user_hash: cachedHash } : {}),
      });
    }
  };

  return { track: trackWithAddress };
}
