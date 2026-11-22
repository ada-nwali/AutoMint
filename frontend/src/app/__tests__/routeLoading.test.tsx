/**
 * #1353 — route-level loading boundaries.
 *
 * Each `loading.tsx` streams a static skeleton while its segment suspends. It
 * must announce itself to assistive tech and must not depend on providers or
 * data hooks, because Next.js renders it outside the page's query lifecycle.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

import DashboardLoading from "../dashboard/loading";
import LeaderboardLoading from "../leaderboard/loading";
import ProfileLoading from "../profile/loading";

describe.each([
  ["dashboard", DashboardLoading],
  ["leaderboard", LeaderboardLoading],
  ["profile", ProfileLoading],
] as const)("%s loading boundary", (name, Loading) => {
  it("renders without any provider mounted", () => {
    expect(() => render(<Loading />)).not.toThrow();
  });

  it("announces a busy status labelled for the route", () => {
    render(<Loading />);

    const status = screen.getByRole("status", { name: new RegExp(`loading ${name}`, "i") });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(new RegExp(`loading ${name}\\.\\.\\.`, "i"))).toHaveClass("sr-only");
  });

  it("renders skeleton placeholders rather than content", () => {
    const { container } = render(<Loading />);

    expect(container.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(3);
  });
});
