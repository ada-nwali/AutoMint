import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useRegister,
  useRegistered,
  useProfile,
  useBots,
  useAccrualState,
  useAmtBalance,
  useClaim,
  useAnimatedPoints,
} from '../hooks/useAccrual';
import {
  isRegistered,
  getUserProfile,
  getUserBots,
  getAccrualState,
  getAmtBalance,
  getUserTotalRate,
} from '@/lib/contracts';
import { executeTransaction } from '@/lib/transaction';
import { useWalletStore } from '@/store/walletStore';
import { qk } from '@/lib/queryKeys';
import { toast } from 'sonner';
import type { UserProfile, AccrualState } from '@/types';

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

const mockIsRegistered = isRegistered as jest.MockedFunction<typeof isRegistered>;
const mockGetUserProfile = getUserProfile as jest.MockedFunction<typeof getUserProfile>;
const mockGetUserBots = getUserBots as jest.MockedFunction<typeof getUserBots>;
const mockGetAccrualState = getAccrualState as jest.MockedFunction<typeof getAccrualState>;
const mockGetAmtBalance = getAmtBalance as jest.MockedFunction<typeof getAmtBalance>;
const mockGetUserTotalRate = getUserTotalRate as jest.MockedFunction<typeof getUserTotalRate>;
const mockExecuteTransaction = executeTransaction as jest.MockedFunction<
  typeof executeTransaction
>;
const mockUseWalletStore = useWalletStore as jest.MockedFunction<typeof useWalletStore>;

describe('useAccrual Hooks', () => {
  let queryClient: QueryClient;
  // A structurally valid ed25519 public key — nativeToScVal(..., {type:
  // "address"}) rejects placeholder strings like "GABC123".
  const mockPublicKey = 'GD6VCGW7N4YUZUG2VKRN4DKIXGTBJZTZBV5ICATW2YCDCOS36VYPXAR3';

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default wallet store mock
    (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({ publicKey: mockPublicKey })
    );

    // Every transaction "confirms" immediately unless a test overrides it.
    mockExecuteTransaction.mockImplementation(async (opts) => {
      opts.onStatus({ stage: 'success', explorerUrl: 'https://explorer.test/tx/1' });
      return 'ok';
    });
    // Default on-chain state: a completely fresh user.
    mockIsRegistered.mockResolvedValue(false);
    mockGetUserBots.mockResolvedValue([]);
    mockGetAccrualState.mockResolvedValue(null);

    // Contract IDs must be valid strkeys — useClaim runs them through
    // nativeToScVal(..., {type: "address"}).
    process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID =
      'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
    process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID =
      'CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ';
    process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID =
      'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useRegister', () => {
    it('runs all three steps sequentially for a fresh user (#452)', async () => {
      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Resume detection ran first.
      expect(mockIsRegistered).toHaveBeenCalledWith(mockPublicKey);
      expect(mockGetUserBots).toHaveBeenCalledWith(mockPublicKey);
      expect(mockGetAccrualState).toHaveBeenCalledWith(mockPublicKey);

      // Exactly three transactions, in pipeline order, each awaiting the
      // previous one's confirmation.
      const methods = mockExecuteTransaction.mock.calls.map(
        (call) => call[0].method
      );
      expect(methods).toEqual(['register', 'mint_basic', 'start_accrual']);
      for (const [call] of mockExecuteTransaction.mock.calls) {
        expect(call.sourceAddress).toBe(mockPublicKey);
      }

      expect(result.current.progress).toEqual({
        stepIndex: 3,
        step: 'done',
      });
      expect(toast.success).toHaveBeenCalledWith(
        'Registration complete! Welcome to AutoMint!'
      );
    });

    it('skips every step when the chain is already fully registered (#452)', async () => {
      mockIsRegistered.mockResolvedValue(true);
      mockGetUserBots.mockResolvedValue([1n]);
      mockGetAccrualState.mockResolvedValue({
        last_claim_ts: 1n,
        total_claimed_points: 0n,
      });

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockExecuteTransaction).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'Registration complete! Welcome to AutoMint!'
      );
    });

    it('resumes at the mint step when registration already landed (#452)', async () => {
      mockIsRegistered.mockResolvedValue(true);
      mockGetUserBots.mockResolvedValue([]);
      mockGetAccrualState.mockResolvedValue(null);

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const methods = mockExecuteTransaction.mock.calls.map(
        (call) => call[0].method
      );
      // register is NOT re-run — that would hit the registry's
      // already-registered error and trap the user.
      expect(methods).toEqual(['mint_basic', 'start_accrual']);
    });

    it('resumes at the accrual step when register and mint already landed (#452)', async () => {
      mockIsRegistered.mockResolvedValue(true);
      mockGetUserBots.mockResolvedValue([7n]);
      mockGetAccrualState.mockResolvedValue(null);

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const methods = mockExecuteTransaction.mock.calls.map(
        (call) => call[0].method
      );
      expect(methods).toEqual(['start_accrual']);
    });

    it('ends in a done progress state with no pending timers (#452)', async () => {
      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.progress).toEqual({ stepIndex: 3, step: 'done' });
      // No artificial delay: the mutation settles without timers (#452).
      expect(jest.getTimerCount()).toBe(0);
    });

    it('propagates a failed step and leaves later steps unrun (#452)', async () => {
      const error = new Error('Registration failed');
      mockExecuteTransaction.mockImplementation(() => Promise.reject(error));

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      // Stops after the first failure — no mint/accrual attempts.
      expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalledWith(
        'Registration complete! Welcome to AutoMint!'
      );
    });

    it('should throw error when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useRegister(), { wrapper });

      act(() => {
        result.current.mutate('testuser');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(new Error('Wallet not connected'));
      expect(mockIsRegistered).not.toHaveBeenCalled();
    });
  });

  describe('useRegistered', () => {
    it('should return true when user is registered', async () => {
      mockIsRegistered.mockResolvedValue(true);

      const { result } = renderHook(() => useRegistered(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(true);
      expect(mockIsRegistered).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should return false when user is not registered', async () => {
      mockIsRegistered.mockResolvedValue(false);

      const { result } = renderHook(() => useRegistered(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(false);
    });

    it('should handle error when check fails', async () => {
      const error = new Error('Check failed');
      mockIsRegistered.mockRejectedValue(error);

      const { result } = renderHook(() => useRegistered(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });

    it('should not fetch when wallet not connected', () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useRegistered(), { wrapper });

      expect(result.current.data).toBeUndefined();
      expect(mockIsRegistered).not.toHaveBeenCalled();
    });
  });

  describe('useProfile', () => {
    it('should return user profile when available', async () => {
      const mockProfile: UserProfile = {
        address: mockPublicKey,
        username: 'testuser',
        points: 1000n,
        claimedAmt: 500n,
        registeredAt: 1234567890n,
        botCount: 3,
      };

      mockGetUserProfile.mockResolvedValue(mockProfile);

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockProfile);
      expect(mockGetUserProfile).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should handle error when fetching profile fails', async () => {
      const error = new Error('Profile not found');
      mockGetUserProfile.mockRejectedValue(error);

      const { result } = renderHook(() => useProfile(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useBots', () => {
    it('should return bot IDs', async () => {
      const mockBots = [1n, 2n, 3n];
      mockGetUserBots.mockResolvedValue(mockBots);

      const { result } = renderHook(() => useBots(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockBots);
      expect(mockGetUserBots).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should return empty array when no bots', async () => {
      mockGetUserBots.mockResolvedValue([]);

      const { result } = renderHook(() => useBots(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });
  });

  describe('useAccrualState', () => {
    it('should return accrual state', async () => {
      const mockState: AccrualState = {
        last_claim_ts: 1234567890n,
        total_claimed_points: 1000n,
      };

      mockGetAccrualState.mockResolvedValue(mockState);

      const { result } = renderHook(() => useAccrualState(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockState);
      expect(mockGetAccrualState).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should handle null accrual state', async () => {
      mockGetAccrualState.mockResolvedValue(null);

      const { result } = renderHook(() => useAccrualState(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeNull();
    });
  });

  describe('useAmtBalance', () => {
    it('should return AMT balance', async () => {
      const mockBalance = 5000n;
      mockGetAmtBalance.mockResolvedValue(mockBalance);

      const { result } = renderHook(() => useAmtBalance(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockBalance);
      expect(mockGetAmtBalance).toHaveBeenCalledWith(mockPublicKey);
    });

    it('should handle error when fetching balance fails', async () => {
      const error = new Error('Balance fetch failed');
      mockGetAmtBalance.mockRejectedValue(error);

      const { result } = renderHook(() => useAmtBalance(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useClaim', () => {
    it('should successfully claim points', async () => {
      const { result } = renderHook(() => useClaim(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
      const call = mockExecuteTransaction.mock.calls[0][0];
      expect(call.method).toBe('claim');
      expect(call.sourceAddress).toBe(mockPublicKey);
      expect(toast.success).toHaveBeenCalledWith(
        'Points claimed successfully!',
        expect.objectContaining({ id: 'claim' })
      );
    });

    it('should handle error when claiming fails', async () => {
      const error = new Error('Claim failed');
      mockExecuteTransaction.mockImplementation((opts) => {
        opts.onStatus({ stage: 'error', error: 'Claim failed' });
        return Promise.reject(error);
      });

      const { result } = renderHook(() => useClaim(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(error);
      expect(toast.error).toHaveBeenCalledWith('Claim failed: Claim failed', {
        id: 'claim',
      });
    });

    it('should throw error when wallet not connected', async () => {
      (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
        selector({ publicKey: null })
      );

      const { result } = renderHook(() => useClaim(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toEqual(new Error('Wallet not connected'));
      expect(mockExecuteTransaction).not.toHaveBeenCalled();
    });
  });
});

describe('useAnimatedPoints (#491, #490)', () => {
  let qc: QueryClient;
  const pk = 'GABCUSER';

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.clearAllMocks();
    jest.useFakeTimers();
    (mockUseWalletStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector({ publicKey: pk })
    );
    // A single Basic bot unless a test says otherwise.
    mockGetUserTotalRate.mockResolvedValue(1n);
  });
  afterEach(() => jest.useRealTimers());

  const wrap = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it('bases the headline on the registry lifetime total plus pending, with the carry shown separately', async () => {
    const lastClaim = Math.floor(Date.now() / 1000) - 3600; // one hour ago
    mockGetUserProfile.mockResolvedValue({ username: 'u', points: 12_345n });
    mockGetAccrualState.mockResolvedValue({
      last_claim_ts: BigInt(lastClaim),
      total_claimed_points: 42n, // the sub-threshold carry, NOT a lifetime total
    });

    const { result } = renderHook(() => useAnimatedPoints(), { wrapper: wrap });

    // Waiting on the composite total also waits for profile (12,345) and the
    // interpolated pending (1 point at rate 1/hr over 3600s) to settle.
    await waitFor(() => {
      expect(result.current.total).toBe(12_346n);
    });
    expect(result.current.pending).toBe(1n);
    // The carry is surfaced separately as "progress to next AMT" — it is NOT
    // folded into the headline, which is the bug (#491).
    expect(result.current.progressToNext).toBe(42n);
  });

  it('never renders a total below the registry lifetime points across a claim', async () => {
    // Immediately after a claim: last_claim_ts is now, carry reset to a few.
    mockGetUserProfile.mockResolvedValue({ username: 'u', points: 1000n });
    mockGetAccrualState.mockResolvedValue({
      last_claim_ts: BigInt(Math.floor(Date.now() / 1000)),
      total_claimed_points: 3n,
    });

    const { result } = renderHook(() => useAnimatedPoints(), { wrapper: wrap });

    await waitFor(() => expect(result.current.total).toBe(1000n));
    expect(result.current.total).toBeGreaterThanOrEqual(1000n);
  });

  it('ticks at the on-chain total rate of a multi-bot account, not a default', async () => {
    // Basic (1) + Diamond (500) = 501 pts/hr, as reported by get_user_total_rate.
    mockGetUserTotalRate.mockResolvedValue(501n);
    mockGetUserProfile.mockResolvedValue({ username: 'u', points: 0n });
    mockGetAccrualState.mockResolvedValue({
      last_claim_ts: BigInt(Math.floor(Date.now() / 1000) - 3600), // one hour ago
      total_claimed_points: 0n,
    });

    const { result } = renderHook(() => useAnimatedPoints(), { wrapper: wrap });

    await waitFor(() => expect(result.current.pending).toBe(501n));
    expect(mockGetUserTotalRate).toHaveBeenCalledWith(pk);
  });

  it('changes the tick rate once a poll returns a new rate after the bots change', async () => {
    mockGetUserProfile.mockResolvedValue({ username: 'u', points: 0n });
    mockGetAccrualState.mockResolvedValue({
      last_claim_ts: BigInt(Math.floor(Date.now() / 1000) - 3600),
      total_claimed_points: 0n,
    });

    const { result } = renderHook(() => useAnimatedPoints(), { wrapper: wrap });
    await waitFor(() => expect(result.current.pending).toBe(1n));

    // The user buys a Gold bot. Bot-changing mutations invalidate qk.bots,
    // under which the total rate is keyed, so it refetches the new rate.
    mockGetUserTotalRate.mockResolvedValue(101n);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: qk.bots(pk) });
    });

    await waitFor(() => expect(result.current.pending).toBe(101n));
  });
});
