import { expect, test } from "@playwright/test";

// Run with NEXT_PUBLIC_SENTRY_DSN=https://public@sentry.invalid/1 and valid
// local contract IDs. The envelope is intercepted, so no Sentry service or
// credentials are needed to verify the real browser SDK and beforeSend hook.
test("browser errors reach the Sentry transport with scrubbed request data", async ({ page }) => {
  test.skip(!process.env.NEXT_PUBLIC_SENTRY_DSN, "Requires a Sentry DSN at build/start time");
  const marker = "automint-browser-sentry-smoke";
  const address = `G${"A".repeat(55)}`;
  const envelopes: string[] = [];
  await page.route(/\/api\/\d+\/envelope\//, async (route) => {
    envelopes.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`/?account=${address}&email=person@example.com`);
  await page.evaluate((message) => {
    setTimeout(() => {
      throw new Error(message);
    }, 0);
  }, marker);
  await expect.poll(() => envelopes.some((body) => body.includes(marker))).toBe(true);
  const envelope = envelopes.find((body) => body.includes(marker))!;
  const event = JSON.parse(envelope.split("\n")[2]!);
  expect(event.exception.values[0].value).toBe(marker);
  expect(event.request.url).toContain("[address]");
  expect(event.request.url).toContain("[email]");
  expect(event.request.url).not.toContain(address);
  expect(event.request.url).not.toContain("person@example.com");
});
