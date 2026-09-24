import { expect, test } from "@playwright/test";

test.describe("Dashboard", () => {
  test("disconnected visitors land on the connect prompt, not a broken shell", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: /Connect Your Wallet/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Wallet/i })).toBeVisible();
    await expect(page.getByTestId("dashboard-error-state")).toHaveCount(0);
  });
});