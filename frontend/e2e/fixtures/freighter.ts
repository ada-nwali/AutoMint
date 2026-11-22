/**
 * Mocked Freighter wallet fixture for connected-wallet e2e flows (#1376).
 *
 * Injects a minimal `window.freighter` stub before the page loads so Playwright
 * tests can exercise buy, list, cancel and register flows without a real
 * extension. The stub:
 *   - Reports itself as connected and returns a fixed public key.
 *   - Signs any transaction by appending a deterministic fake signature.
 *   - Accepts any `submitTransaction` call and returns a canned success hash.
 *
 * Usage:
 *   import { test, expect } from "./fixtures/freighter";
 *   // Then use `test` exactly like the standard Playwright test.
 */

import { test as base, expect } from "@playwright/test";

export { expect };

/** A well-formed testnet public key used as the mock wallet address. */
export const MOCK_WALLET_ADDRESS = "GBUKOFF3MTHOMP5BNQQGFQHQEJDAAEPV3IYIIQQDPWC6BFBLBNUAYVVL";

/** The fake transaction hash returned by the stub's submitTransaction. */
export const MOCK_TX_HASH = "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233";

export const test = base.extend({
  page: async ({ page }, use) => {
    // Inject the Freighter stub before any page script runs.
    await page.addInitScript(() => {
      const MOCK_ADDR = "GBUKOFF3MTHOMP5BNQQGFQHQEJDAAEPV3IYIIQQDPWC6BFBLBNUAYVVL";
      const MOCK_HASH = "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233";

      (window as unknown as Record<string, unknown>).freighter = {
        isConnected: () => Promise.resolve({ isConnected: true }),
        getAddress: () => Promise.resolve({ address: MOCK_ADDR }),
        getNetwork: () => Promise.resolve({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" }),
        signTransaction: (xdr: string) =>
          Promise.resolve({ signedTxXdr: xdr + "FAKESIG", signerAddress: MOCK_ADDR }),
        submitTransaction: () =>
          Promise.resolve({ hash: MOCK_HASH, status: "SUCCESS" }),
      };
    });

    await use(page);
  },
});
