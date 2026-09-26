/**
 * Integration test for the landing page (HomePage)
 * Covers primary user flow end-to-end at component level, mocking wallet/contract hooks.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('framer-motion', () => ({
  motion: {
    h1: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLHeadingElement>>) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLParagraphElement>>) => <p {...props}>{children}</p>,
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => <div {...props}>{children}</div>,
  },
}));

jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>{children}</a>
  );
  MockLink.displayName = 'Link';
  return MockLink;
});

// Mock wallet store and hooks
jest.mock('@/store/walletStore', () => ({
  ...jest.requireActual('@/store/walletStore'),
  useWalletStore: (selector: any) => selector({ status: 'disconnected', publicKey: null }),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    status: 'disconnected',
    publicKey: null,
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnected: false,
    isConnecting: false,
  }),
}));

jest.mock('@/hooks/useAccrual', () => ({
  useRegistered: () => ({ data: false, isLoading: false }),
  useProfile: () => ({ data: null, isLoading: false }),
  useBots: () => ({ data: [], isLoading: false }),
  useAccrualState: () => ({ data: null, isLoading: false }),
  useAmtBalance: () => ({ data: null, isLoading: false }),
  useAnimatedPoints: () => 0,
  useRegister: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useClaim: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));

// Tier rates and prices come from bot_nft (#478); the hook returns the
// contract's current values (prices in stroops).
type MockTierInfo = { tier: string; name: string; rate: bigint; price: bigint };
const mockTierData: { current: Record<string, MockTierInfo> | undefined } = {
  current: {
    Basic: { tier: 'Basic', name: 'Basic Bot', rate: 1n, price: 0n },
    Bronze: { tier: 'Bronze', name: 'Bronze Bot', rate: 5n, price: 5_000_000_000n },
    Silver: { tier: 'Silver', name: 'Silver Bot', rate: 25n, price: 20_000_000_000n },
    Gold: { tier: 'Gold', name: 'Gold Bot', rate: 100n, price: 75_000_000_000n },
    Diamond: { tier: 'Diamond', name: 'Diamond Bot', rate: 500n, price: 250_000_000_000n },
  },
};

jest.mock('@/hooks/useTiers', () => ({
  useTiers: () => ({ data: mockTierData.current, isLoading: false }),
}));

import HomePage from '../app/page';

describe('Landing Page Integration', () => {
  it('renders hero section with headline and sub-headline', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /Mint, Earn & Trade/i })).toBeInTheDocument();
    expect(screen.getByText(/AI Bot NFTs/)).toBeInTheDocument();
    expect(screen.getByText(/The first AI bot NFT platform on Stellar/i)).toBeInTheDocument();
  });

  it('renders primary CTAs: Launch App and View Tiers', () => {
    render(<HomePage />);
    const launchLink = screen.getByRole('link', { name: /Launch App/i });
    expect(launchLink).toBeInTheDocument();
    expect(launchLink).toHaveAttribute('href', '/dashboard');
    const tiersLink = screen.getByRole('link', { name: /View Tiers/i });
    expect(tiersLink).toBeInTheDocument();
    expect(tiersLink).toHaveAttribute('href', '#tiers');
  });

  it('renders stats band with all four stats', () => {
    render(<HomePage />);
    expect(screen.getByText('12,480')).toBeInTheDocument();
    expect(screen.getByText('Bots Minted')).toBeInTheDocument();
    expect(screen.getByText('3,200+')).toBeInTheDocument();
    expect(screen.getByText('Active Users')).toBeInTheDocument();
    expect(screen.getByText('1.2M')).toBeInTheDocument();
    expect(screen.getByText('Points Distributed')).toBeInTheDocument();
    expect(screen.getByText('99.9%')).toBeInTheDocument();
    expect(screen.getByText('Uptime')).toBeInTheDocument();
  });

  it('renders bot tier showcase with all tiers', () => {
    render(<HomePage />);
    expect(screen.getByText('Choose Your')).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('Bronze')).toBeInTheDocument();
    expect(screen.getByText('Silver')).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('Diamond')).toBeInTheDocument();
    // Check prices
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('500 XLM')).toBeInTheDocument();
    expect(screen.getByText('2000 XLM')).toBeInTheDocument();
    expect(screen.getByText('7500 XLM')).toBeInTheDocument();
    expect(screen.getByText('25000 XLM')).toBeInTheDocument();
  });

  it('renders How It Works section with four steps', () => {
    render(<HomePage />);
    expect(screen.getByText('How It')).toBeInTheDocument();
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
    expect(screen.getByText('Mint a Bot')).toBeInTheDocument();
    expect(screen.getByText('Earn Points')).toBeInTheDocument();
    expect(screen.getByText('Trade & Upgrade')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
    expect(screen.getByText('03')).toBeInTheDocument();
    expect(screen.getByText('04')).toBeInTheDocument();
  });

  it('renders Built for Performance features section', () => {
    render(<HomePage />);
    expect(screen.getByText('Built for')).toBeInTheDocument();
    expect(screen.getByText('Instant Settlement')).toBeInTheDocument();
    expect(screen.getByText('On-Chain Ownership')).toBeInTheDocument();
    expect(screen.getByText('Daily Accrual')).toBeInTheDocument();
    expect(screen.getByText('Tier Progression')).toBeInTheDocument();
  });

  it('renders CTA section with Get Started link', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /Ready to Mint/i })).toBeInTheDocument();
    const ctaLinks = screen.getAllByRole('link', { name: /Get Started/i });
    expect(ctaLinks.length).toBeGreaterThan(0);
    expect(ctaLinks[0]).toHaveAttribute('href', '/dashboard');
  });

  it('has accessible tier section with id tiers', () => {
    const { container } = render(<HomePage />);
    const tiersSection = container.querySelector('#tiers');
    expect(tiersSection).toBeInTheDocument();
  });

  it('View Tiers link points to tiers anchor', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const link = screen.getByRole('link', { name: /View Tiers/i });
    expect(link).toHaveAttribute('href', '#tiers');
    await user.click(link);
    expect(link).toBeInTheDocument();
  });

  it('renders all tiers with correct accrual rates', () => {
    render(<HomePage />);
    expect(screen.getByText('1x accrual rate')).toBeInTheDocument();
    expect(screen.getByText('5x accrual rate')).toBeInTheDocument();
    expect(screen.getByText('25x accrual rate')).toBeInTheDocument();
    expect(screen.getByText('100x accrual rate')).toBeInTheDocument();
    expect(screen.getByText('500x accrual rate')).toBeInTheDocument();
  });

  it('renders whatever rates and prices the contract reports (#478)', () => {
    const original = mockTierData.current!;
    mockTierData.current = {
      ...original,
      Diamond: { ...original.Diamond, rate: 750n, price: 300_000_000_000n },
    };
    try {
      render(<HomePage />);
      expect(screen.getByText('750x accrual rate')).toBeInTheDocument();
      expect(screen.getByText('30000 XLM')).toBeInTheDocument();
      expect(screen.queryByText('500x accrual rate')).not.toBeInTheDocument();
    } finally {
      mockTierData.current = original;
    }
  });

  it('shows placeholders, not invented numbers, while tier data loads', () => {
    const original = mockTierData.current;
    mockTierData.current = undefined;
    try {
      render(<HomePage />);
      expect(screen.getAllByText('— accrual rate')).toHaveLength(5);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
    } finally {
      mockTierData.current = original;
    }
  });
});
