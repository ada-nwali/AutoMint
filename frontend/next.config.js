/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const { withSentryConfig } = require("@sentry/nextjs");

const publicEnv = [
  "NEXT_PUBLIC_NETWORK",
  "NEXT_PUBLIC_SOROBAN_RPC_URL",
  "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  "NEXT_PUBLIC_REGISTRY_CONTRACT_ID",
  "NEXT_PUBLIC_BOT_NFT_CONTRACT_ID",
  "NEXT_PUBLIC_ACCRUAL_CONTRACT_ID",
  "NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID",
  "NEXT_PUBLIC_TOKEN_CONTRACT_ID",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_ANALYTICS_ENABLED",
].reduce((env, key) => {
  env[key] = process.env[key] ?? "";
  return env;
}, {});

const nextConfig = {
  reactStrictMode: true,
  env: publicEnv,
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
