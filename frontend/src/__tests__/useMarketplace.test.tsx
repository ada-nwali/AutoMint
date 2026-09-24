import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useBuyBot,
  useMintTierBot,
  useListings,
  useMyListings,
  useListBot,
  useCancelListing,
} from '../hooks/useMarketplace';
import { getActiveListings, getUserListings } from '@/lib/contracts';
import { executeTransaction } from '@/lib/transaction';
import { useWalletStore } from '@/store/walletStore';
import { toast } from 'sonner';
import type { MarketplaceListing } from '@/types';

// Mock dependencies
jest.mock('@/lib/contracts');
jest.mock('@/lib/transaction', () => ({
  executeTransaction: jest.fn(),
}));
jest.mock('@/store/walletStore', () => ({
  ...jest.requireActual('@/store/walletStore'),
  useWalletStore: jest.fn(),
}));
jest.mock('sonner');

const mockGetActiveListings = getActiveListings as jest.MockedFunction<typeof getActiveListings>;
const mockGetUserListings = getUserListings as jest.MockedFunction<typeof getUserListings>;
const mockExecuteTransaction = executeTransaction as jest.MockedFunction<
  typeof executeTransaction
>;
const mockUseWalletStore = useWalletStore as jest.MockedFunction<typeof useWalletStore>;

describe('useMarketplace Hooks', () => {
  let queryClient: QueryClient;
  // A structurally valid ed25519 public key — nativeToScVal(..., {type:
  // "address"}) rejects placeholder strings like "GABC123456".
  const mockPublicKey = 'GD6VCGW7N4YUZUG2VKRN4DKIXGTBJZTZBV5ICATW2YCDCOS36VYPXAR3';

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    jest.clearAllMocks();

    // Default wallet store mock
    (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({ publicKey: mockPublicKey })
    );

    // Every transaction "confirms" immediately unless a test overrides it.
    mockExecuteTransaction.mockImplementation(async (opts) => {
      opts.onStatus({ stage: 'success', explorerUrl: 'https://explorer.test/tx/1' });
      return 'ok';
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useBuyBot', () => {
    it('should successfully purchase a bot', async () => {
      const { result } = renderHook(() => useBuyBot(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
      const call = mockExecuteTransaction.mock.calls[0][0];
      expect(call.method).toBe('buy_bot');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(toast.success).toHaveBeenCalledWith(
        'Bot purchased successfully!',
        expect.objectContaining({ id: 'buy_bot' })
      );
    });

    it('should handle error when purchasing bot fails', async () => {
      const error = new Error('Insufficient funds');
      mockExecuteTransaction.mockImplementation((opts) => {
        opts.onStatus({ stage: 'error', error: 'Insufficient funds' });
        return Promise.reject(error);
      });

      const { result } = renderHook(() => useBuyBot(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Purchase failed: Insufficient funds', {
        id: 'buy_bot',
      });
    });

    it('should throw error when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useBuyBot(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(new Error('Wallet not connected'));
      expect(mockExecuteTransaction).not.toHaveBeenCalled();
    });
  });

  describe('useMintTierBot', () => {
    it('should successfully mint a tier bot', async () => {
      const { result } = renderHook(() => useMintTierBot(), { wrapper });

      act(() => {
        result.current.mutate({ tier: 'Advanced', token: mockPublicKey });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
      const call = mockExecuteTransaction.mock.calls[0][0];
      expect(call.method).toBe('mint_tier');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(toast.success).toHaveBeenCalledWith(
        'Tier bot minted successfully!',
        expect.objectContaining({ id: 'mint_tier' })
      );
    });

    it('should handle error when minting fails', async () => {
      const error = new Error('Minting failed');
      mockExecuteTransaction.mockImplementation((opts) => {
        opts.onStatus({ stage: 'error', error: 'Minting failed' });
        return Promise.reject(error);
      });

      const { result } = renderHook(() => useMintTierBot(), { wrapper });

      act(() => {
        result.current.mutate({ tier: 'Premium', token: mockPublicKey });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Mint failed: Minting failed', {
        id: 'mint_tier',
      });
    });
  });

  describe('useListings', () => {
    it('should return loading state initially', () => {
      mockGetActiveListings.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useListings(), { wrapper });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();
    });

    it('should successfully fetch active listings', async () => {
      const mockListings: MarketplaceListing[] = [
        { id: 1n, seller: 'SELLER1', bot_id: 1n, price: 100n, listed_at: 1n },
        { id: 2n, seller: 'SELLER2', bot_id: 2n, price: 200n, listed_at: 2n },
      ];

      mockGetActiveListings.mockResolvedValue(mockListings);

      const { result } = renderHook(() => useListings(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockListings);
    });

    it('should handle error when fetching listings fails', async () => {
      const error = new Error('Failed to fetch listings');
      mockGetActiveListings.mockRejectedValue(error);

      const { result } = renderHook(() => useListings(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useMyListings', () => {
    it('should fetch user listings when wallet connected', async () => {
      const mockListings: MarketplaceListing[] = [
        { id: 1n, seller: mockPublicKey, bot_id: 1n, price: 100n, listed_at: 1n },
      ];

      mockGetUserListings.mockResolvedValue(mockListings);

      const { result } = renderHook(() => useMyListings(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockGetUserListings).toHaveBeenCalledWith(mockPublicKey);
      expect(result.current.data).toEqual(mockListings);
    });

    it('should return empty array when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useMyListings(), { wrapper });

      expect(result.current.data).toBeUndefined();
      expect(mockGetUserListings).not.toHaveBeenCalled();
    });
  });

  describe('useListBot', () => {
    it('should successfully list a bot', async () => {
      const { result } = renderHook(() => useListBot(), { wrapper });

      act(() => {
        result.current.mutate({ botId: 1n, price: 500n });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
      const call = mockExecuteTransaction.mock.calls[0][0];
      expect(call.method).toBe('list_bot');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(toast.success).toHaveBeenCalledWith(
        'Bot listed successfully!',
        expect.objectContaining({ id: 'list_bot' })
      );
    });

    it('should handle error when listing fails', async () => {
      const error = new Error('Listing failed');
      mockExecuteTransaction.mockImplementation((opts) => {
        opts.onStatus({ stage: 'error', error: 'Listing failed' });
        return Promise.reject(error);
      });

      const { result } = renderHook(() => useListBot(), { wrapper });

      act(() => {
        result.current.mutate({ botId: 1n, price: 500n });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Listing failed: Listing failed', {
        id: 'list_bot',
      });
    });
  });

  describe('useCancelListing', () => {
    it('should successfully cancel a listing', async () => {
      const { result } = renderHook(() => useCancelListing(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
      const call = mockExecuteTransaction.mock.calls[0][0];
      expect(call.method).toBe('cancel_listing');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(toast.success).toHaveBeenCalledWith(
        'Listing cancelled successfully!',
        expect.objectContaining({ id: 'cancel_listing' })
      );
    });

    it('should handle error when canceling fails', async () => {
      const error = new Error('Cancel failed');
      mockExecuteTransaction.mockImplementation((opts) => {
        opts.onStatus({ stage: 'error', error: 'Cancel failed' });
        return Promise.reject(error);
      });

      const { result } = renderHook(() => useCancelListing(), { wrapper });

      act(() => {
        result.current.mutate(1n);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Cancellation failed: Cancel failed', {
        id: 'cancel_listing',
      });
    });
  });
});
