/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const { withSentryConfig } = require("@sentry/nextjs");

// Next.js already inlines every NEXT_PUBLIC_* variable at build time. Do not
// copy them into `env` here: doing so turns unset variables into `""`, and
// `process.env.X ?? default` in constants.ts then never sees a nullish value
// (so defaults such as NETWORK="TESTNET" are silently skipped).
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Required for @stellar/stellar-sdk in browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

/**
 * Sentry build-time configuration.
 *
 * Source maps are only uploaded when SENTRY_AUTH_TOKEN is present in the
 * environment (CI builds only).  Local dev builds skip the upload to keep
 * build times fast.
 *
 * See https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */
const sentryConfig = {
  org: process.env.SENTRY_ORG ?? "automint",
  project: process.env.SENTRY_PROJECT ?? "automint-frontend",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Silent in development to avoid noise in terminal output.
  silent: process.env.NODE_ENV !== "production",
  // Upload source maps only in CI where the auth token is available.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Disable the automatic Sentry instrumentation wrapping of API routes to
  // keep bundle size down; we instrument manually via instrumentation.ts.
  autoInstrumentServerFunctions: false,
};

module.exports = withBundleAnalyzer(withSentryConfig(nextConfig, sentryConfig));
