# AutoMint Privacy and Data Collection

This document describes data collected by the AutoMint frontend's error
reporting and product analytics integrations, based on the current
implementation. It is not a promise that third-party services or blockchain
networks do not process connection metadata.

## Sentry error reporting and performance

The frontend initializes Sentry in the browser and on the server when
`NEXT_PUBLIC_SENTRY_DSN` is configured. Without a DSN, the app does not send
Sentry events. The app reports caught render errors, unhandled server request
errors, and other errors explicitly captured by its error boundaries. Sentry
performance tracing is sampled at 10% in production and 100% in non-production
environments.

Depending on the event, Sentry may receive exception messages and stack
traces, route or request URLs, React component-stack details, application
environment, performance trace data, and SDK/browser/runtime context. Events
can also include breadcrumbs describing recent activity. The exact fields
vary by event and by Sentry SDK behavior.

The application sets `sendDefaultPii: false` and does not enable session
replay. This disables Sentry's default PII collection and means the app does
not intentionally attach session recordings. It is not a guarantee that every
possible identifying value is absent from every event.

## Product analytics

Product funnel events are sent as standalone info-level Sentry messages tagged
`source: analytics`; the analytics code does not use a separate analytics
vendor. Tracked event names cover wallet
connection, registration, reward claims, and marketplace purchases:

- `wallet_connect_started`, `wallet_connect_success`,
  `wallet_connect_failed`
- `registration_started`, `registration_success`, `registration_failed`
- `claim_started`, `claim_success`, `claim_failed`
- `marketplace_buy_started`, `marketplace_buy_success`,
  `marketplace_buy_failed`

Depending on the event, properties may include a truncated SHA-256 hash of a
wallet address (`user_hash`), a contract error code, an error message, a bot
tier, or a label. The hash is a pseudonymous, stable identifier for the same
address, not an anonymous or guaranteed-unrecoverable value. Do not treat it
as a substitute for removing identifying data.

Each analytics event is captured as its own Sentry message, so funnels are
recorded even when no error occurs. Events are tagged with `source: analytics`
and `analytics_event`, and their properties are attached as event extras.
Failed-step properties carry only a short, PII-scrubbed error message and the
Soroban contract error code. Analytics events are not sent when analytics is
disabled.

## Scrubbing and limitations

The browser Sentry `beforeSend` hook:

- Replaces matching 56-character Stellar address strings beginning with `G`,
  `C`, or `M` and matching e-mail address strings with `[address]` and
  `[email]` in breadcrumb messages, string-valued breadcrumb data, and the
  request URL.
- Removes the `Referer` request header.

The server-side hook applies the same string replacements to the request URL.
It does not currently scrub server-side breadcrumbs or request headers.
Neither hook recursively scrubs arbitrary event fields such as exception
messages, stack traces, tags, extra data, or non-string breadcrumb values.
These rules are best-effort pattern scrubbing, not a guarantee that event
payloads contain no personal or sensitive information. Avoid placing secrets,
wallet addresses, e-mail addresses, or other sensitive data in errors,
breadcrumbs, or analytics properties.

## Retention

The application does not set a Sentry retention period. Sentry event and
breadcrumb retention follows the retention configuration for the receiving
Sentry project and account; consult that project's settings and Sentry's
current policy for the applicable period. AutoMint does not operate a separate
analytics event store in this implementation.

## Opting out and configuration

Product analytics are opt-in. Set `NEXT_PUBLIC_ANALYTICS_ENABLED=true` to
enable calls to `track()`. Leave it unset or set it to any other value,
including `false`, to disable product analytics. Because this is a public
Next.js environment variable, set it in the frontend build/deployment
environment and rebuild/redeploy for the change to take effect.

This setting disables product analytics only; it does not disable Sentry error
reporting or performance tracing. To stop Sentry reporting, remove or leave
`NEXT_PUBLIC_SENTRY_DSN` unset in the frontend build/deployment environment
and rebuild/redeploy. Product analytics calls are no-ops when disabled even if
a Sentry DSN is configured.

Requests made by the app to Stellar RPC, Horizon, wallet providers, and other
services are separate from Sentry and product analytics. Those services may
process request data under their own policies.

## Related implementation

- [Browser Sentry setup](../frontend/sentry.client.config.ts)
- [Server Sentry setup](../frontend/src/lib/sentry.server.ts)
- [Analytics tracking](../frontend/src/lib/analytics.ts)
