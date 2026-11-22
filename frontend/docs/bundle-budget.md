# Frontend performance budget

## Why

The landing page (`/`) is the first thing every visitor loads, before they
have connected a wallet or decided to use the app. It should stay light —
it does not need `@stellar/stellar-sdk` (used for building/simulating
Soroban transactions) since it only links out to `/dashboard`,
`/marketplace`, etc. Wallet connection on the landing page itself uses the
much smaller `@stellar/freighter-api` package instead.

Pages that do need on-chain reads/writes (`/dashboard`, `/marketplace`,
`/profile`) pull in `@stellar/stellar-sdk` through `src/lib/contracts.ts`
and `src/lib/stellar.ts`, and are expected to be heavier. The budget below
applies only to the landing page's First Load JS.

## Budget

**250 KB gzipped** First Load JS for the `/` route.

## Baseline (recorded 2026-08-28, Next.js 14.2.35)

Measured with `npm run build` on this branch, gzip size of every JS chunk
`next build` attributes to the `/` route (from `.next/app-build-manifest.json`):

| Route          | First Load JS (next build report) | Gzipped JS payload (budget check) |
| -------------- | ---------------------------------- | ---------------------------------- |
| `/` (landing)  | 135 kB                             | ~132 KB                            |
| `/dashboard`   | 376 kB                             | n/a (not budgeted — needs SDK)     |
| `/marketplace` | 362 kB                             | n/a (not budgeted — needs SDK)     |
| `/profile`     | 327 kB                             | n/a (not budgeted — needs SDK)     |
| `/leaderboard` | 326 kB                             | n/a (not budgeted — needs SDK)     |

The landing page currently has ~118 KB of headroom under the 250 KB budget.

Note: `/leaderboard` and `/profile` are also above the SDK-free baseline
even though they don't render wallet UI directly — this is because
`Header` (shared layout, present on every route including `/`) only pulls
in `@stellar/freighter-api`, not `stellar-sdk`, so `/` stays light while
routes that individually import `@/lib/contracts` (dashboard, marketplace)
or `@/hooks/useLeaderboard` / `@/hooks/useBotDetails` (which also import
`@/lib/contracts`) pick up the SDK. Only `/` is gated by CI today; the
other routes are candidates for follow-up code-splitting work (e.g.
`next/dynamic` for the leaderboard table) but are out of scope for this
change.

## How the check works

`frontend/scripts/check-bundle-size.js`:

1. Reads `.next/app-build-manifest.json` (written by `next build`) for the
   configured route (default `/`).
2. Gzips each JS chunk attributed to that route on disk and sums the size.
3. Fails (non-zero exit) if the total exceeds the budget (default 250 KB,
   override with `--budget=<kb>`).

Run it locally after a build:

```bash
cd frontend
npm run build
node scripts/check-bundle-size.js
```

## Bundle analyzer

To inspect what's actually inside each route's bundle:

```bash
cd frontend
ANALYZE=true npm run build
```

This opens the `@next/bundle-analyzer` treemap for both the client and
server bundles.

## CI

`.github/workflows/frontend-bundle-budget.yml` runs `npm run build` and
`node scripts/check-bundle-size.js` on every PR that touches `frontend/`,
failing the check if the landing page exceeds budget.
