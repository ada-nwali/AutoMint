import { useQuery } from "@tanstack/react-query";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { getBotById, getUserBotsDetailed } from "@/lib/contracts";
import { ANONYMOUS_READ_SOURCE } from "@/lib/constants";
import type { BotNFT } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { qk, STALE_TIME, GC_TIME } from "@/lib/queryKeys";

export function useBotDetails(botId: bigint) {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<BotNFT | null>({
    queryKey: qk.botDetails(publicKey, botId),
    queryFn: () => (publicKey ? getBotById(publicKey, botId) : Promise.resolve(null)),
    enabled: !!publicKey && botId > BigInt(0),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}

export function useAllBotDetails(botIds: bigint[]) {
  const publicKey = useWalletStore(selectPublicKey);
  // Bot ownership details are public data. Fall back to the configured
  // anonymous read source so disconnected visitors still see bot tier/rate
  // on the marketplace; the dashboard always has a wallet and is unaffected.
  const source = publicKey ?? ANONYMOUS_READ_SOURCE;

  return useQuery<BotNFT[]>({
    queryKey: qk.allBotDetails(publicKey, botIds),
    queryFn: async () => {
      if (!source || botIds.length === 0) return [];
      // One capped contract round trip covers every bot the source account
      // owns (#483) -- a 10-bot dashboard makes one request per poll instead
      // of ten getBotById simulations.
      const detailed = await getUserBotsDetailed(source);
      const byId = new Map<bigint, BotNFT>();
      for (const bot of detailed) byId.set(bot.id, bot);

      // Only ids the detailed call did not cover fall back to the per-id
      // path: bots beyond the contract-side cap, or bots not owned by
      // `source` (e.g. marketplace escrow held under the contract address).
      const missing = botIds.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map((id) => getBotById(source, id).catch(() => null))
        );
        for (const bot of fetched) {
          if (bot) byId.set(bot.id, bot);
        }
      }

      return botIds
        .map((id) => byId.get(id))
        .filter((bot): bot is BotNFT => bot !== undefined);
    },
    enabled: !!source && botIds.length > 0,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}
