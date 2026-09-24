import { useQuery } from "@tanstack/react-query";
import { getLeaderboard, getUserRank, type UserRank } from "@/lib/contracts";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import type { UserProfile } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";

const DEFAULT_LEADERBOARD_LIMIT = 50;

export function useLeaderboard(limit = DEFAULT_LEADERBOARD_LIMIT) {
  return useQuery<UserProfile[]>({
    queryKey: qk.leaderboard(limit),
    queryFn: () => getLeaderboard(limit),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/**
 * The connected wallet's own leaderboard standing.
 *
 * `useLeaderboard` only ever returns the top N, so every user outside that
 * cutoff sees a table they are not in. This resolves their position
 * separately — from the registry's `get_rank` when they sit below the
 * scanned window, otherwise from the leaderboard ordering itself.
 *
 * Resolves to `null` for an address with no registry profile, and the query
 * stays disabled entirely while no wallet is connected, so a visitor never
 * triggers a contract call.
 */
export function useRank() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<UserRank | null>({
    queryKey: ["rank", publicKey],
    queryFn: () => (publicKey ? getUserRank(publicKey) : Promise.resolve(null)),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: 15_000,
    gcTime: 120_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
