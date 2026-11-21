'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getUserProfile,
  getAccrualState,
  claimPoints,
  isRegistered,
  registerUser,
  mintBasicBot,
  startAccrual,
  getAmtBalance,
  getSecondsToNextAmt,
  getUserBotsDetailed,
} from '@/lib/contracts';
import { COUNTER_TICK_MS, POLL_INTERVAL_MS } from '@/lib/constants';
import type { BotNFT, UserProfile, AccrualState } from '@/types';

export interface DashboardData {
  bots: bigint[];
}

export interface UseAccrualReturn {
  profile: UserProfile | null;
  bots: BotNFT[];
  accrualState: AccrualState | null;
  amtBalance: bigint;
  displayedPoints: number;
  ratePerHour: number;
  isLoading: boolean;
  isClaiming: boolean;
  isRegistering: boolean;
  registered: boolean;
  secondsToNextAmt: bigint | null;
  claim: () => Promise<void>;
  register: (username: string) => Promise<void>;
  refetch: () => void;
}

export function useAccrual(publicKey: string | null): UseAccrualReturn {
  const qc = useQueryClient();
  const [displayedPoints, setDisplayedPoints] = useState(0);
  const animFrame = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data queries ─────────────────────────────────────────────────────────

  const { data: registered = false, isLoading: checkingReg } = useQuery({
    queryKey: ['registered', publicKey],
    queryFn: () => (publicKey ? isRegistered(publicKey) : false),
    enabled: !!publicKey,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: profile = null, isLoading: loadingProfile } = useQuery({
    queryKey: ['profile', publicKey],
    queryFn: () => getUserProfile(publicKey!),
    enabled: !!publicKey && registered,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: bots = [], isLoading: loadingBots } = useQuery({
    queryKey: ['bots', publicKey],
    queryFn: () => getUserBotsDetailed(publicKey!),
    enabled: !!publicKey && registered,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: accrualState = null } = useQuery({
    queryKey: ['accrualState', publicKey],
    queryFn: () => getAccrualState(publicKey!),
    enabled: !!publicKey && registered,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: amtBalance = 0n } = useQuery({
    queryKey: ['amtBalance', publicKey],
    queryFn: () => getAmtBalance(publicKey!),
    enabled: !!publicKey && registered,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: secondsToNextAmt = null } = useQuery({
    queryKey: ['secondsToNextAmt', publicKey],
    queryFn: () => getSecondsToNextAmt(publicKey!),
    enabled: !!publicKey && registered,
    refetchInterval: POLL_INTERVAL_MS,
  });

  // ── Compute rate per hour ─────────────────────────────────────────────────

  const ratePerHour = bots.reduce(
    (sum, b) => sum + Number(b.accrualRate ?? b.accrual_rate ?? 0n),
    0
  );

  // ── Animated points counter ───────────────────────────────────────────────

  useEffect(() => {
    if (animFrame.current) clearInterval(animFrame.current);

    const basePoints = Number(profile?.totalPoints ?? 0);

    if (!accrualState) {
      setDisplayedPoints(basePoints);
      return;
    }

    const lastClaimTs = Number(accrualState.lastClaimTs ?? accrualState.last_claim_ts);

    animFrame.current = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const elapsed = Math.max(0, nowSec - lastClaimTs);
      const accrued = Math.floor((elapsed * ratePerHour) / 3600);
      setDisplayedPoints(basePoints + accrued);
    }, COUNTER_TICK_MS);

    return () => {
      if (animFrame.current) clearInterval(animFrame.current);
    };
  }, [accrualState, profile, ratePerHour]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const { mutateAsync: doClaim, isPending: isClaiming } = useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error('Wallet not connected');
      return claimPoints(publicKey);
    },
    onSuccess: () => {
      toast.success('Points claimed!');
      qc.invalidateQueries({ queryKey: ['profile', publicKey] });
      qc.invalidateQueries({ queryKey: ['accrualState', publicKey] });
      qc.invalidateQueries({ queryKey: ['amtBalance', publicKey] });
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (err) => {
      toast.error(`Claim failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const { mutateAsync: doRegister, isPending: isRegistering } = useMutation({
    mutationFn: async (username: string) => {
      if (!publicKey) throw new Error('Wallet not connected');
      toast.loading('Registering...', { id: 'register' });
      await registerUser(publicKey, username);
      toast.loading('Minting Basic Bot...', { id: 'register' });
      await mintBasicBot(publicKey);
      toast.loading('Starting accrual...', { id: 'register' });
      await startAccrual(publicKey);
      toast.dismiss('register');
    },
    onSuccess: () => {
      toast.success('Welcome to AutoMint! Your Basic Bot is now earning.');
      qc.invalidateQueries({ queryKey: ['registered', publicKey] });
      // Small delay so the ledger state settles before re-querying
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['profile', publicKey] });
        qc.invalidateQueries({ queryKey: ['bots', publicKey] });
        qc.invalidateQueries({ queryKey: ['accrualState', publicKey] });
        qc.invalidateQueries({ queryKey: ['amtBalance', publicKey] });
      }, 3000);
    },
    onError: (err) => {
      toast.dismiss('register');
      toast.error(`Registration failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const refetch = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['profile', publicKey] });
    qc.invalidateQueries({ queryKey: ['bots', publicKey] });
    qc.invalidateQueries({ queryKey: ['accrualState', publicKey] });
    qc.invalidateQueries({ queryKey: ['amtBalance', publicKey] });
  }, [qc, publicKey]);

  const isLoading = checkingReg || loadingProfile || loadingBots;

  return {
    profile,
    bots,
    accrualState,
    amtBalance,
    displayedPoints,
    ratePerHour,
    isLoading,
    isClaiming,
    isRegistering,
    registered,
    secondsToNextAmt,
    claim: async () => { await doClaim(); },
    register: async (username: string) => { await doRegister(username); },
    refetch,
  };
}
