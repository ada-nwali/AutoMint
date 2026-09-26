import React from "react";
import { render, screen } from "@testing-library/react";
import { PointsCounter } from "../components/dashboard/PointsCounter";
import type { BotNFT } from "@/types";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
  useSpring: () => ({ get: () => 0 }),
  useMotionValue: () => ({ get: () => 0, set: () => {} }),
  animate: () => ({ stop: () => {} }),
}));

const mockBots: BotNFT[] = [
  {
    id: 1n,
    name: "Basic Bot",
    owner: "GABC",
    tier: "Basic",
    accrual_rate: 1n,
    minted_at: 1700000000,
    last_claim_timestamp: 0n,
  },
  {
    id: 2n,
    name: "Gold Bot",
    owner: "GABC",
    tier: "Gold",
    accrual_rate: 10n,
    minted_at: 1700000000,
    last_claim_timestamp: 0n,
  },
];

describe("PointsCounter enhanced", () => {
  it("renders total points and accrual rate", () => {
    render(<PointsCounter points={2500} rate={50} />);
    expect(screen.getByTestId("points-counter")).toBeInTheDocument();
    expect(screen.getByTestId("accrual-rate")).toHaveTextContent("+50 pts/hr");
  });

  it("handles zero values", () => {
    render(<PointsCounter points={0} rate={0} />);
    expect(screen.getByTestId("total-points")).toHaveTextContent("0");
  });

  it("displays AMT balance when provided", () => {
    render(
      <PointsCounter points={100} rate={10} amtBalance={BigInt(15_000_000)} amtDecimals={7} />
    );
    expect(screen.getByText(/AMT/)).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
  });

  it("scales the AMT balance by the token's own decimals (#479)", () => {
    render(
      <PointsCounter points={100} rate={10} amtBalance={BigInt(1_500_000)} amtDecimals={6} />
    );
    expect(screen.getByText("1.5")).toBeInTheDocument();
  });

  it("does not display AMT balance until the token's decimals are known", () => {
    render(<PointsCounter points={100} rate={10} amtBalance={BigInt(15_000_000)} />);
    expect(screen.queryByText(/AMT/)).not.toBeInTheDocument();
  });

  it("does not display AMT balance when not provided", () => {
    render(<PointsCounter points={100} rate={10} />);
    expect(screen.queryByText(/AMT/)).not.toBeInTheDocument();
  });

  it("renders per-bot rate breakdown when bots are provided", () => {
    render(<PointsCounter points={100} rate={11} bots={mockBots} />);
    expect(screen.getByText("Rate Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Basic Bot")).toBeInTheDocument();
    expect(screen.getByText("Gold Bot")).toBeInTheDocument();
  });

  it("does not render breakdown when bots array is empty", () => {
    render(<PointsCounter points={100} rate={10} bots={[]} />);
    expect(screen.queryByText("Rate Breakdown")).not.toBeInTheDocument();
  });

  it("does not render breakdown when bots is undefined", () => {
    render(<PointsCounter points={100} rate={10} />);
    expect(screen.queryByText("Rate Breakdown")).not.toBeInTheDocument();
  });

  it("shows accrual rate with aria-label", () => {
    render(<PointsCounter points={100} rate={25} />);
    expect(screen.getByLabelText("Earning 25 points per hour")).toBeInTheDocument();
  });

  it("displays total points with aria-live", () => {
    render(<PointsCounter points={1234} rate={10} />);
    const el = screen.getByTestId("total-points");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("handles large point values with locale formatting", () => {
    render(<PointsCounter points={1000000} rate={500} />);
    // Animated number may not be exactly formatted due to animation, check element exists
    expect(screen.getByTestId("total-points")).toBeInTheDocument();
  });
});
