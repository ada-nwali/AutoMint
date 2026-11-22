/**
 * Sentry browser-side SDK initialization.
 *
 * Injected into browser entry points by withSentryConfig in next.config.js.
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
import { scrubEvent } from "./src/lib/sentryScrub";

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
  beforeSend: scrubEvent,

  /**
   * Tag every event with the deployment environment so issues can be
   * filtered by staging vs. production in the Sentry dashboard.
   */
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
});
