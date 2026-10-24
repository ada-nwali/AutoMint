/**
 * Root 404 page (#1161). Unknown routes should show the AutoMint fallback with
 * working links back into the app, not Next.js's default 404.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

import NotFound from "../not-found";

describe("root not-found page", () => {
  it("tells the visitor the page does not exist", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
  });

  it("links back to the dashboard and marketplace", () => {
    render(<NotFound />);

    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    expect(screen.getByRole("link", { name: /browse marketplace/i })).toHaveAttribute(
      "href",
      "/marketplace"
    );
  });
});
