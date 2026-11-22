import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OffersSection from "../OffersSection";
import type { BotOffer, BotNFT } from "@/types";

const mockAcceptMutate = jest.fn();
const mockDeclineMutate = jest.fn();
const mockIncomingOffers = {
  data: [] as BotOffer[],
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: jest.fn(),
  isRefetching: false,
};

jest.mock("@/hooks/useMarketplace", () => ({
  useIncomingOffers: () => mockIncomingOffers,
  useAcceptOffer: () => ({
    mutate: mockAcceptMutate,
    isPending: false,
  }),
  useDeclineOffer: () => ({
    mutate: mockDeclineMutate,
    isPending: false,
  }),
  useTokenDecimals: () => ({ data: 7 }),
  useTokenSymbol: () => ({ data: "XLM" }),
}));

const mockBot: BotNFT = {
  id: 10n,
  nickname: "MinerPrime",
  owner: "GSELLER",
  tier: "Gold",
  accrual_rate: 100n,
  minted_at: 1700000000,
  last_claim_timestamp: 1700000000n,
};

jest.mock("@/hooks/useBotDetails", () => ({
  useAllBotDetails: () => ({ data: [mockBot] }),
}));

jest.mock("@/hooks/useProfiles", () => ({
  useProfiles: () => ({
    data: {
      GBUYER123: {
        address: "GBUYER123",
        username: "ada_buyer",
        display_name: "Ada Buyer",
      },
    },
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("OffersSection (#1409)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncomingOffers.data = [];
    mockIncomingOffers.isLoading = false;
    mockIncomingOffers.isError = false;
  });

  it("renders empty state when there are no incoming offers", () => {
    mockIncomingOffers.data = [];
    renderWithClient(<OffersSection />);

    expect(screen.getByTestId("incoming-offers-section")).toBeInTheDocument();
    expect(screen.getByTestId("incoming-offers-count")).toHaveTextContent("0");
    expect(screen.getByTestId("offers-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/No incoming offers on your bots at this time/i),
    ).toBeInTheDocument();
  });

  it("renders incoming offers with bot details, buyer name, and price", () => {
    const offer: BotOffer = {
      id: 101n,
      buyer: "GBUYER123",
      bot_id: 10n,
      amount: 75_000_000n,
      currency: "CCURRENCY",
      created_at: BigInt(Math.floor(Date.now() / 1000) - 60),
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 86400),
      status: "Active",
    };
    mockIncomingOffers.data = [offer];

    renderWithClient(<OffersSection />);

    expect(screen.getByTestId("incoming-offers-count")).toHaveTextContent("1");
    expect(screen.getByTestId("offer-card-101")).toBeInTheDocument();
    expect(screen.getByText(/MinerPrime Bot #10/i)).toBeInTheDocument();
    expect(screen.getByText("Ada Buyer")).toBeInTheDocument();
    expect(screen.getByText(/7.5 XLM/i)).toBeInTheDocument();
  });

  it("triggers accept mutation when seller confirms accepting an offer", () => {
    const offer: BotOffer = {
      id: 101n,
      buyer: "GBUYER123",
      bot_id: 10n,
      amount: 75_000_000n,
      currency: "CCURRENCY",
      created_at: BigInt(Math.floor(Date.now() / 1000) - 60),
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 86400),
      status: "Active",
    };
    mockIncomingOffers.data = [offer];

    renderWithClient(<OffersSection />);

    fireEvent.click(screen.getByTestId("accept-offer-btn-101"));

    // Confirmation dialog appears
    expect(screen.getByRole("heading", { name: /Accept Offer/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to accept this offer on Bot #10/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept Offer" }));

    expect(mockAcceptMutate).toHaveBeenCalledWith(101n, expect.any(Object));
  });

  it("triggers decline mutation when seller confirms declining an offer", () => {
    const offer: BotOffer = {
      id: 101n,
      buyer: "GBUYER123",
      bot_id: 10n,
      amount: 75_000_000n,
      currency: "CCURRENCY",
      created_at: BigInt(Math.floor(Date.now() / 1000) - 60),
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 86400),
      status: "Active",
    };
    mockIncomingOffers.data = [offer];

    renderWithClient(<OffersSection />);

    fireEvent.click(screen.getByTestId("decline-offer-btn-101"));

    // Confirmation dialog appears
    expect(screen.getByRole("heading", { name: /Decline Offer/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to decline this offer on Bot #10/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Decline Offer" }));

    expect(mockDeclineMutate).toHaveBeenCalledWith(101n, expect.any(Object));
  });
});

