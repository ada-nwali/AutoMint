'use client';
import { useQuery } from '@tanstack/react-query';
import { getLeaderboard } from '@/lib/contracts';
import type { UserProfile } from '@/types';

export function useProfiles(limit = 50) {
  return useQuery<UserProfile[]>({
    queryKey: ['profiles', limit],
    queryFn: () => getLeaderboard(limit),
  });
}
