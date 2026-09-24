import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListBotModal from "../ListBotModal";
import type { BotNFT } from "@/types";

const mockListBotMutate = jest.fn();
jest.mock("@/hooks/useMarketplace", () => ({
  useListBot: () => ({
    mutate: mockListBotMutate,
    isPending: false,
  }),
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
  tier: "Basic",
  accrual_rate: 1n,
  minted_at: 1700000000,
  last_claim_timestamp: 1700000000n,
};

describe("ListBotModal (#514, #528)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
