import { expect, test } from "@playwright/test";

test.describe("Leaderboard", () => {
  test("renders its header and settles into exactly one data state", async ({ page }) => {
    await page.goto("/leaderboard");

    await expect(
      page.getByRole("heading", { name: /Leaderboard/i, level: 1 }),
    ).toBeVisible();

    // Depending on the live network the board shows skeleton rows, a
    // populated table, an empty state, or a diagnosed error state. The page
    // must settle into exactly one of them.
    await expect(async () => {
      const settled =
        (await page.getByTestId("leaderboard-empty").count()) +
        (await page.getByTestId("leaderboard-error").count()) +
        (await page.getByRole("table").count());
      expect(settled).toBe(1);
    }).toPass({ timeout: 30_000 });
  });
});