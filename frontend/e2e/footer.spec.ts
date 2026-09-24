import { expect, test } from "@playwright/test";

test.describe("Footer links (#524)", () => {
  const EXPECTED_LINKS = [
    "Dashboard",
    "Marketplace",
    "Leaderboard",
    "Project Docs",
    "Deployment Guide",
    "Stellar Testnet Explorer",
    "Soroban Docs",
    "Apache-2.0",
    "GitHub",
  ];

  test("every footer link is present and points to a real route, never a placeholder", async ({
    page,
  }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");

    for (const label of EXPECTED_LINKS) {
      await expect(footer.getByRole("link", { name: new RegExp(label, "i") })).toBeVisible();
    }

    // #524 — no placeholder (href="#") links anywhere in the footer.
    const rawHrefs = await footer.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute("href")),
    );
    const hrefs = rawHrefs.filter((href): href is string => href !== null);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, "anchor must not link to '#'").not.toBe("#");
      expect(href, "anchor must not have an empty href").not.toBe("");
      // Internal in-app routes use absolute paths; everything else is a full URL.
      expect(href.startsWith("/") || /^https?:\/\//.test(href)).toBe(true);
    }

    // Exact href targets, the network badge and the "built on" links are
    // pinned in the Footer Jest suite (#524). Resolving every external URL
    // from a CI runner is inherently flaky (GitHub rate limits, network
    // egress), so we only assert real in-browser rendering here.
    await expect(footer.getByText(/AutoMint/).first()).toBeVisible();
    await expect(
      footer.getByRole("link", { name: /^Stellar \(opens in new tab\)$/ }),
    ).toBeVisible();
    await expect(
      footer.getByRole("link", { name: /^Soroban \(opens in new tab\)$/ }),
    ).toBeVisible();
  });
});