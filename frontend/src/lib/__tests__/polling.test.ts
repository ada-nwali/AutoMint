import { pollWhenVisible } from "../polling";
import { DASHBOARD_POLL_MS } from "../queryKeys";

describe("pollWhenVisible (#495)", () => {
  function setHidden(value: boolean) {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => value,
    });
  }

  afterEach(() => {
    // Drop the own property so the jsdom prototype getter (false) is back.
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it("returns the base interval while the tab is visible", () => {
    setHidden(false);
    expect(pollWhenVisible()()).toBe(DASHBOARD_POLL_MS);
    expect(pollWhenVisible(5000)()).toBe(5000);
  });

  it("returns false — pausing the poll — while the tab is hidden", () => {
    setHidden(true);
    expect(pollWhenVisible()()).toBe(false);
    expect(pollWhenVisible(5000)()).toBe(false);
  });
});
