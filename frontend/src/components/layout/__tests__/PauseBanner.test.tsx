import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom";

jest.mock("@/lib/contracts", () => ({
  isMarketplacePaused: jest.fn(),
  isTokenPaused: jest.fn(),
}));

import { isMarketplacePaused, isTokenPaused } from "@/lib/contracts";
import PauseBanner from "../PauseBanner";

const mockMarketplacePaused = isMarketplacePaused as jest.Mock;
const mockTokenPaused = isTokenPaused as jest.Mock;

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PauseBanner />
    </QueryClientProvider>,
  );
}

describe("PauseBanner (#1416)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders nothing when neither contract is paused", async () => {
    mockMarketplacePaused.mockResolvedValue(false);
    mockTokenPaused.mockResolvedValue(false);
    renderBanner();
    await waitFor(() => expect(mockTokenPaused).toHaveBeenCalled());
    expect(screen.queryByTestId("pause-banner")).not.toBeInTheDocument();
  });

  it("warns that buying and listing are unavailable when the marketplace is paused", async () => {
    mockMarketplacePaused.mockResolvedValue(true);
    mockTokenPaused.mockResolvedValue(false);
    renderBanner();
    expect(await screen.findByTestId("pause-banner")).toHaveTextContent(
      /marketplace is temporarily paused/i,
    );
  });

  it("warns that claims and paid mints are unavailable when the token is paused", async () => {
    mockMarketplacePaused.mockResolvedValue(false);
    mockTokenPaused.mockResolvedValue(true);
    renderBanner();
    const banner = await screen.findByTestId("pause-banner");
    expect(banner).toHaveTextContent(/AMT token is temporarily paused/i);
    expect(banner).toHaveTextContent(/claiming rewards/i);
  });

  it("names both when both are paused", async () => {
    mockMarketplacePaused.mockResolvedValue(true);
    mockTokenPaused.mockResolvedValue(true);
    renderBanner();
    expect(await screen.findByTestId("pause-banner")).toHaveTextContent(
      /marketplace and the AMT token/i,
    );
  });

  it("does not show a banner when one flag cannot be read", async () => {
    mockMarketplacePaused.mockRejectedValue(new Error("rpc down"));
    mockTokenPaused.mockResolvedValue(false);
    renderBanner();
    await waitFor(() => expect(mockTokenPaused).toHaveBeenCalled());
    expect(screen.queryByTestId("pause-banner")).not.toBeInTheDocument();
  });
});
