import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "../ErrorState";

describe("ErrorState Component (#513)", () => {
  it("renders with default error message and title", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Unable to Load Data")).toBeInTheDocument();
    expect(screen.getByText(/An unexpected error occurred/i)).toBeInTheDocument();
  });

  it("classifies network errors and shows network diagnostic info", () => {
    render(<ErrorState error={new Error("Failed to fetch from Soroban RPC")} />);
    expect(screen.getByText("Network Connection Error")).toBeInTheDocument();
    expect(screen.getByText(/Unable to reach the Stellar Soroban RPC network/i)).toBeInTheDocument();
  });

  it("calls onRetry callback when Try Again button is clicked without page reload", () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);

    const retryBtn = screen.getByRole("button", { name: /Try Again/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows spinning retry indicator while retrying", () => {
    render(<ErrorState onRetry={jest.fn()} isRetrying={true} />);
    const retryBtn = screen.getByRole("button", { name: /Retrying/i });
    expect(retryBtn).toBeDisabled();
    expect(retryBtn).toHaveAttribute("aria-busy", "true");
  });

  it("renders support link with security attributes", () => {
    render(<ErrorState supportLink="https://github.com/Ada-Girly881/AutoMint/issues" />);
    const link = screen.getByRole("link", { name: /Get Support/i });
    expect(link).toHaveAttribute("href", "https://github.com/Ada-Girly881/AutoMint/issues");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
