/**
 * Integration test for the leaderboard page's season toggle (#371).
 *
 * The contract hooks are mocked so no RPC calls are made; the page's own
 * wiring is what's under test:
 *   - the All-time / Season N toggle hides until the registry reports a
 *     season >= 1
 *   - selecting a season fetches that season's board; deselecting returns
 *     to the all-time board
 *   - season view drops the lifetime overlays (accruals/profiles batches
 *     receive no addresses) because season rows carry their own names
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { UserProfile } from "@/types";

const mockState = {
  season: 0 as number,
  rows: [] as UserProfile[],
  leaderboardCalls: [] as (number | undefined)[][],
  profileCalls: [] as string[][],
  accrualCalls: [] as string[][],
};

jest.mock("@/hooks/useLeaderboard", () => ({
  useLeaderboard: (limit?: number, season?: number) => {
    mockState.leaderboardCalls.push([limit, season]);
    return {
      data: mockState.rows,
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
      isRefetching: false,
    };
  },
  useRank: () => ({ data: null }),
  useSeason: () => ({ data: mockState.season }),
}));

jest.mock("@/hooks/useProfiles", () => ({
  useProfiles: (addresses: string[]) => {
    mockState.profileCalls.push(addresses);
    return { data: undefined };
  },
}));

jest.mock("@/hooks/useLeaderboardAccruals", () => ({
  useLeaderboardAccruals: (addresses: string[]) => {
    mockState.accrualCalls.push(addresses);
    return { data: undefined };
  },
}));

jest.mock("framer-motion", () => ({
  motion: {
    tr: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const {
        initial: _initial,
        animate: _animate,
        transition: _transition,
        whileHover: _whileHover,
        ...rest
      } = props as Record<string, unknown> & { children?: React.ReactNode };
      return <tr {...rest}>{children}</tr>;
    },
  },
}));

import LeaderboardPage from "@/app/leaderboard/page";

const ROW: UserProfile = {
  address: "GABC123",
  username: "alice",
  display_name: "Alice",
  total_points: 100n,
  points: 100n,
  claimed_amt: 0n,
  claimedAmt: 0n,
  registered_at: 0,
  registeredAt: 0,
  bot_count: 0,
  botCount: 0,
};

describe("Leaderboard page season toggle (#371)", () => {
  beforeEach(() => {
    mockState.season = 0;
    mockState.rows = [];
    mockState.leaderboardCalls = [];
    mockState.profileCalls = [];
    mockState.accrualCalls = [];
  });

  it("hides the toggle when the registry has no season yet (season 0)", () => {
    mockState.season = 0;
    render(<LeaderboardPage />);

    expect(screen.queryByTestId("season-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("leaderboard-empty")).toBeInTheDocument();
  });

  it("shows the toggle and switches between all-time and the season board", () => {
    mockState.season = 2;
    mockState.rows = [ROW];
    render(<LeaderboardPage />);

    expect(screen.getByTestId("season-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-all-time")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Season 2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-season"));
    expect(mockState.leaderboardCalls.at(-1)).toEqual([undefined, 2]);
    expect(screen.getByTestId("toggle-season")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("toggle-all-time"));
    expect(mockState.leaderboardCalls.at(-1)).toEqual([undefined, undefined]);
    expect(screen.getByTestId("toggle-all-time")).toHaveAttribute("aria-pressed", "true");
  });

  it("skips the lifetime overlays in season view — batches receive no addresses", () => {
    mockState.season = 3;
    mockState.rows = [ROW];
    render(<LeaderboardPage />);

    // All-time first: the row's address feeds both batch queries.
    expect(mockState.profileCalls.at(-1)).toEqual(["GABC123"]);
    expect(mockState.accrualCalls.at(-1)).toEqual(["GABC123"]);

    fireEvent.click(screen.getByTestId("toggle-season"));
    expect(mockState.profileCalls.at(-1)).toEqual([]);
    expect(mockState.accrualCalls.at(-1)).toEqual([]);

    // The season row itself still renders with its display name.
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
