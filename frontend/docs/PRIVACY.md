# AutoMint — Data Collection & Privacy Policy

This document describes every piece of data AutoMint collects, why it is
collected, and the guarantees made about how it is handled.

---

## 1. What we collect

### 1.1 Error reporting (Sentry)

AutoMint integrates [Sentry](https://sentry.io) to capture browser-side
render errors, unhandled promise rejections, and server-side exceptions.

| Data field          | Collected? | Notes |
|---------------------|-----------|-------|
| JavaScript stack trace | ✅ Yes  | Sent as-is from the browser |
| Component tree (React `componentStack`) | ✅ Yes | Attached to render errors only |
| Browser name & version | ✅ Yes | Derived from `User-Agent`; not stored beyond 90 days |
| OS name & version   | ✅ Yes  | Derived from `User-Agent` |
| Page URL at time of error | ✅ Yes | Scrubbed — see §3 |
| Breadcrumbs (recent UI interactions) | ✅ Yes | Scrubbed — see §3 |
| Stellar address / public key | ❌ Never | Removed by `beforeSend` before transmission |
| IP address          | ❌ Never | `sendDefaultPii: false` is set globally |
| User name / e-mail  | ❌ Never | Never attached to Sentry events |
| Session replay      | ❌ Never | Not enabled |

Sentry events are retained for **90 days** by default.

### 1.2 Product analytics

AutoMint tracks a small set of funnel events to understand how users
progress through the core onboarding and claim flows.  Analytics events are
shipped via Sentry breadcrumbs and are subject to the same scrubbing rules
as error events (§3).

| Event                   | Properties recorded |
|-------------------------|---------------------|
| `wallet_connect_started` | `user_hash` (see §2) |
| `wallet_connect_success` | `user_hash` |
| `wallet_connect_failed`  | `user_hash`, `error_message` (scrubbed) |
| `registration_started`  | `user_hash` |
| `registration_success`  | `user_hash` |
| `registration_failed`   | `user_hash`, `error_message`, `contract_error` |
| `claim_started`         | `user_hash` |
| `claim_success`         | `user_hash` |
| `claim_failed`          | `user_hash`, `error_message`, `contract_error` |
| `marketplace_buy_started` | `user_hash`, `bot_tier` |
| `marketplace_buy_success` | `user_hash`, `bot_tier` |
| `marketplace_buy_failed`  | `user_hash`, `error_message`, `contract_error` |

Analytics collection is **disabled by default**.  It is opt-in via the
`NEXT_PUBLIC_ANALYTICS_ENABLED=true` environment variable.  When the
variable is absent or `"false"`, every `track()` call is a no-op and no
data leaves the browser.

---

## 2. Anonymous user identifier (`user_hash`)

To count unique users without storing their Stellar public key, analytics
events attach a `user_hash` — the first 16 hex characters of the
SHA-256 hash of the user's Stellar address, computed in-browser using the
Web Crypto API:

```
user_hash = hex(SHA-256(stellar_address))[0:16]
```

This value:

- **Cannot be reversed** to recover the original address.
- **Is not stored** on any server controlled by AutoMint.
- **Changes** if the user switches to a different Stellar account.

---

## 3. PII scrubbing

The `beforeSend` hook in `src/lib/sentry.client.ts` runs on every Sentry
event before it leaves the browser.  It replaces:

| Pattern                                           | Replacement  |
|---------------------------------------------------|--------------|
| Stellar addresses (`G…`, `C…`, `M…` — 56 chars)  | `[address]`  |
| E-mail addresses                                  | `[email]`    |
| `Referer` HTTP header                             | Removed      |

This scrubbing applies to:
- Breadcrumb messages and data objects
- Request URLs

---

## 4. Third-party services

| Service | Purpose | Privacy policy |
|---------|---------|---------------|
| Sentry  | Error reporting & analytics transport | [sentry.io/privacy](https://sentry.io/privacy/) |
| Stellar Testnet RPC | Blockchain reads & transaction simulation | No personal data transmitted |
| Freighter (browser extension) | Wallet signing — runs entirely client-side | No data sent to AutoMint servers |

---

## 5. Opting out

Set `NEXT_PUBLIC_ANALYTICS_ENABLED` to any value other than `"true"` (or
leave it unset) to disable product analytics entirely.

Error reporting via Sentry can be disabled by removing
`NEXT_PUBLIC_SENTRY_DSN` from your environment.  When the DSN is not set,
Sentry initialises in a no-op mode and no events are transmitted.

---

## 6. Contact

For privacy questions or data-deletion requests, open an issue on the
[AutoMint GitHub repository](https://github.com/Ada-Girly881/AutoMint).
