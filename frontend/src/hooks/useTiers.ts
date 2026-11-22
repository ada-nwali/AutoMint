import { useQuery } from "@tanstack/react-query";
import { getAllTiers } from "@/lib/contracts";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";
import type { BotTier, TierInfo } from "@/types";

/**
 * Tier rates and prices read from the bot_nft contract (#478).
 *
 * Cached for the session: tier economics only change with a contract-side
 * update, which the next page load then reflects without a frontend deploy.
 * Only presentational fields (colour, emoji) live client-side in `TIER_META`.
 */
export function useTiers() {
  return useQuery<Record<BotTier, TierInfo>>({
    queryKey: qk.tiers(),
    queryFn: () => getAllTiers(),
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}
