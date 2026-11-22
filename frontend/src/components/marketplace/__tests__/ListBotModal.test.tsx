import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListBotModal from "../ListBotModal";
import type { BotNFT } from "@/types";

const mockListBotMutate = jest.fn();
const mockMarketplaceConfig = {
  admin: "GADMIN",
  botNft: "GBOTNFT",
  feeBps: 250,
  royaltyBps: 0,
};
jest.mock("@/hooks/useMarketplace", () => ({
  useListBot: () => ({
    mutate: mockListBotMutate,
    isPending: false,
  }),
  useMarketplaceConfig: () => ({ data: mockMarketplaceConfig }),
  useTokenDecimals: () => ({ data: 7 }),
  useTokenSymbol: () => ({ data: "XLM" }),
  useMinListingPrice: () => ({ data: mockMinPrice.value }),
}));

const mockMinPrice: { value: bigint | undefined } = { value: undefined };
const mockPause = { listPaused: false };
jest.mock("@/hooks/usePauseStatus", () => ({
  usePauseStatus: () => mockPause,
}));

// Mock modal wrapper to render inline
jest.mock("@/components/ui/Modal", () => {
  return function MockModal({ children, isOpen, title }: any) {
    if (!isOpen) return null;
    return (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
      </div>
    );
  };
});

const MOCK_BOT: BotNFT = {
  id: 1n,
  name: "CyberBot",
  owner: "GABC1234",
  minter: "GABC1234", // seller is the original minter → no creator royalty
  tier: "Basic",
  accrual_rate: 1n,
  minted_at: 1700000000,
  last_claim_timestamp: 1700000000n,
};

describe("ListBotModal (#514, #528)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarketplaceConfig.feeBps = 250;
    mockMarketplaceConfig.royaltyBps = 0;
    mockMinPrice.value = undefined;
    mockPause.listPaused = false;
  });

  it("renders with a visible, programmatically associated label and help text", async () => {
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    const label = await screen.findByLabelText(/Listing Price/i);
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute("type", "text");
    expect(label).toHaveAttribute("aria-required", "true");
    expect(screen.getByText(/Enter price in XLM/i)).toBeInTheDocument();
  });

  it("shows disabled explanation when price is empty", () => {
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    const submitBtn = screen.getByRole("button", { name: /List for Sale/i });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText(/Enter a price to enable listing/i)).toBeInTheDocument();
  });

  it("rejects prices exceeding 7 decimal places and shows inline alert", async () => {
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    const input = screen.getByLabelText(/Listing Price/i);
    await userEvent.type(input, "1.12345678"); // 8 decimals

    expect(input).toHaveAttribute("aria-invalid", "true");
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent(/cannot exceed 7 decimal places/i);
    expect(screen.getByRole("button", { name: /List for Sale/i })).toBeDisabled();
  });

  it("computes live fee breakdown in exact stroops matching contract base units", async () => {
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    const input = screen.getByLabelText(/Listing Price/i);
    await userEvent.type(input, "100");

    expect(screen.getByText(/Marketplace Fee \(2.5%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/-2.5000000 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/You Receive \(97.5%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/97.5000000 XLM/i)).toBeInTheDocument();
  });

  it("uses the on-chain fee_bps instead of the hardcoded 2.5%", async () => {
    mockMarketplaceConfig.feeBps = 500; // set_fee_bps(500) → 5%
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    const input = screen.getByLabelText(/Listing Price/i);
    await userEvent.type(input, "100");

    expect(screen.getByText(/Marketplace Fee \(5%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/-5.0000000 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/You Receive \(95%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/95.0000000 XLM/i)).toBeInTheDocument();
  });

  it("deducts royalty_bps when the seller is not the original minter", async () => {
    mockMarketplaceConfig.feeBps = 250;
    mockMarketplaceConfig.royaltyBps = 500; // 5% creator royalty
    const resoldBot: BotNFT = { ...MOCK_BOT, minter: "GMINTER" };

    render(<ListBotModal bot={resoldBot} isOpen={true} onClose={jest.fn()} />);
    const input = screen.getByLabelText(/Listing Price/i);
    await userEvent.type(input, "100");

    expect(screen.getByText(/Marketplace Fee \(2.5%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Creator Royalty \(5%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/-5.0000000 XLM/i)).toBeInTheDocument();
    // 100 - 2.5 fee - 5 royalty = 92.5
    expect(screen.getByText(/You Receive \(92.5%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/92.5000000 XLM/i)).toBeInTheDocument();
  });

  it("does not deduct royalty when the seller is the original minter", async () => {
    mockMarketplaceConfig.feeBps = 250;
    mockMarketplaceConfig.royaltyBps = 500;

    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);
    const input = screen.getByLabelText(/Listing Price/i);
    await userEvent.type(input, "100");

    expect(screen.queryByText(/Creator Royalty/i)).not.toBeInTheDocument();
    expect(screen.getByText(/You Receive \(97.5%\)/i)).toBeInTheDocument();
  });

  it("submits valid price converted to 10^7 stroops without scale bug", async () => {
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    const input = screen.getByLabelText(/Listing Price/i);
    await userEvent.type(input, "10");

    const submitBtn = screen.getByRole("button", { name: /List for Sale/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // 10 XLM = 100,000,000 stroops (10 * 10^7)
    expect(mockListBotMutate).toHaveBeenCalledWith(
      { botId: 1n, price: 100_000_000n },
      expect.any(Object)
    );
  });

  describe("minimum listing price (#1417)", () => {
    it("rejects a price below get_min_price before the signature prompt", async () => {
      mockMinPrice.value = 50_000_000n; // 5 XLM
      render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

      const input = screen.getByLabelText(/Listing Price/i);
      await userEvent.type(input, "4.9999999");

      expect(screen.getByRole("alert")).toHaveTextContent(
        /Price must be at least 5 XLM \(marketplace minimum\)/i,
      );
      const submitBtn = screen.getByRole("button", { name: /List for Sale/i });
      expect(submitBtn).toBeDisabled();
      fireEvent.click(submitBtn);
      expect(mockListBotMutate).not.toHaveBeenCalled();
    });

    it("accepts a price exactly at the minimum", async () => {
      mockMinPrice.value = 50_000_000n;
      render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

      await userEvent.type(screen.getByLabelText(/Listing Price/i), "5");
      fireEvent.click(screen.getByRole("button", { name: /List for Sale/i }));

      expect(mockListBotMutate).toHaveBeenCalledWith(
        { botId: 1n, price: 50_000_000n },
        expect.any(Object),
      );
    });

    it("shows the minimum in the help text", () => {
      mockMinPrice.value = 40n; // default ceil(10_000 / 250) base units
      render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);
      expect(screen.getByText(/Minimum: 0.000004 XLM/i)).toBeInTheDocument();
    });
  });

  it("disables listing while the marketplace is paused (#1416)", async () => {
    mockPause.listPaused = true;
    render(<ListBotModal bot={MOCK_BOT} isOpen={true} onClose={jest.fn()} />);

    await userEvent.type(screen.getByLabelText(/Listing Price/i), "10");

    expect(screen.getByRole("button", { name: /List for Sale/i })).toBeDisabled();
    expect(screen.getByText(/unavailable while the marketplace is paused/i)).toBeInTheDocument();
  });
});
