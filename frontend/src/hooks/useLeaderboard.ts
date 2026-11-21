'use client';
import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getTotalUsers } from '@/lib/contracts';
import { LEADERBOARD_LIMIT, POLL_INTERVAL_MS } from '@/lib/constants';
import type { UserProfile } from '@/types';

export function useLeaderboard() {
  const { data: rankings = [], isLoading, error, refetch } = useQuery<UserProfile[]>({
    queryKey: ['leaderboard'],
    queryFn: () => getLeaderboard(LEADERBOARD_LIMIT),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: totalUsers = 0 } = useQuery<number>({
    queryKey: ['totalUsers'],
    queryFn: () => getTotalUsers(),
    refetchInterval: POLL_INTERVAL_MS,
  });

  return { rankings, totalUsers, isLoading, error, refetch };
}
