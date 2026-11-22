import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

jest.mock("next/link", () => {
  const MockLink = ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
  MockLink.displayName = "Link";
  return MockLink;
});

const mockTiers: { data: Record<string, { rate: bigint }> | undefined } = { data: undefined };
jest.mock("@/hooks/useTiers", () => ({
  useTiers: () => ({ data: mockTiers.data }),
}));

import UpgradePrompt from "../UpgradePrompt";

describe("UpgradePrompt (#478)", () => {
  it("derives the Diamond multiplier from the contract's tier rates", () => {
    mockTiers.data = { Basic: { rate: 2n }, Diamond: { rate: 700n } };
    render(<UpgradePrompt currentRate={0} />);
    expect(
      screen.getByText(/Diamond bots earn 350x the rate of Basic bots!/)
    ).toBeInTheDocument();
  });

  it("omits the multiplier until tier data has loaded", () => {
    mockTiers.data = undefined;
    render(<UpgradePrompt currentRate={0} />);
    expect(screen.getByText(/Upgrade to higher-tier bots/)).toBeInTheDocument();
    expect(screen.queryByText(/Diamond bots earn/)).not.toBeInTheDocument();
  });
});
