/**
 * Integration test for the Profile page.
 *
 * Covers the primary user flow end-to-end at the component level:
 *   1. Wallet not connected — prompt to connect
 *   2. Loading state — profile/bots still fetching
 *   3. Wallet connected but no profile — prompt to register
 *   4. Wallet connected with profile — full profile details + bots render
 *   5. Wallet connected with profile but no bots — bots section is hidden
 *
 * All wallet/contract hooks are mocked so no network calls are made.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock Zustand wallet store
// ---------------------------------------------------------------------------
const mockWalletStore = {
  publicKey: null as string | null,
};

jest.mock('@/store/walletStore', () => ({
  ...jest.requireActual('@/store/walletStore'),
  useWalletStore: (selector: (s: typeof mockWalletStore) => unknown) =>
    selector(mockWalletStore),
}));

// ---------------------------------------------------------------------------
// Mock accrual / contract hooks
// ---------------------------------------------------------------------------
const mockHooks = {
  profile: null as null | {
    username: string;
    registeredAt: bigint;
    points: bigint;
    claimedAmt: bigint;
    botCount: number;
    address: string;
  },
  profileLoading: false,
  bots: [] as bigint[],
  botsLoading: false,
};

jest.mock('@/hooks/useAccrual', () => ({
  useProfile: () => ({
    data: mockHooks.profile,
    isLoading: mockHooks.profileLoading,
  }),
  useBots: () => ({
    data: mockHooks.bots,
    isLoading: mockHooks.botsLoading,
  }),
}));

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import ProfilePage from '@/app/profile/page';

const MOCK_PROFILE = {
  username: 'ada_girly',
  registeredAt: BigInt(1700000000),
  points: BigInt(2500),
  claimedAmt: BigInt(123_456_789),
  botCount: 2,
  address: 'GABC1234TESTWALLETADDRESSXYZ',
};

describe('Profile Page Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletStore.publicKey = null;
    mockHooks.profile = null;
    mockHooks.profileLoading = false;
    mockHooks.bots = [];
    mockHooks.botsLoading = false;
  });

  it('prompts to connect a wallet when no wallet is connected', () => {
    render(<ProfilePage />);

    expect(screen.getByText('Connect Your Wallet')).toBeInTheDocument();
    expect(
      screen.getByText('Please connect your wallet to view your profile')
    ).toBeInTheDocument();
  });

  it('shows a loading state while profile/bots are being fetched', () => {
    mockWalletStore.publicKey = MOCK_PROFILE.address;
    mockHooks.profileLoading = true;
    mockHooks.botsLoading = true;

    const { container } = render(<ProfilePage />);

    expect(screen.queryByText('Connect Your Wallet')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('prompts to register when wallet is connected but no profile exists', () => {
    mockWalletStore.publicKey = MOCK_PROFILE.address;
    mockHooks.profile = null;

    render(<ProfilePage />);

    expect(screen.getByText('Profile Not Found')).toBeInTheDocument();
    expect(
      screen.getByText('Please register to create your profile')
    ).toBeInTheDocument();
  });

  it('renders full profile details and bots for a registered, connected user', () => {
    mockWalletStore.publicKey = MOCK_PROFILE.address;
    mockHooks.profile = MOCK_PROFILE;
    mockHooks.bots = [BigInt(1), BigInt(2)];

    render(<ProfilePage />);

    expect(screen.getByText('My Profile')).toBeInTheDocument();

    // Username
    expect(screen.getByText('ada_girly')).toBeInTheDocument();

    // Member since (formatted date)
    expect(screen.getByText('November 14, 2023')).toBeInTheDocument();

    // Total points
    expect(screen.getByText('2,500')).toBeInTheDocument();

    // Claimed AMT (123_456_789 / 10_000_000 = 12.35)
    expect(screen.getByText('12.35 AMT')).toBeInTheDocument();

    // Bot count card
    expect(screen.getByText('Total Bots')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    // Wallet address, truncated
    expect(
      screen.getByText((_, el) => el?.textContent === 'GABC1234...DRESSXYZ')
    ).toBeInTheDocument();

    // Bot IDs section
    expect(screen.getByText('My Bots (2)')).toBeInTheDocument();
    expect(screen.getByText('Bot #1')).toBeInTheDocument();
    expect(screen.getByText('Bot #2')).toBeInTheDocument();
  });

  it('hides the bots section when the user owns no bots', () => {
    mockWalletStore.publicKey = MOCK_PROFILE.address;
    mockHooks.profile = MOCK_PROFILE;
    mockHooks.bots = [];

    render(<ProfilePage />);

    expect(screen.queryByText(/My Bots/)).not.toBeInTheDocument();
  });
});
