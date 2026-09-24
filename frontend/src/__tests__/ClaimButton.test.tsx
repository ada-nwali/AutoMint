import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClaimButton from "../components/dashboard/ClaimButton";
import { useWalletStore } from "../store/walletStore";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe("ClaimButton", () => {
  const mockOnClaim = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useWalletStore.setState({ networkMismatch: false });
  });

  afterEach(() => {
    useWalletStore.setState({ networkMismatch: false });
  });

  it("renders pending points with locale formatting", () => {
    render(<ClaimButton pendingPoints={1500} onClaim={mockOnClaim} isClaiming={false} />);
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.getByText("Pending Points")).toBeInTheDocument();
  });

  it("renders bigint pending points correctly", () => {
    render(<ClaimButton pendingPoints={BigInt(2500)} onClaim={mockOnClaim} isClaiming={false} />);
    expect(screen.getByText("2,500")).toBeInTheDocument();
  });

  it("renders enabled Claim Rewards button when points > 0 and not claiming", () => {
    render(<ClaimButton pendingPoints={100} onClaim={mockOnClaim} isClaiming={false} />);
    const btn = screen.getByRole("button", { name: /Claim Rewards/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute("aria-busy", "false");
  });

  it("disables button when pending points are 0", () => {
    render(<ClaimButton pendingPoints={0} onClaim={mockOnClaim} isClaiming={false} />);
    const btn = screen.getByRole("button", { name: /Claim Rewards/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveClass("cursor-not-allowed");
  });

  it("disables button and shows Claiming text when isClaiming is true", () => {
    render(<ClaimButton pendingPoints={200} onClaim={mockOnClaim} isClaiming={true} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/Claiming/i)).toBeInTheDocument();
  });

  it("disables button when isClaiming is true even with positive points", () => {
    render(<ClaimButton pendingPoints={500} onClaim={mockOnClaim} isClaiming={true} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClaim when enabled button is clicked", async () => {
    const user = userEvent.setup();
    render(<ClaimButton pendingPoints={300} onClaim={mockOnClaim} isClaiming={false} />);
    await user.click(screen.getByRole("button", { name: /Claim Rewards/i }));
    expect(mockOnClaim).toHaveBeenCalledTimes(1);
  });

  it("does not call onClaim when disabled button is clicked", async () => {
    const user = userEvent.setup();
    render(<ClaimButton pendingPoints={0} onClaim={mockOnClaim} isClaiming={false} />);
    await user.click(screen.getByRole("button", { name: /Claim Rewards/i }));
    expect(mockOnClaim).not.toHaveBeenCalled();
  });

  it("handles negative points as disabled", () => {
    render(<ClaimButton pendingPoints={-10} onClaim={mockOnClaim} isClaiming={false} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("displays points aria-live region", () => {
    render(<ClaimButton pendingPoints={42} onClaim={mockOnClaim} isClaiming={false} />);
    const pointsEl = screen.getByText("42");
    expect(pointsEl).toHaveAttribute("aria-live", "polite");
  });

  it("renders Claim Rewards text when not claiming and Coins icon", () => {
    render(<ClaimButton pendingPoints={50} onClaim={mockOnClaim} isClaiming={false} />);
    expect(screen.getByText("Claim Rewards")).toBeInTheDocument();
  });

  describe("network mismatch (#455)", () => {
    it("disables the button and prompts to switch networks", () => {
      useWalletStore.setState({ networkMismatch: true });
      render(<ClaimButton pendingPoints={500} onClaim={mockOnClaim} isClaiming={false} />);
      const btn = screen.getByRole("button", { name: /Switch Network to Claim/i });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute(
        "title",
        expect.stringContaining("switch to Testnet")
      );
    });

    it("does not fire onClaim while the wallet is on the wrong network", async () => {
      useWalletStore.setState({ networkMismatch: true });
      const user = userEvent.setup();
      render(<ClaimButton pendingPoints={500} onClaim={mockOnClaim} isClaiming={false} />);
      await user.click(screen.getByRole("button"));
      expect(mockOnClaim).not.toHaveBeenCalled();
    });

    it("re-enables once the network matches again", () => {
      useWalletStore.setState({ networkMismatch: true });
      const { rerender } = render(
        <ClaimButton pendingPoints={500} onClaim={mockOnClaim} isClaiming={false} />
      );
      expect(screen.getByRole("button")).toBeDisabled();

      useWalletStore.setState({ networkMismatch: false });
      rerender(<ClaimButton pendingPoints={500} onClaim={mockOnClaim} isClaiming={false} />);
      expect(screen.getByRole("button", { name: /Claim Rewards/i })).toBeEnabled();
    });
  });
});
