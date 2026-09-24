/**
 * #508 — App Router error boundaries.
 *
 * Every render-time throw used to produce a blank white page with the error
 * only in the console. These tests pin down the three guarantees the fallback
 * has to give: it renders instead of nothing, `reset` recovers the segment
 * without a full reload, and the digest — the only handle support has on a
 * production error — is on screen.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Sentry from "@sentry/nextjs";

import RootError from "../error";
import DashboardError from "../dashboard/error";
import MarketplaceError from "../marketplace/error";
import GlobalError from "../global-error";

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(() => "event-id"),
}));

const mockCapture = Sentry.captureException as jest.MockedFunction<
  typeof Sentry.captureException
>;

function makeError(digest?: string): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error("Cannot convert undefined to a BigInt");
  if (digest) error.digest = digest;
  return error;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each([
  ["root", RootError, "app"],
  ["dashboard", DashboardError, "dashboard"],
  ["marketplace", MarketplaceError, "marketplace"],
] as const)("%s error boundary", (_name, Boundary, boundaryTag) => {
  it("renders a fallback instead of a blank page", () => {
    render(<Boundary error={makeError()} reset={jest.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("displays the digest for support", () => {
    render(<Boundary error={makeError("a1b2c3d4e5")} reset={jest.fn()} />);

    expect(screen.getByTestId("route-error-digest")).toHaveTextContent("a1b2c3d4e5");
  });

  it("omits the digest line when the error carries none", () => {
    render(<Boundary error={makeError()} reset={jest.fn()} />);

    expect(screen.queryByTestId("route-error-digest")).not.toBeInTheDocument();
  });

  it("recovers through reset rather than a page reload", async () => {
    const reset = jest.fn();
    const user = userEvent.setup();

    render(<Boundary error={makeError()} reset={reset} />);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reports the error to the reporter, tagged with the boundary that caught it", () => {
    const error = makeError("digest-1");
    render(<Boundary error={error} reset={jest.fn()} />);

    expect(mockCapture).toHaveBeenCalledWith(error, { tags: { boundary: boundaryTag } });
  });

  it("does not leak the raw message into the fallback", () => {
    render(<Boundary error={makeError("digest-1")} reset={jest.fn()} />);

    expect(
      screen.queryByText(/Cannot convert undefined to a BigInt/),
    ).not.toBeInTheDocument();
  });
});

describe("global error boundary", () => {
  // `global-error.tsx` replaces the root layout when it renders, so it must
  // supply its own <html> and <body>. Testing Library mounts into a <div>,
  // which makes React log a DOM-nesting warning that says nothing about the
  // component under test — the nesting is required by the convention.
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation((...args) => {
      if (typeof args[0] === "string" && args[0].includes("validateDOMNesting")) return;
      // eslint-disable-next-line no-console
      console.warn(...args);
    });
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it("renders a standalone fallback with a reset control and the digest", async () => {
    const reset = jest.fn();
    const user = userEvent.setup();

    render(<GlobalError error={makeError("global-digest")} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("global-digest")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reports the error that escaped the root layout", () => {
    const error = makeError();
    render(<GlobalError error={error} reset={jest.fn()} />);

    expect(mockCapture).toHaveBeenCalledWith(error);
  });
});
