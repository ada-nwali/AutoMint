/**
 * Sentry browser-side SDK initialization.
 *
 * Loaded automatically by the Next.js Sentry instrumentation hook
 * (instrumentation.ts → onClientEntry).
 *
 * Privacy guarantees
 * ------------------
 * - `beforeSend` scrubs every Stellar public key (G…, C…, M… 56-char strings)
 *   and any e-mail addresses from event breadcrumbs and request URLs before the
 *   event leaves the browser.
 * - Default PII collection (`sendDefaultPii`) is disabled.
 * - Session replays are intentionally **not** enabled.
 *
 * See docs/PRIVACY.md for the full data-collection policy.
 */

import * as Sentry from "@sentry/nextjs";

// Stellar address pattern: starts with G, C, or M and is 56 chars total.
const STELLAR_ADDRESS_RE = /\b[GCM][A-Z0-9]{55}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

function scrubString(value: string): string {
  return value.replace(STELLAR_ADDRESS_RE, "[address]").replace(EMAIL_RE, "[email]");
}

function scrubBreadcrumbs(breadcrumbs: Sentry.Breadcrumb[]): Sentry.Breadcrumb[] {
  return breadcrumbs.map((b) => ({
    ...b,
    // Optional props are only re-specified when present — `exactOptionalPropertyTypes`
    // forbids assigning `undefined` to them.
    ...(b.message ? { message: scrubString(b.message) } : {}),
    ...(b.data
      ? {
          data: Object.fromEntries(
            Object.entries(b.data).map(([k, v]) => [
              k,
              typeof v === "string" ? scrubString(v) : v,
            ]),
          ),
        }
      : {}),
  }));
}

Sentry.init({
  // Only pass a dsn when one is configured — `dsn: undefined` is rejected
  // under exactOptionalPropertyTypes, and an empty string is meaningless.
  ...(process.env.NEXT_PUBLIC_SENTRY_DSN
    ? { dsn: process.env.NEXT_PUBLIC_SENTRY_DSN }
    : {}),

  /**
   * Sample 10 % of traces in production; 100 % in other environments so
   * local development always shows performance data.
   */
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  /** Never attach the user's IP address or infer their identity. */
  sendDefaultPii: false,

  /**
   * Strip Stellar addresses and e-mails from every outbound event.
   * Returning `null` drops the event entirely; returning the mutated event
   * allows it through.
   */
  beforeSend(event) {
    // `breadcrumbs` is a plain array on the Event type (not a Map), so it is
    // replaced wholesale after scrubbing.
    if (event.breadcrumbs) {
      event.breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
    }

    if (event.request?.url) {
      event.request.url = scrubString(event.request.url);
    }

    if (event.request?.headers) {
      // Drop the Referer header — it may contain address fragments from
      // query-string navigation.
      delete event.request.headers["Referer"];
      delete event.request.headers["referer"];
    }

    return event;
  },

  /**
   * Tag every event with the deployment environment so issues can be
   * filtered by staging vs. production in the Sentry dashboard.
   */
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
});
