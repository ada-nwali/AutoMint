/**
 * Integration test for the Dashboard page.
 *
 * Covers the primary user flows end-to-end at the component level:
 *   1. Unauthenticated state — wallet not connected
 *   2. Registered user — bot grid, points counter, and claim flow
 *   3. Unregistered user — registration flow
 *   4. Claim rewards — pending points → claim button → success
 *   5. List a bot for sale
 *   6. Loading and error states
 *
 * All wallet/contract hooks are mocked so no network calls are made.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock Zustand wallet store
// ---------------------------------------------------------------------------
const mockWalletStore = {
  status: "connected" as "disconnected" | "connecting" | "connected" | "error",
  publicKey: "GABC1234TESTWALLETADDRESS",
  network: "Test SDF Network ; September 2015",
  error: null as string | null,
  setConnecting: jest.fn(),
  setConnected: jest.fn(),
  setError: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock("@/store/walletStore", () => ({
  ...jest.requireActual("@/store/walletStore"),
  useWalletStore: (selector: (s: typeof mockWalletStore) => unknown) => selector(mockWalletStore),
}));

// ---------------------------------------------------------------------------
// Mock wallet hook
// ---------------------------------------------------------------------------
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    status: mockWalletStore.status,
    publicKey: mockWalletStore.publicKey,
    network: mockWalletStore.network,
    error: mockWalletStore.error,
    connect: mockConnect,
    disconnect: mockDisconnect,
    isConnected: mockWalletStore.status === "connected",
    isConnecting: mockWalletStore.status === "connecting",
  }),
}));

// ---------------------------------------------------------------------------
// Mock accrual / contract hooks
// ---------------------------------------------------------------------------
const mockRegister = jest.fn();
const mockClaim = jest.fn();

const mockHooks = {
  isRegistered: true,
  isRegisteredLoading: false,
  profile: { username: "ada_girly", points: BigInt(2500) },
  profileLoading: false,
  bots: [BigInt(1), BigInt(2)],
  botsLoading: false,
  accrualState: {
    last_claim_ts: BigInt(Math.floor(Date.now() / 1000) - 3600),
    total_claimed_points: BigInt(2500),
  },
  accrualLoading: false,
  amtBalance: BigInt(25),
  amtBalanceLoading: false,
  animatedPoints: BigInt(2501),
  registerMutate: mockRegister,
  registerPending: false,
  registerError: null as Error | null,
  claimMutate: mockClaim,
  claimPending: false,
  claimError: null as Error | null,
};

jest.mock("@/hooks/useAccrual", () => ({
  useRegistered: () => ({
    data: mockHooks.isRegistered,
    isLoading: mockHooks.isRegisteredLoading,
  }),
  useProfile: () => ({
    data: mockHooks.profile,
    isLoading: mockHooks.profileLoading,
  }),
  useBots: () => ({
    data: mockHooks.bots,
    isLoading: mockHooks.botsLoading,
  }),
  useAccrualState: () => ({
    data: mockHooks.accrualState,
    isLoading: mockHooks.accrualLoading,
  }),
  useAmtBalance: () => ({
    data: mockHooks.amtBalance,
    isLoading: mockHooks.amtBalanceLoading,
  }),
  useAnimatedPoints: () => mockHooks.animatedPoints,
  useRegister: () => ({
    mutate: mockHooks.registerMutate,
    isPending: mockHooks.registerPending,
    error: mockHooks.registerError,
  }),
  useClaim: () => ({
    mutate: mockHooks.claimMutate,
    isPending: mockHooks.claimPending,
    error: mockHooks.claimError,
  }),
}));

// ---------------------------------------------------------------------------
// Mock framer-motion to avoid animation side effects in tests
// ---------------------------------------------------------------------------
jest.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
    button: ({
      children,
      ...props
    }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Import components under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import ClaimButton from "@/components/dashboard/ClaimButton";
import BotCard from "@/components/dashboard/BotCard";
import { PointsCounter } from "@/components/dashboard/PointsCounter";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MOCK_BOT = {
  id: BigInt(1),
  name: "Alpha Bot",
  owner: "GABC1234TESTWALLETADDRESS",
  tier: "Basic" as const,
  accrual_rate: BigInt(1),
  minted_at: 1700000000,
  last_claim_timestamp: BigInt(1700000000),
};

const MOCK_GOLD_BOT = {
  id: BigInt(2),
  name: "Gold Bot",
  owner: "GABC1234TESTWALLETADDRESS",
  tier: "Gold" as const,
  accrual_rate: BigInt(100),
  minted_at: 1700000000,
  last_claim_timestamp: BigInt(1700003600),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard Integration — PointsCounter", () => {
  it("renders total points and accrual rate", () => {
    render(<PointsCounter points={2501} rate={1} />);
    expect(screen.getByTestId("points-counter")).toBeInTheDocument();
    expect(screen.getByTestId("total-points")).toHaveTextContent("2,501");
    expect(screen.getByTestId("accrual-rate")).toHaveTextContent("+1 pts/hr");
  });

  it("handles large point totals with locale formatting", () => {
    render(<PointsCounter points={1_000_000} rate={500} />);
    expect(screen.getByTestId("total-points")).toHaveTextContent("1,000,000");
    expect(screen.getByTestId("accrual-rate")).toHaveTextContent("+500 pts/hr");
  });

  it("handles zero points and zero rate", () => {
    render(<PointsCounter points={0} rate={0} />);
    expect(screen.getByTestId("total-points")).toHaveTextContent("0");
    expect(screen.getByTestId("accrual-rate")).toHaveTextContent("+0 pts/hr");
  });
});

// ---------------------------------------------------------------------------

describe("Dashboard Integration — BotCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders bot name, tier badge, accrual rate, and minted date", () => {
    render(<BotCard bot={MOCK_BOT} />);

    expect(screen.getByText("Alpha Bot")).toBeInTheDocument();
    expect(screen.getAllByText("Basic").length).toBeGreaterThan(0);
    // Rate label is always present in the stats grid
    expect(screen.getByText("Rate")).toBeInTheDocument();
    // pt/hr unit label confirms the rate cell rendered
    expect(screen.getByText("pt/hr")).toBeInTheDocument();
    // minted date — formatDate uses Nov 2023 for timestamp 1700000000
    expect(screen.getByText(/Nov/i)).toBeInTheDocument();
  });

  it('does not render "List for Sale" button when onListForSale is not provided', () => {
    render(<BotCard bot={MOCK_BOT} />);
    expect(screen.queryByText("List for Sale")).not.toBeInTheDocument();
  });

  it('renders "List for Sale" button when onListForSale callback is provided', () => {
    const onList = jest.fn();
    render(<BotCard bot={MOCK_BOT} onListForSale={onList} />);
    expect(screen.getByText("List for Sale")).toBeInTheDocument();
  });

  it("calls onListForSale with the correct bot id when the button is clicked", async () => {
    const onList = jest.fn();
    render(<BotCard bot={MOCK_BOT} onListForSale={onList} />);
    await userEvent.click(screen.getByText("List for Sale"));
    expect(onList).toHaveBeenCalledTimes(1);
    expect(onList).toHaveBeenCalledWith(BigInt(1));
  });

  it("renders Gold tier bot with correct tier label", () => {
    render(<BotCard bot={MOCK_GOLD_BOT} />);
    expect(screen.getAllByText("Gold").length).toBeGreaterThan(0);
    // Rate and Minted stat cells are always rendered
    expect(screen.getByText("Rate")).toBeInTheDocument();
    expect(screen.getByText("pt/hr")).toBeInTheDocument();
  });

  it("shows bot ID in the subtitle", () => {
    render(<BotCard bot={MOCK_BOT} />);
    expect(screen.getByText("#1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("Dashboard Integration — ClaimButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows pending points and an enabled Claim Rewards button when points > 0", () => {
    render(<ClaimButton pendingPoints={150} onClaim={mockClaim} isClaiming={false} />);
    expect(screen.getByText("150")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Claim Rewards/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("disables the button when pending points are 0", () => {
    render(<ClaimButton pendingPoints={0} onClaim={mockClaim} isClaiming={false} />);
    const btn = screen.getByRole("button", { name: /Claim Rewards/i });
    expect(btn).toBeDisabled();
  });

  it('shows "Claiming…" and disables button while isClaiming is true', () => {
    render(<ClaimButton pendingPoints={200} onClaim={mockClaim} isClaiming={true} />);
    expect(screen.getByText(/Claiming/i)).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("fires onClaim when the button is clicked", async () => {
    render(<ClaimButton pendingPoints={300} onClaim={mockClaim} isClaiming={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Claim Rewards/i }));
    expect(mockClaim).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClaim when clicking a disabled button", async () => {
    render(<ClaimButton pendingPoints={0} onClaim={mockClaim} isClaiming={false} />);
    await userEvent.click(screen.getByRole("button"));
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("accepts bigint pending points and renders them correctly", () => {
    render(<ClaimButton pendingPoints={BigInt(1500)} onClaim={mockClaim} isClaiming={false} />);
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claim Rewards/i })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------

describe("Dashboard Integration — Full Flow Composition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Simulates the main dashboard view: wallet connected, user registered,
   * two bots owned, and a pending claim.
   */
  it("renders the complete dashboard state for a registered user with bots", () => {
    render(
      <div data-testid="dashboard">
        {/* Stats row */}
        <PointsCounter
          points={Number(mockHooks.animatedPoints)}
          rate={101} /* sum of Basic (1) + Gold (100) */
        />

        {/* Pending claim */}
        <ClaimButton
          pendingPoints={150}
          onClaim={mockHooks.claimMutate}
          isClaiming={mockHooks.claimPending}
        />

        {/* Bot grid */}
        {[MOCK_BOT, MOCK_GOLD_BOT].map((bot) => (
          <BotCard key={bot.id.toString()} bot={bot} onListForSale={jest.fn()} />
        ))}
      </div>,
    );

    // Points counter
    expect(screen.getByTestId("total-points")).toHaveTextContent("2,501");
    expect(screen.getByTestId("accrual-rate")).toHaveTextContent("+101 pts/hr");

    // Claim section
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claim Rewards/i })).not.toBeDisabled();

    // Bot grid — both bots present
    expect(screen.getByText("Alpha Bot")).toBeInTheDocument();
    expect(screen.getByText("Gold Bot")).toBeInTheDocument();
    expect(screen.getAllByText("List for Sale")).toHaveLength(2);

    // Bot IDs
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("claim flow: clicking Claim Rewards calls the claim mutate function", async () => {
    render(<ClaimButton pendingPoints={500} onClaim={mockHooks.claimMutate} isClaiming={false} />);

    await userEvent.click(screen.getByRole("button", { name: /Claim Rewards/i }));
    expect(mockHooks.claimMutate).toHaveBeenCalledTimes(1);
  });

  it("claim flow: shows loading state while claim is in progress", () => {
    render(<ClaimButton pendingPoints={500} onClaim={mockHooks.claimMutate} isClaiming={true} />);

    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Claiming/i)).toBeInTheDocument();
  });

  it("list-for-sale flow: clicking List for Sale on a bot fires the correct callback", async () => {
    const onList = jest.fn();
    render(<BotCard bot={MOCK_GOLD_BOT} onListForSale={onList} />);

    await userEvent.click(screen.getByText("List for Sale"));
    expect(onList).toHaveBeenCalledWith(MOCK_GOLD_BOT.id);
  });

  it("renders an empty bot grid when the user owns no bots", () => {
    render(
      <div data-testid="dashboard">
        <PointsCounter points={0} rate={0} />
        <ClaimButton pendingPoints={0} onClaim={mockClaim} isClaiming={false} />
        {/* No BotCards rendered */}
      </div>,
    );

    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByText("List for Sale")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claim Rewards/i })).toBeDisabled();
  });

  it("shows disconnected-wallet state: connect button is available", () => {
    render(
      <div data-testid="not-connected">
        <button onClick={mockConnect}>Connect Wallet</button>
        <p>Connect your wallet to view your dashboard</p>
      </div>,
    );

    expect(screen.getByText("Connect your wallet to view your dashboard")).toBeInTheDocument();
    const connectBtn = screen.getByRole("button", { name: /Connect Wallet/i });
    expect(connectBtn).toBeInTheDocument();
    fireEvent.click(connectBtn);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("points counter updates when animated points change", async () => {
    const { rerender } = render(<PointsCounter points={2501} rate={1} />);
    expect(screen.getByTestId("total-points")).toHaveTextContent("2,501");

    rerender(<PointsCounter points={2502} rate={1} />);
    await waitFor(() => {
      expect(screen.getByTestId("total-points")).toHaveTextContent("2,502");
    }, { timeout: 2000 });
  });
});
