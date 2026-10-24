/**
 * Sentry server-side (Node.js / Edge Runtime) SDK initialization.
 *
 * Mirrors the client-side scrubbing rules so that server-rendered traces
 * are equally sanitized.  See docs/PRIVACY.md for the full policy.
 */

import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./sentryScrub";

Sentry.init({
  // Only pass a dsn when one is configured — `dsn: undefined` is rejected
  // under exactOptionalPropertyTypes.
  ...(process.env.NEXT_PUBLIC_SENTRY_DSN
    ? { dsn: process.env.NEXT_PUBLIC_SENTRY_DSN }
    : {}),

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  sendDefaultPii: false,

  beforeSend: scrubEvent,

  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
});
