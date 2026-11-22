import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Header from "../components/layout/Header";
import { useWallet } from "@/hooks/useWallet";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

jest.mock("@/hooks/useWallet", () => ({
  useWallet: jest.fn(),
}));

const mockedUsePathname = jest.requireMock("next/navigation").usePathname as jest.Mock;
const mockedUseWallet = useWallet as jest.Mock;

const connect = jest.fn();
const disconnect = jest.fn();

function mockWallet(overrides: Partial<ReturnType<typeof useWallet>> = {}) {
  mockedUseWallet.mockReturnValue({
    status: "disconnected",
    publicKey: null,
    network: null,
    error: null,
    connect,
    disconnect,
    isConnected: false,
    isConnecting: false,
    ...overrides,
  });
}

describe("Header Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUsePathname.mockReturnValue("/dashboard");
    mockWallet();
  });

  it("renders the brand link and nav links", () => {
    render(<Header />);

    expect(screen.getByText("AutoMint")).toBeInTheDocument();
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Marketplace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Leaderboard").length).toBeGreaterThan(0);
  });

  it("highlights the nav link matching the current pathname", () => {
    mockedUsePathname.mockReturnValue("/marketplace");
    render(<Header />);

    const activeLink = screen.getAllByText("Marketplace")[0].closest("a");
    const inactiveLink = screen.getAllByText("Dashboard")[0].closest("a");

    expect(activeLink).toHaveClass("bg-card-2", "text-text");
    expect(inactiveLink).toHaveClass("text-muted");
  });

  it("shows a 'Connect Wallet' button when disconnected and calls connect on click", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const connectButtons = screen.getAllByRole("button", { name: /connect wallet/i });
    expect(connectButtons.length).toBeGreaterThan(0);

    await user.click(connectButtons[0]);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("shows the truncated wallet address and a disconnect control when connected", async () => {
    const user = userEvent.setup();
    mockWallet({
      isConnected: true,
      publicKey: "GABCDEFGHIJKLMNOP1234567890",
      status: "connected",
    });

    render(<Header />);

    expect(screen.getAllByText("GABCDE...7890").length).toBeGreaterThan(0);

    const disconnectButtons = screen.getAllByRole("button", { name: /disconnect wallet/i });
    await user.click(disconnectButtons[0]);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("toggles the mobile menu open and closed", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const toggle = screen.getByRole("button", { name: /open menu/i });
    expect(screen.getAllByText("Dashboard")).toHaveLength(1);

    await user.click(toggle);

    expect(screen.getByRole("button", { name: /close menu/i })).toBeInTheDocument();
    expect(screen.getAllByText("Dashboard")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /close menu/i }));

    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
    expect(screen.getAllByText("Dashboard")).toHaveLength(1);
  });

  it("closes the mobile menu when a mobile nav link is clicked", async () => {
    const user = userEvent.setup();
    render(<Header />);

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    const mobileDashboardLink = screen.getAllByText("Dashboard")[1];

    await user.click(mobileDashboardLink);

    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
    expect(screen.getAllByText("Dashboard")).toHaveLength(1);
  });
});
