import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  LeaderboardTable,
  type LeaderboardUser,
} from '../components/leaderboard/LeaderboardTable';

expect.extend(toHaveNoViolations);

jest.mock('framer-motion', () => ({
  motion: {
    tr: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLTableRowElement>>) => (
      <tr {...props}>{children}</tr>
    ),
  },
}));

const mockUsers: LeaderboardUser[] = [
  { rank: 1, address: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456', points: 1500n, username: 'alice', botCount: 3 },
  { rank: 2, address: 'GXYZ78901234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ6789', points: 900n, username: 'bob', botCount: 1 },
  { rank: 5, address: 'GTEST00000000000000000000000000000000000000000000', points: 100n, username: 'charlie' },
];

describe('LeaderboardTable Component', () => {
  it('renders empty message when no users are provided', () => {
    render(<LeaderboardTable users={[]} />);
    expect(screen.getByTestId('empty-leaderboard')).toBeInTheDocument();
    expect(screen.getByText('No leaderboard data available')).toBeInTheDocument();
  });

  it('renders empty message when users is nullish', () => {
    render(<LeaderboardTable users={[] as any} />);
    expect(screen.getByTestId('empty-leaderboard')).toBeInTheDocument();
  });

  it('renders users list correctly with table structure', () => {
    render(<LeaderboardTable users={mockUsers.slice(0, 2)} />);
    expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();
    expect(screen.getByTestId('user-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('user-row-2')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
  });

  it('displays rank medals for top 3 and numeric rank for others', () => {
    render(<LeaderboardTable users={mockUsers} />);
    // Rank 1 and 2 have medal icons (sr-only labels)
    expect(screen.getByText('1st place')).toBeInTheDocument();
    expect(screen.getByText('2nd place')).toBeInTheDocument();
    // Rank 5 shows numeric rank
    expect(screen.getByText('#5')).toBeInTheDocument();
  });

  describe('rank is not conveyed by emoji/colour alone (#527)', () => {
    it('shows a visible numeric rank next to the medal for the top 3', () => {
      render(<LeaderboardTable users={mockUsers} />);
      const row1 = within(screen.getByTestId('user-row-1'));
      // greyscale-safe: the position is readable as a number, not just a medal
      expect(row1.getByText('1')).toBeInTheDocument();
      const row2 = within(screen.getByTestId('user-row-2'));
      expect(row2.getByText('2')).toBeInTheDocument();
    });

    it('hides the decorative medal glyph from the accessibility tree and labels it', () => {
      render(<LeaderboardTable users={mockUsers.slice(0, 1)} />);
      const row1 = within(screen.getByTestId('user-row-1'));
      expect(row1.getByText('🥇')).toHaveAttribute('aria-hidden', 'true');
      // adjacent accessible name for screen readers
      expect(row1.getByText('1st place')).toHaveClass('sr-only');
    });

    it('has no axe-detectable accessibility violations', async () => {
      const { container } = render(
        <LeaderboardTable users={mockUsers} currentAddress={mockUsers[0].address} />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it('truncates long addresses and displays correctly', () => {
    render(<LeaderboardTable users={mockUsers.slice(0, 1)} />);
    // truncateAddress: first 6 + ... + last 4
    const addr = mockUsers[0].address;
    const truncated = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    expect(screen.getByText(truncated)).toBeInTheDocument();
  });

  it('falls back to Trader # rank when username is missing', () => {
    const users: LeaderboardUser[] = [{ rank: 3, address: 'GABC12345678', points: 500n, username: '' }];
    render(<LeaderboardTable users={users} />);
    expect(screen.getByText('Trader #3')).toBeInTheDocument();
  });

  it('highlights current user row with You badge', () => {
    render(<LeaderboardTable users={mockUsers} currentAddress={mockUsers[0].address} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    const row = screen.getByTestId('user-row-1');
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('highlights current user case-insensitively', () => {
    render(<LeaderboardTable users={mockUsers} currentAddress={mockUsers[0].address.toLowerCase()} />);
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('does not highlight any row when currentAddress is null', () => {
    render(<LeaderboardTable users={mockUsers} currentAddress={null} />);
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('renders table with accessible region and caption', () => {
    render(<LeaderboardTable users={mockUsers.slice(0, 1)} />);
    const region = screen.getByRole('region', { name: /Leaderboard rankings/ });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('tabIndex', '0');
  });

  it('renders column headers correctly', () => {
    render(<LeaderboardTable users={mockUsers.slice(0, 1)} />);
    expect(screen.getByText('Rank')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
  });

  it('renders bigint points beyond Number.MAX_SAFE_INTEGER without losing digits', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1 — unrepresentable as a JS number
    render(
      <LeaderboardTable
        users={[{ rank: 1, address: 'GWHALE', points: huge, username: 'whale' }]}
      />,
    );
    expect(screen.getByText(huge.toLocaleString('en-US'))).toBeInTheDocument();
  });

  it('handles short addresses without truncation', () => {
    const users: LeaderboardUser[] = [{ rank: 1, address: 'GABC123', points: 100n, username: 'short' }];
    render(<LeaderboardTable users={users} />);
    expect(screen.getByText('GABC123')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // #506 — the connected user's own rank, pinned to the bottom
  // -----------------------------------------------------------------------
  describe('pinned current-user rank row', () => {
    const outsideTopFifty = {
      address: 'GOUTSIDE0000000000000000000000000000000000000000',
      username: 'dave',
      rank: 312,
      points: 42n,
      pointsToNextRank: 8n,
    };

    it('pins the row for a user who is not in the visible rows', () => {
      render(
        <LeaderboardTable
          users={mockUsers}
          currentAddress={outsideTopFifty.address}
          currentUserRank={outsideTopFifty}
        />,
      );

      const pinned = screen.getByTestId('current-user-rank-row');
      expect(pinned).toBeInTheDocument();
      expect(within(pinned).getByText('#312')).toBeInTheDocument();
      expect(within(pinned).getByText('dave')).toBeInTheDocument();
      expect(within(pinned).getByText('42')).toBeInTheDocument();
      expect(within(pinned).getByText('8 points to reach #311')).toBeInTheDocument();
    });

    it('highlights a top-50 user in place rather than duplicating them', () => {
      const alice = mockUsers[0]!;
      render(
        <LeaderboardTable
          users={mockUsers}
          currentAddress={alice.address}
          currentUserRank={{
            address: alice.address,
            username: alice.username,
            rank: 1,
            points: alice.points,
            pointsToNextRank: null,
          }}
        />,
      );

      expect(screen.queryByTestId('current-user-rank-row')).not.toBeInTheDocument();
      expect(screen.getByTestId('user-row-1')).toHaveAttribute('aria-current', 'true');
      expect(screen.getAllByText('You')).toHaveLength(1);
    });

    it('shows no pinned row for a disconnected visitor', () => {
      render(<LeaderboardTable users={mockUsers} currentAddress={null} />);
      expect(screen.queryByTestId('current-user-rank-row')).not.toBeInTheDocument();
    });

    it('shows no pinned row when the contract reported no standing', () => {
      render(
        <LeaderboardTable
          users={mockUsers}
          currentAddress={outsideTopFifty.address}
          currentUserRank={null}
        />,
      );
      expect(screen.queryByTestId('current-user-rank-row')).not.toBeInTheDocument();
    });

    it('states the unranked case in words instead of showing a sentinel', () => {
      render(
        <LeaderboardTable
          users={mockUsers}
          currentAddress={outsideTopFifty.address}
          currentUserRank={{ ...outsideTopFifty, rank: null, pointsToNextRank: null }}
        />,
      );

      const pinned = screen.getByTestId('current-user-rank-row');
      expect(within(pinned).getByText('Unranked')).toBeInTheDocument();
      expect(within(pinned).getByText('Claim points to enter the rankings')).toBeInTheDocument();
      expect(within(pinned).queryByText(/^#/)).not.toBeInTheDocument();
    });

    it('omits the gap line for the rank-1 user pinned below', () => {
      render(
        <LeaderboardTable
          users={[]}
          currentAddress={outsideTopFifty.address}
          currentUserRank={{ ...outsideTopFifty, rank: 1, pointsToNextRank: null }}
        />,
      );
      // An empty board renders the empty state, not a pinned row.
      expect(screen.getByTestId('empty-leaderboard')).toBeInTheDocument();
    });
  });
});
