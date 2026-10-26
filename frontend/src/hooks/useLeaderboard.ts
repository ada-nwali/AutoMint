import { useQuery } from "@tanstack/react-query";
import {
  getLeaderboard,
  getLeaderboardForSeason,
  getSeason,
  getUserRank,
  type UserRank,
} from "@/lib/contracts";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import type { UserProfile } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";
import { LEADERBOARD_LIMIT } from "@/lib/constants";
export { useProfiles } from "./useProfiles";

/**
 * The leaderboard board to render (#371). With no `season` (or season `0`,
 * the registry default before any season has been started) this is the
 * all-time board; any positive season number fetches that season's board,
 * ranked by `season_points`.
 */
export function useLeaderboard(limit = LEADERBOARD_LIMIT, season?: number) {
  const activeSeason = season !== undefined && season > 0 ? season : undefined;
  return useQuery<UserProfile[]>({
    queryKey: qk.leaderboard(limit, activeSeason),
    queryFn: () =>
      activeSeason !== undefined
        ? getLeaderboardForSeason(activeSeason, limit)
        : getLeaderboard(limit),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/**
 * The registry's current season number (#371). `0` means no season has been
 * started yet — the leaderboard UI hides the season toggle until then.
 */
export function useSeason() {
  return useQuery<number>({
    queryKey: qk.season(),
    queryFn: () => getSeason(),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}

/**
 * The connected wallet's own leaderboard standing.
 *
 * `useLeaderboard` returns the top N rows (default 50). The registry contract's
 * `get_rank` queries the bounded on-chain TopUsers list (up to LEADERBOARD_SIZE = 100).
 * Users within the top 100 receive their 1-based rank; users outside the top 100
 * cutoff return UNRANKED (resolved as `null` rank).
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
