import { useQuery } from "@tanstack/react-query";
import {
  getLeaderboard,
  getLeaderboardForSeason,
  getSeason,
  getUserRank,
  getUserSeasonRank,
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
 * `useLeaderboard` only ever returns the top N, so every user outside that
 * cutoff sees a table they are not in. This resolves their position
 * separately — from the registry's `get_rank` when they sit below the
 * scanned window, otherwise from the leaderboard ordering itself.
 *
 * Resolves to `null` for an address with no registry profile, and the query
 * stays disabled entirely while no wallet is connected, so a visitor never
 * triggers a contract call.
 */
export function useRank(season?: number) {
  const publicKey = useWalletStore(selectPublicKey);
  const activeSeason = season !== undefined && season > 0 ? season : undefined;

  return useQuery<UserRank | null>({
    queryKey: ["rank", publicKey, activeSeason],
    queryFn: () => {
      if (!publicKey) return Promise.resolve(null);
      return activeSeason !== undefined
        ? getUserSeasonRank(activeSeason, publicKey)
        : getUserRank(publicKey);
    },
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: 15_000,
    gcTime: 120_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
