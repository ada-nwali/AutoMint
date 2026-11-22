import { useQuery } from "@tanstack/react-query";
import { getAccrualStates, MAX_ACCRUAL_BATCH } from "@/lib/contracts";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";
import type { AccrualState } from "@/types";

/**
 * Accrual states for the leaderboard rows, fetched with one contract call per
 * poll instead of one `get_accrual_state` simulation per row (#420).
 *
 * Resolves to a map from address to its accrual state (`null` for an address
 * with no accrual record). At most `MAX_ACCRUAL_BATCH` rows are queried.
 */
export function useLeaderboardAccruals(addresses: string[]) {
  const batch = addresses.filter(Boolean).slice(0, MAX_ACCRUAL_BATCH);

  return useQuery<Record<string, AccrualState | null>>({
    queryKey: qk.leaderboardAccruals(batch),
    queryFn: async () => {
      const states = await getAccrualStates(batch);
      return Object.fromEntries(batch.map((address, index) => [address, states[index] ?? null]));
    },
    enabled: batch.length > 0,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}
