import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useBuyBot,
  useMintTierBot,
  useListings,
  useMyListings,
  useListBot,
  useCancelListing,
  useTransferBot,
  useMinListingPrice,
} from '../hooks/useMarketplace';
import {
  getActiveListings,
  getUserListings,
  getMinListingPrice,
  buildMintTierArgs,
  buildTransferBotArgs,
  buildListBotArgs,
} from '@/lib/contracts';
import { scValToNative } from '@stellar/stellar-sdk';
import { executeTransaction, runTxWithToasts } from '@/lib/transaction';
import { useWalletStore } from '@/store/walletStore';
import { toast } from 'sonner';
import type { MarketplaceListing } from '@/types';

// Mock dependencies
jest.mock('@/lib/contracts');
jest.mock('@/lib/transaction', () => ({
  executeTransaction: jest.fn(),
  runTxWithToasts: jest.fn((params) =>
    new Promise((resolve, reject) => {
      const toast = jest.requireMock('sonner').toast;
      const pending = jest.requireMock('@/lib/transaction').executeTransaction({
        ...params,
        onStatus: (status: { stage: string; error?: string; explorerUrl?: string }) => {
          if (status.stage === 'success') {
            toast.success(params.successMessage, { id: params.id });
            resolve(status);
          }
        },
      });
      Promise.resolve(pending).then(resolve, reject);
    })
  ),
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
const mockRunTxWithToasts = runTxWithToasts as jest.MockedFunction<
  typeof runTxWithToasts
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
    mockRunTxWithToasts.mockClear();

    // `@/lib/contracts` is automocked; the pure ScVal arg builders are not
    // RPC calls, so use the real encoders and assert on their output.
    const actualContracts = jest.requireActual('@/lib/contracts');
    (buildMintTierArgs as jest.Mock).mockImplementation(actualContracts.buildMintTierArgs);
    (buildTransferBotArgs as jest.Mock).mockImplementation(actualContracts.buildTransferBotArgs);
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
      expect(toast.error).toHaveBeenCalled();
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
        result.current.mutate({ tier: 'Bronze' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockRunTxWithToasts).toHaveBeenCalledTimes(1);
      const call = mockRunTxWithToasts.mock.calls[0][0];
      expect(call.method).toBe('mint_tier');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(call.args).toHaveLength(2);
      // BotTier is a repr(u32) contracttype enum: Bronze = 1, sent as ScU32.
      expect(call.args[0].switch().name).toBe('scvAddress');
      expect(call.args[1].switch().name).toBe('scvU32');
      expect(scValToNative(call.args[1])).toBe(1);
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
        result.current.mutate({ tier: 'Silver' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalled();
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
        { id: 1n, seller: 'SELLER1', bot_id: 1n, bot_tier: 'Basic', price: 100n, currency: 'CCUR', listed_at: 1n, active: true },
        { id: 2n, seller: 'SELLER2', bot_id: 2n, bot_tier: 'Gold', price: 200n, currency: 'CCUR', listed_at: 2n, active: true },
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
        { id: 1n, seller: mockPublicKey, bot_id: 1n, bot_tier: 'Basic', price: 100n, currency: 'CCUR', listed_at: 1n, active: true },
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
      expect(toast.error).toHaveBeenCalled();
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
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('useTransferBot', () => {
    const recipient = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

    it('sends transfer(bot_id, from, to) on bot_nft from the connected wallet', async () => {
      const { result } = renderHook(() => useTransferBot(), { wrapper });

      act(() => {
        result.current.mutate({ botId: 7n, to: recipient });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const call = mockRunTxWithToasts.mock.calls[0][0];
      expect(call.method).toBe('transfer');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(call.args.map((a: { switch: () => { name: string } }) => a.switch().name)).toEqual([
        'scvU64',
        'scvAddress',
        'scvAddress',
      ]);
      expect(call.args.map(scValToNative)).toEqual([7n, mockPublicKey, recipient]);
    });

    it('rolls back the optimistic removal when the transfer fails', async () => {
      queryClient.setQueryData(['bots', mockPublicKey], [7n, 8n]);
      mockExecuteTransaction.mockImplementation(() => Promise.reject(new Error('NotOwner')));

      const { result } = renderHook(() => useTransferBot(), { wrapper });

      act(() => {
        result.current.mutate({ botId: 7n, to: recipient });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(queryClient.getQueryData(['bots', mockPublicKey])).toEqual([7n, 8n]);
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('useMinListingPrice', () => {
    it('reads get_min_price for the given currency', async () => {
      (getMinListingPrice as jest.Mock).mockResolvedValue(40n);

      const { result } = renderHook(() => useMinListingPrice('CTOKEN'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe(40n);
      expect(getMinListingPrice).toHaveBeenCalledWith('CTOKEN');
    });

    it('stays idle without a currency', () => {
      const { result } = renderHook(() => useMinListingPrice(undefined), { wrapper });
      expect(result.current.fetchStatus).toBe('idle');
      expect(getMinListingPrice).not.toHaveBeenCalled();
    });
  });
});
