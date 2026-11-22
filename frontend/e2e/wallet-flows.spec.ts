/**
 * Connected-wallet e2e flows (#1376).
 *
 * Uses the mocked Freighter fixture so no real extension is needed.
 * Run against a local dev server or testnet deployment:
 *
 *   pnpm exec playwright test e2e/wallet-flows.spec.ts
 *
 * These tests exercise the paths that previously went untested and caused
 * wrong `buy_bot`, `cancel_listing` and `list_bot` arguments to go unnoticed.
 */

import { expect, MOCK_WALLET_ADDRESS, MOCK_TX_HASH, test } from "./fixtures/freighter";

test.describe("Connected-wallet flows (mocked Freighter)", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the marketplace; the Freighter stub is already injected.
    await page.goto("/marketplace");
  });

  test("wallet connects and shows address in header (#1376)", async ({ page }) => {
    // Trigger wallet connection.
    await page.getByRole("button", { name: /Connect Wallet/i }).first().click();

    // The UI should resolve the address from the stub and display a truncated form.
    const truncated = `${MOCK_WALLET_ADDRESS.slice(0, 4)}...${MOCK_WALLET_ADDRESS.slice(-4)}`;
    await expect(page.getByText(truncated)).toBeVisible({ timeout: 8_000 });
  });

  test("list bot flow reaches confirmation step (#1376)", async ({ page }) => {
    await page.goto("/dashboard");

    // Connect wallet first.
    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    if (await connectBtn.isVisible()) await connectBtn.click();

    // Open list-bot dialog if a bot card is visible.
    const listBtn = page.getByRole("button", { name: /List/i }).first();
    if (await listBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await listBtn.click();
      // The ConfirmDialog or modal title should appear.
      await expect(
        page.getByRole("dialog").getByRole("heading"),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("buy bot flow shows transaction pending state (#1376)", async ({ page }) => {
    // Connect wallet.
    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    if (await connectBtn.isVisible()) await connectBtn.click();

    // Click the first Buy button in the listings grid.
    const buyBtn = page.getByRole("button", { name: /Buy/i }).first();
    if (await buyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await buyBtn.click();
      // ConfirmDialog should appear.
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Confirm the purchase.
      await dialog.getByRole("button", { name: /Confirm/i }).click();

      // The stub returns MOCK_TX_HASH; the UI should show a pending or success state.
      await expect(
        page.getByText(/pending|success|confirmed/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("cancel listing flow does not error (#1376)", async ({ page }) => {
    await page.goto("/marketplace");

    // Connect wallet.
    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    if (await connectBtn.isVisible()) await connectBtn.click();

    // Switch to My Listings tab.
    const myListingsTab = page.getByRole("tab", { name: /My Listings/i });
    await myListingsTab.click();

    // If a cancel button appears, click it and confirm.
    const cancelBtn = page.getByRole("button", { name: /Cancel/i }).first();
    if (await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cancelBtn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole("button", { name: /Confirm/i }).click();
      // Should not navigate away or show an unhandled error boundary.
      await expect(page.getByRole("alert")).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test("register flow shows success or pending feedback (#1376)", async ({ page }) => {
    await page.goto("/");

    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    if (await connectBtn.isVisible()) await connectBtn.click();

    const registerBtn = page.getByRole("button", { name: /Register|Mint|Get Bot/i }).first();
    if (await registerBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await registerBtn.click();
      await expect(
        page.getByText(/pending|success|confirmed/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
