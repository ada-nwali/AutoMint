import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import type { BotTier } from "@/types";

const mockUncapped = BigInt("18446744073709551615");
const AMT = 10_000_000n; // 1 AMT at 7 decimals

jest.mock("framer-motion", () => ({
  motion: {
    section: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, transition: _t, ...rest } = props;
      return <section {...(rest as React.HTMLAttributes<HTMLElement>)}>{children}</section>;
    },
  },
}));

jest.mock("@/components/ui/Modal", () => {
  return function MockModal({
    children,
    isOpen,
    title,
    description,
  }: React.PropsWithChildren<{ isOpen: boolean; title?: string; description?: string }>) {
    if (!isOpen) return null;
    return (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    );
  };
});

jest.mock("@/lib/contracts", () => ({
  TIER_UNCAPPED: BigInt("18446744073709551615"),
}));

const mockTiers = {
  Basic: { tier: "Basic", name: "Basic Bot", rate: 1n, price: 0n },
  Bronze: { tier: "Bronze", name: "Bronze Bot", rate: 5n, price: 500n * AMT },
  Silver: { tier: "Silver", name: "Silver Bot", rate: 25n, price: 2000n * AMT },
  Gold: { tier: "Gold", name: "Gold Bot", rate: 100n, price: 7500n * AMT },
  Diamond: { tier: "Diamond", name: "Diamond Bot", rate: 500n, price: 25000n * AMT },
};
jest.mock("@/hooks/useTiers", () => ({
  useTiers: () => ({ data: mockTiers, isPending: false, isError: false }),
}));

const mockState = {
  balance: (1000n * AMT) as bigint | undefined,
  remaining: {} as Partial<Record<BotTier, bigint>>,
  mintPaused: false,
};
jest.mock("@/hooks/useAccrual", () => ({
  useAmtBalance: () => ({ data: mockState.balance }),
  useAmtDecimals: () => ({ data: 7 }),
}));

const mockMintMutate = jest.fn();
jest.mock("@/hooks/useMarketplace", () => ({
  useMintTierBot: () => ({ mutate: mockMintMutate, isPending: false }),
  useTierRemaining: (tier: BotTier) => ({
    data: mockState.remaining[tier] ?? mockUncapped,
    isPending: false,
  }),
}));

jest.mock("@/hooks/usePauseStatus", () => ({
  usePauseStatus: () => ({ mintPaused: mockState.mintPaused }),
}));

jest.mock("@/store/walletStore", () => ({
  useWalletStore: (selector: (s: { networkMismatch: boolean }) => unknown) =>
    selector({ networkMismatch: false }),
  selectNetworkMismatch: (s: { networkMismatch: boolean }) => s.networkMismatch,
}));

import TierShop from "../TierShop";

function offer(tier: BotTier) {
  return within(screen.getByTestId(`tier-offer-${tier}`));
}

describe("TierShop (#1418)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.balance = 1000n * AMT;
    mockState.remaining = {};
    mockState.mintPaused = false;
  });

  it("lists every paid tier with its on-chain price, but not the free Basic bot", () => {
    render(<TierShop />);
    expect(screen.queryByTestId("tier-offer-Basic")).not.toBeInTheDocument();
    expect(offer("Bronze").getByText("500 AMT")).toBeInTheDocument();
    expect(offer("Silver").getByText("2,000 AMT")).toBeInTheDocument();
    expect(offer("Gold").getByText("7,500 AMT")).toBeInTheDocument();
    expect(offer("Diamond").getByText("25,000 AMT")).toBeInTheDocument();
  });

  it("shows the payment token balance", () => {
    render(<TierShop />);
    expect(screen.getByTestId("tier-shop-balance")).toHaveTextContent("1,000 AMT");
  });

  it("shows tier_remaining stock, including uncapped and sold out", () => {
    mockState.remaining = { Bronze: 12n, Silver: 0n };
    render(<TierShop />);
    expect(screen.getByTestId("tier-stock-Bronze")).toHaveTextContent("12 left");
    expect(screen.getByTestId("tier-stock-Silver")).toHaveTextContent("Sold out");
    expect(screen.getByTestId("tier-stock-Gold")).toHaveTextContent("Unlimited supply");
    expect(offer("Silver").getByRole("button", { name: /Buy Silver/i })).toBeDisabled();
  });

  it("disables tiers the balance cannot cover and says why", () => {
    render(<TierShop />);
    expect(offer("Bronze").getByRole("button", { name: /Buy Bronze/i })).toBeEnabled();
    const silver = offer("Silver").getByRole("button", { name: /Buy Silver/i });
    expect(silver).toBeDisabled();
    expect(offer("Silver").getByText(/You need 2,000 AMT/i)).toBeInTheDocument();
  });

  it("confirms price and remaining balance before calling mint_tier", async () => {
    render(<TierShop />);
    await userEvent.click(offer("Bronze").getByRole("button", { name: /Buy Bronze/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Buy a Bronze Bot/i)).toBeInTheDocument();
    expect(within(dialog).getByText("500 AMT")).toBeInTheDocument(); // balance after
    expect(mockMintMutate).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: /Pay 500 AMT/i }));
    expect(mockMintMutate).toHaveBeenCalledWith({ tier: "Bronze" });
  });

  it("disables every purchase while the token is paused", () => {
    mockState.mintPaused = true;
    render(<TierShop />);
    expect(offer("Bronze").getByRole("button", { name: /Buy Bronze/i })).toBeDisabled();
    expect(offer("Bronze").getByText(/AMT token is paused/i)).toBeInTheDocument();
  });
});
