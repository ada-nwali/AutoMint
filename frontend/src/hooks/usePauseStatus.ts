import { useQuery } from "@tanstack/react-query";
import { isMarketplacePaused, isTokenPaused } from "@/lib/contracts";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";

export interface PauseStatus {
  /** Marketplace `is_paused()`: listing, buying, price updates and offers fail. */
  marketplacePaused: boolean;
  /** Token `paused()`: AMT transfers/mints fail, so buys, paid mints and claims fail. */
  tokenPaused: boolean;
}

/**
 * Polls both pause switches (#1416) so the UI can warn before a buy, list or
 * claim fails on-chain. A failed read of either flag is treated as "not
 * paused" — the contract still rejects the call, and a flaky RPC must not
 * lock every button.
 */
export function usePauseStatus() {
  const query = useQuery<PauseStatus>({
    queryKey: qk.pauseStatus(),
    queryFn: async () => {
      const [marketplace, token] = await Promise.allSettled([
        isMarketplacePaused(),
        isTokenPaused(),
      ]);
      return {
        marketplacePaused: marketplace.status === "fulfilled" && marketplace.value,
        tokenPaused: token.status === "fulfilled" && token.value,
      };
    },
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.STANDARD,
  });

  const marketplacePaused = query.data?.marketplacePaused ?? false;
  const tokenPaused = query.data?.tokenPaused ?? false;

  return {
    ...query,
    marketplacePaused,
    tokenPaused,
    /** `buy_bot` needs both: the marketplace call and the AMT payment transfer. */
    buyPaused: marketplacePaused || tokenPaused,
    /** `list_bot` / `update_price` are gated by the marketplace switch only. */
    listPaused: marketplacePaused,
    /** `claim` mints AMT and paid `mint_tier` transfers AMT. */
    claimPaused: tokenPaused,
    mintPaused: tokenPaused,
  };
}
