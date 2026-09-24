import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeaderboard, useRank } from '../hooks/useLeaderboard';
import { getLeaderboard, getUserRank } from '@/lib/contracts';
import { useWalletStore } from '@/store/walletStore';
import type { UserProfile } from '@/types';

// Mock the contracts module
jest.mock('@/lib/contracts', () => ({
  getLeaderboard: jest.fn(),
  getUserRank: jest.fn(),
}));

const mockGetLeaderboard = getLeaderboard as jest.MockedFunction<typeof getLeaderboard>;
const mockGetUserRank = getUserRank as jest.MockedFunction<typeof getUserRank>;

describe('useLeaderboard Hook', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should return loading state initially', () => {
    mockGetLeaderboard.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useLeaderboard(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('should return success state with data', async () => {
    const mockLeaderboard: UserProfile[] = [
      {
        address: 'GABC123',
        username: 'Alice',
        points: 1000n,
        claimedAmt: 500n,
        registeredAt: 1234567890n,
        botCount: 3,
      },
      {
        address: 'GDEF456',
        username: 'Bob',
        points: 800n,
        claimedAmt: 300n,
        registeredAt: 1234567891n,
        botCount: 2,
      },
    ];

    mockGetLeaderboard.mockResolvedValue(mockLeaderboard);

    const { result } = renderHook(() => useLeaderboard(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockLeaderboard);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should return error state when query fails', async () => {
    const mockError = new Error('Failed to fetch leaderboard');
    mockGetLeaderboard.mockRejectedValue(mockError);

    const { result } = renderHook(() => useLeaderboard(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('should accept custom limit parameter', async () => {
    const customLimit = 25;
    const mockLeaderboard: UserProfile[] = [];

    mockGetLeaderboard.mockResolvedValue(mockLeaderboard);

    renderHook(() => useLeaderboard(customLimit), { wrapper });

    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalledWith(customLimit));
  });

  it('should use default limit of 50 when no parameter provided', async () => {
    const mockLeaderboard: UserProfile[] = [];

    mockGetLeaderboard.mockResolvedValue(mockLeaderboard);

    renderHook(() => useLeaderboard(), { wrapper });

    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalledWith(50));
  });

  it('should handle empty leaderboard', async () => {
    mockGetLeaderboard.mockResolvedValue([]);

    const { result } = renderHook(() => useLeaderboard(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #506 — the connected user's own standing
// ---------------------------------------------------------------------------
describe('useRank Hook', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.clearAllMocks();
    useWalletStore.setState({
      status: 'disconnected',
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
    });
  });

  it('stays disabled and makes no contract call while no wallet is connected', () => {
    const { result } = renderHook(() => useRank(), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(mockGetUserRank).not.toHaveBeenCalled();
  });

  it('resolves the standing for the connected address', async () => {
    useWalletStore.setState({ status: 'connected', publicKey: 'GUSER' });
    const standing = {
      address: 'GUSER',
      username: 'dave',
      rank: 312,
      points: 42n,
      pointsToNextRank: 8n,
    };
    mockGetUserRank.mockResolvedValue(standing);

    const { result } = renderHook(() => useRank(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetUserRank).toHaveBeenCalledWith('GUSER');
    expect(result.current.data).toEqual(standing);
  });

  it('surfaces an unranked user as a null rank rather than a sentinel', async () => {
    useWalletStore.setState({ status: 'connected', publicKey: 'GUSER' });
    mockGetUserRank.mockResolvedValue({
      address: 'GUSER',
      username: 'dave',
      rank: null,
      points: 0n,
      pointsToNextRank: null,
    });

    const { result } = renderHook(() => useRank(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rank).toBeNull();
  });

  it('resolves to null for an address with no registry profile', async () => {
    useWalletStore.setState({ status: 'connected', publicKey: 'GSTRANGER' });
    mockGetUserRank.mockResolvedValue(null);

    const { result } = renderHook(() => useRank(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('refetches under a per-address query key when the wallet changes', async () => {
    useWalletStore.setState({ status: 'connected', publicKey: 'GUSER' });
    mockGetUserRank.mockResolvedValue(null);

    const { rerender } = renderHook(() => useRank(), { wrapper });
    await waitFor(() => expect(mockGetUserRank).toHaveBeenCalledWith('GUSER'));

    useWalletStore.setState({ publicKey: 'GOTHER' });
    rerender();

    await waitFor(() => expect(mockGetUserRank).toHaveBeenCalledWith('GOTHER'));
  });
});
