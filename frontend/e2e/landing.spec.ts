import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders the hero and the primary CTA navigates to the dashboard", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/AutoMint/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    const getStarted = page.getByRole("link", { name: /Get Started/i }).first();
    await expect(getStarted).toHaveAttribute("href", "/dashboard");
    await getStarted.click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    // Disconnected visitors land on the connect prompt.
    await expect(page.getByRole("heading", { name: /Connect Your Wallet/i })).toBeVisible();
  });
});