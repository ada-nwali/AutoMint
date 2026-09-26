/**
 * Sentry server-side (Node.js / Edge Runtime) SDK initialization.
 *
 * Mirrors the client-side scrubbing rules so that server-rendered traces
 * are equally sanitized.  See docs/PRIVACY.md for the full policy.
 */

import * as Sentry from "@sentry/nextjs";

const STELLAR_ADDRESS_RE = /\b[GCM][A-Z0-9]{55}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

function scrubString(value: string): string {
  return value.replace(STELLAR_ADDRESS_RE, "[address]").replace(EMAIL_RE, "[email]");
}

Sentry.init({
  // Only pass a dsn when one is configured — `dsn: undefined` is rejected
  // under exactOptionalPropertyTypes.
  ...(process.env.NEXT_PUBLIC_SENTRY_DSN
    ? { dsn: process.env.NEXT_PUBLIC_SENTRY_DSN }
    : {}),

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  sendDefaultPii: false,

  beforeSend(event) {
    if (event.request?.url) {
      event.request.url = scrubString(event.request.url);
    }
    return event;
  },

  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
});
