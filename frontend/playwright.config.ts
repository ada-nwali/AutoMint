import { defineConfig, devices } from "@playwright/test";
import type { ReporterDescription } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3000";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const reporter: ReporterDescription[] = process.env.CI
  ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
  : [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]];

// #538 — end-to-end tests that boot the real Next.js app and exercise it
// against the live Soroban testnet. The nightly workflow
// (.github/workflows/e2e-testnet.yml) runs these with real contract IDs;
// locally they run against whatever .env the build picks up.
//
// The server runs via `next dev` (no type-checking) because the branch's
// pre-existing Sentry/stellar type errors block `next build` prod builds.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // When a pre-existing server is supplied via E2E_BASE_URL (e.g. the nightly
  // workflow), target it directly instead of spawning our own.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `npm run dev:e2e`,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      }),
});