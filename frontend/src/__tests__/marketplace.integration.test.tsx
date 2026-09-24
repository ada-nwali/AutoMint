/**
 * Integration test for the Marketplace page (#499).
 *
 * Covers the acceptance criteria end-to-end at the component level:
 *   1. A disconnected visitor still sees active listings (with connect banner)
 *   2. Loading, error + retry, and empty states
 *   3. Tier / price filters and price sorting
 *   4. Buying a bot calls the buy mutation
 *   5. My Listings — connect prompt, owned-bots list-for-sale flow, cancel
 *
 * All wallet/contract hooks are mocked so no network calls are made.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { BotNFT, MarketplaceListing } from "@/types";

// ---------------------------------------------------------------------------
// Mock Zustand wallet store
// ---------------------------------------------------------------------------
const mockWalletStore = {
  publicKey: null as string | null,
  setConnecting: jest.fn(),
};

jest.mock("@/store/walletStore", () => ({
  ...jest.requireActual("@/store/walletStore"),
  useWalletStore: Object.assign(
    jest.fn((selector: (s: typeof mockWalletStore) => unknown) => selector(mockWalletStore)),
    { getState: () => mockWalletStore },
  ),
}));

// ---------------------------------------------------------------------------
// Mock marketplace hooks
// ---------------------------------------------------------------------------
const mockMarketplace = {
  allListings: [] as MarketplaceListing[],
  allLoading: false,
  allError: null as Error | null,
  allRefetching: false,
  listingsRefetch: jest.fn(),
  myListings: [] as MarketplaceListing[],
  myLoading: false,
  myError: null as Error | null,
  myRefetching: false,
  myListingsRefetch: jest.fn(),
  buyMutate: jest.fn(),
  cancelMutate: jest.fn(),
};

jest.mock("@/hooks/useMarketplace", () => ({
  useListings: () => ({
    data: mockMarketplace.allListings,
    isLoading: mockMarketplace.allLoading,
    isError: !!mockMarketplace.allError,
    error: mockMarketplace.allError,
    refetch: mockMarketplace.listingsRefetch,
    isRefetching: mockMarketplace.allRefetching,
  }),
  useMyListings: () => ({
    data: mockMarketplace.myListings,
    isLoading: mockMarketplace.myLoading,
    isError: !!mockMarketplace.myError,
    error: mockMarketplace.myError,
    refetch: mockMarketplace.myListingsRefetch,
    isRefetching: mockMarketplace.myRefetching,
  }),
  useBuyBot: () => ({ mutate: mockMarketplace.buyMutate, isPending: false }),
  useCancelListing: () => ({ mutate: mockMarketplace.cancelMutate, isPending: false }),
  useListBot: () => ({ mutate: jest.fn(), isPending: false }),
}));

// ---------------------------------------------------------------------------
// Mock accrual / bot-detail hooks
// ---------------------------------------------------------------------------
const mockBots = {
  botIds: [] as bigint[],
};

jest.mock("@/hooks/useAccrual", () => ({
  useBots: () => ({ data: mockBots.botIds }),
}));

const mockBotDetails = {
  bots: [] as BotNFT[],
};

jest.mock("@/hooks/useBotDetails", () => ({
  useAllBotDetails: () => ({ data: mockBotDetails.bots }),
}));

// ---------------------------------------------------------------------------
// Mock the modal wrapper so ListBotModal renders inline
// ---------------------------------------------------------------------------
jest.mock("@/components/ui/Modal", () => {
  return function MockModal({ children, isOpen, title, onClose }: any) {
    if (!isOpen) return null;
    return (
      <div data-testid="modal">
        <div className="flex items-start justify-between">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>
        {children}
      </div>
    );
  };
});

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import MarketplacePage from "@/app/marketplace/page";

const WALLET = "GABC1234TESTWALLETADDRESSXYZ";

const GOLD_BOT: BotNFT = {
  id: 1n,
  name: "Goldie",
  owner: WALLET,
  tier: "Gold",
  accrual_rate: 100n,
  minted_at: 1_700_000_000,
  last_claim_timestamp: 1_700_000_000n,
};

const BASIC_BOT: BotNFT = {
  id: 2n,
  name: "Sparky",
  owner: "GOTHER99999999999999999999999999",
  tier: "Basic",
  accrual_rate: 1n,
  minted_at: 1_700_000_000,
  last_claim_timestamp: 1_700_000_000n,
};

const GOLD_LISTING: MarketplaceListing = {
  id: 10n,
  seller: "GOTHER99999999999999999999999999",
  bot_id: 1n,
  price: 5_000_000_000n, // 500 XLM
  listed_at: 1n,
};

const BASIC_LISTING: MarketplaceListing = {
  id: 11n,
  seller: "GOTHER88888888888888888888888888",
  bot_id: 2n,
  price: 100_000_000n, // 10 XLM
  listed_at: 2n,
};

describe("Marketplace Page Integration (#499)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletStore.publicKey = null;
    mockMarketplace.allListings = [];
    mockMarketplace.allLoading = false;
    mockMarketplace.allError = null;
    mockMarketplace.allRefetching = false;
    mockMarketplace.myListings = [];
    mockMarketplace.myLoading = false;
    mockMarketplace.myError = null;
    mockMarketplace.myRefetching = false;
    mockBots.botIds = [];
    mockBotDetails.bots = [];
  });

  it("renders header, tabs, and active listings for a disconnected visitor", () => {
    mockMarketplace.allListings = [GOLD_LISTING, BASIC_LISTING];
    mockBotDetails.bots = [GOLD_BOT, BASIC_BOT];

    render(<MarketplacePage />);

    expect(screen.getByRole("heading", { name: "Marketplace" })).toBeInTheDocument();
    expect(screen.getByTestId("marketplace-connect-banner")).toBeInTheDocument();

    // Listings render with tier, price, and seller even without a wallet.
    expect(screen.getByTestId("listing-card-10")).toBeInTheDocument();
    expect(screen.getByTestId("listing-card-11")).toBeInTheDocument();
    expect(screen.getByText("Gold tier")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === "500 XLM")).toBeInTheDocument();
    expect(screen.getByText("Basic tier")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === "10 XLM")).toBeInTheDocument();

    // A disconnected visitor has no way to buy yet.
    expect(screen.getByTestId("buy-btn-10")).toBeDisabled();
  });

  it("calls setConnecting when the banner connect button is clicked", () => {
    mockMarketplace.allListings = [GOLD_LISTING];

    render(<MarketplacePage />);

    fireEvent.click(
      within(screen.getByTestId("marketplace-connect-banner")).getByRole("button", {
        name: /Connect Wallet/i,
      }),
    );
    expect(mockWalletStore.setConnecting).toHaveBeenCalledTimes(1);
  });

  it("shows skeleton cards while listings are loading", () => {
    mockMarketplace.allLoading = true;
    mockMarketplace.allListings = [];

    render(<MarketplacePage />);

    expect(screen.getAllByText("Loading...").length).toBeGreaterThanOrEqual(6);
  });

  it("shows the error state and retries when listings fail", () => {
    mockMarketplace.allError = new Error("RPC down");

    render(<MarketplacePage />);

    expect(screen.getByTestId("marketplace-error-state")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Failed to Load Marketplace/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(mockMarketplace.listingsRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no listings", () => {
    mockMarketplace.allListings = [];

    render(<MarketplacePage />);

    expect(screen.getByTestId("marketplace-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/No active listings right now/i),
    ).toBeInTheDocument();
  });

  it("filters listings by tier", () => {
    mockMarketplace.allListings = [GOLD_LISTING, BASIC_LISTING];
    mockBotDetails.bots = [GOLD_BOT, BASIC_BOT];

    render(<MarketplacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Gold" }));

    expect(screen.getByTestId("listing-card-10")).toBeInTheDocument();
    expect(screen.queryByTestId("listing-card-11")).not.toBeInTheDocument();
  });

  it("filters listings by price range and clears filters", () => {
    mockMarketplace.allListings = [GOLD_LISTING, BASIC_LISTING];
    mockBotDetails.bots = [GOLD_BOT, BASIC_BOT];

    render(<MarketplacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Under 100 XLM" }));

    expect(screen.queryByTestId("listing-card-10")).not.toBeInTheDocument();
    expect(screen.getByTestId("listing-card-11")).toBeInTheDocument();

    // Combining price + tier filters that match nothing shows the filtered
    // empty state; clearing the filters restores the full grid.
    fireEvent.click(screen.getByRole("button", { name: "Gold" }));
    expect(screen.getByTestId("marketplace-empty-filtered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("listing-card-10")).toBeInTheDocument();
    expect(screen.getByTestId("listing-card-11")).toBeInTheDocument();
  });

  it("sorts listings by price", () => {
    mockMarketplace.allListings = [GOLD_LISTING, BASIC_LISTING];
    mockBotDetails.bots = [GOLD_BOT, BASIC_BOT];

    render(<MarketplacePage />);

    fireEvent.change(screen.getByRole("combobox", { name: /Sort listings/i }), {
      target: { value: "priceAsc" },
    });

    const grid = screen.getByTestId("marketplace-grid");
    const ids = Array.from(grid.querySelectorAll("[data-testid^='listing-card-']")).map(
      (el) => el.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["listing-card-11", "listing-card-10"]);
  });

  it("buys a bot through the buy mutation with the listing id", () => {
    mockWalletStore.publicKey = WALLET;
    mockMarketplace.allListings = [GOLD_LISTING];
    mockBotDetails.bots = [GOLD_BOT];

    render(<MarketplacePage />);

    // Buy opens a confirmation dialog; confirming is what fires the mutation.
    fireEvent.click(screen.getByTestId("buy-btn-10"));
    fireEvent.click(screen.getByRole("button", { name: "Buy" }));

    expect(mockMarketplace.buyMutate).toHaveBeenCalledWith(10n, expect.any(Object));
  });

  it("prompts to connect when My Listings is opened unconnected", () => {
    render(<MarketplacePage />);

    fireEvent.click(screen.getByRole("tab", { name: /My Listings/i }));

    expect(screen.getByTestId("marketplace-mine-connect")).toBeInTheDocument();
    expect(screen.getByText(/list your bots and manage active listings/i)).toBeInTheDocument();
  });

  it("shows owned bots, active listings, and cancels a listing", () => {
    mockWalletStore.publicKey = WALLET;
    const mine = { ...GOLD_LISTING, seller: WALLET, id: 20n };
    mockMarketplace.myListings = [mine];
    mockBots.botIds = [1n, 2n];
    mockBotDetails.bots = [GOLD_BOT, BASIC_BOT];

    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole("tab", { name: /My Listings/i }));

    // Owned bots grid — the listed one is excluded, the other can be listed.
    const ownedGrid = screen.getByTestId("marketplace-owned-grid");
    expect(ownedGrid).toBeInTheDocument();
    expect(within(ownedGrid).getByText("Sparky")).toBeInTheDocument();
    expect(within(ownedGrid).queryByText("Goldie")).not.toBeInTheDocument();
    expect(within(ownedGrid).getAllByRole("button", { name: /List for Sale/i })).toHaveLength(1);

    // Active listing by the user renders with a cancel button.
    expect(screen.getByTestId("marketplace-mine-grid")).toBeInTheDocument();
    // Cancel also goes through a confirmation dialog first.
    fireEvent.click(screen.getByTestId("cancel-btn-20"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockMarketplace.cancelMutate).toHaveBeenCalledWith(20n, expect.any(Object));
  });

  it("opens the ListBotModal flow for an owned bot", async () => {
    mockWalletStore.publicKey = WALLET;
    mockBots.botIds = [2n];
    mockBotDetails.bots = [BASIC_BOT];
    mockMarketplace.myListings = [];

    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole("tab", { name: /My Listings/i }));

    fireEvent.click(screen.getByRole("button", { name: /List for Sale/i }));

    const title = await screen.findByText(/Sparky for Sale/i);
    expect(title).toBeInTheDocument();
    expect(screen.getByLabelText(/Listing Price/i)).toBeInTheDocument();

    // Closing the modal clears the selected bot.
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    await waitFor(() => expect(screen.queryByText(/Sparky for Sale/i)).not.toBeInTheDocument());
  });

  it("shows the no-owned-bots state when the user has none to list", () => {
    mockWalletStore.publicKey = WALLET;
    mockMarketplace.myListings = [];
    mockBots.botIds = [];
    mockBotDetails.bots = [];

    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole("tab", { name: /My Listings/i }));

    expect(screen.getByTestId("marketplace-no-owned")).toBeInTheDocument();
    expect(screen.getByTestId("marketplace-mine-empty")).toBeInTheDocument();
  });

  it("shows an error state for my-listings fetch failures", () => {
    mockWalletStore.publicKey = WALLET;
    mockMarketplace.myError = new Error("boom");
    mockBots.botIds = [];

    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole("tab", { name: /My Listings/i }));

    expect(screen.getByTestId("marketplace-mine-error-state")).toBeInTheDocument();
  });
});