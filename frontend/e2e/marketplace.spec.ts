import { expect, test } from "@playwright/test";

test.describe("Marketplace", () => {
  test("shell renders with tabs, filters, connect banner and no dead links", async ({ page }) => {
    await page.goto("/marketplace");

    await expect(
      page.getByRole("heading", { name: /Marketplace/i, level: 1 }).first(),
    ).toBeVisible();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByRole("tab", { name: /All Listings/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /My Listings/i })).toBeVisible();

    // Filters render regardless of the network state.
    await expect(page.getByTestId("marketplace-filters")).toBeVisible();

    // Listings stay visible for disconnected visitors (#499) alongside the
    // connect banner. The grid may be loading, populated, empty or in an
    // error state depending on the live network — assert the shell always
    // renders and never dead-links.
    await expect(page.getByTestId("marketplace-connect-banner")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Connect Wallet/i }).first(),
    ).toBeVisible();

    // #524 — no placeholder (href="#") or missing links anywhere on the page.
    for (const href of await page.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute("href")),
    )) {
      expect(href, "anchor must not link to '#'").not.toBe("#");
      expect(href, "anchor must not be empty").not.toBe("");
    }
  });

  test("tier and price filter chips toggle their pressed state", async ({ page }) => {
    await page.goto("/marketplace");

    // Chip toggling must work regardless of the underlying network/data state.
    const goldChip = page.getByRole("button", { name: /Gold/i, exact: true });
    await goldChip.click();
    await expect(goldChip).toHaveAttribute("aria-pressed", "true");

    const over1000 = page.getByRole("button", { name: /over 1,000 xlm/i });
    await over1000.click();
    await expect(over1000).toHaveAttribute("aria-pressed", "true");

    // Clicking a selected chip toggles it back off.
    await goldChip.click();
    await expect(goldChip).toHaveAttribute("aria-pressed", "false");
  });
});