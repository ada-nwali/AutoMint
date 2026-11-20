import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getActiveListings,
  getUserListings,
  getMarketStats,
  getMarketplaceConfig,
  buildListBotArgs,
  getTokenDecimals,
  getTokenSymbol,
  getMinListingPrice,
  getTierRemaining,
  buildMintTierArgs,
  buildTransferBotArgs,
} from "@/lib/contracts";
import { runTxWithToasts } from "@/lib/transaction";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import type { BotTier, MarketplaceListing } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";
import { trackStatus, newTxId } from "@/components/ui/TxStatus";
import type { DashboardData } from "./useAccrual";
import { toastContractError } from "@/lib/errors";
import { CONTRACT_ADDRESSES } from "@/lib/constants";
import { addressToScVal, u64ToScVal } from "@/lib/stellar";
import { errorAnalyticsProps, useAnalytics } from "@/lib/analytics";
export { useProfiles } from "./useProfiles";

export function useBuyBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);
  const { track } = useAnalytics(publicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("buy_bot");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "buy_bot",
        args: [addressToScVal(publicKey), u64ToScVal(listingId)],
        sourceAddress: publicKey,
        id: "buy_bot",
        label: "purchase",
        successMessage: "Bot purchased successfully!",
      });
      trackStatus(txId, "Purchase", status);
      return status;
    },
    onMutate: async (listingId: bigint) => {
      track("marketplace_buy_started");
      // Optimistic update (#462): drop the bought listing immediately.
      await queryClient.cancelQueries({ queryKey: qk.listings() });
      await queryClient.cancelQueries({ queryKey: qk.myListings(publicKey) });
      const previousListings = queryClient.getQueryData(qk.listings());
      const previousMyListings = queryClient.getQueryData(qk.myListings(publicKey));
      const without = (old: MarketplaceListing[] | undefined) =>
        old ? old.filter((l) => l.id !== listingId) : old;
      queryClient.setQueryData(qk.listings(), without);
      queryClient.setQueryData(qk.myListings(publicKey), without);
      return { previousListings, previousMyListings };
    },
    onSuccess: () => {
      track("marketplace_buy_success");
    },
    onError: (
      error: Error,
      _variables: bigint,
      context: { previousListings: unknown; previousMyListings: unknown } | undefined,
    ) => {
      track("marketplace_buy_failed", errorAnalyticsProps(error));
      if (context) {
        queryClient.setQueryData(qk.listings(), context.previousListings);
        queryClient.setQueryData(qk.myListings(publicKey), context.previousMyListings);
      }
      toastContractError(error, "marketplace");
      console.error("Bot purchase failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
  });
}

export function useMintTierBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    // mint_tier(owner: Address, tier: BotTier) — BotTier is a repr(u32) enum
    // (0=Basic, 1=Bronze, 2=Silver, 3=Gold, 4=Diamond). The contract pulls
    // the tier price from `owner` in its configured payment token.
    mutationFn: async ({ tier }: { tier: BotTier }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("mint_tier");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.botNft,
        method: "mint_tier",
        args: buildMintTierArgs(publicKey, tier),
        sourceAddress: publicKey,
        id: "mint_tier",
        label: "mint",
        successMessage: "Tier bot minted successfully!",
      });
      trackStatus(txId, "Mint", status);
      return status;
    },
    onSuccess: (_status, { tier }) => {
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.amtBalance(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.tierRemaining(tier) });
    },
    onError: (error: Error) => {
      toastContractError(error, "botNft");
      console.error("Bot mint failed:", error);
    },
  });
}

/**
 * Remaining mint slots for `tier` (bot_nft `tier_remaining`). `TIER_UNCAPPED`
 * (u64::MAX) means the tier has no cap.
 */
export function useTierRemaining(tier: BotTier) {
  return useQuery<bigint>({
    queryKey: qk.tierRemaining(tier),
    queryFn: () => getTierRemaining(tier),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.STANDARD,
  });
}

/**
 * The marketplace's minimum listing price for `currency` (#1417). `list_bot`
 * rejects anything lower with `PriceTooLow`, so the form validates against
 * this before asking for a signature. Admin-configurable, so it is not
 * cached for the whole session.
 */
export function useMinListingPrice(currency: string | undefined) {
  return useQuery<bigint>({
    queryKey: qk.minListingPrice(currency ?? ""),
    queryFn: () => getMinListingPrice(currency!),
    enabled: Boolean(currency),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.LONG,
  });
}

/**
 * Send a bot to another address via bot_nft `transfer(bot_id, from, to)`
 * (#1415) — no listing, no marketplace fee.
 */
export function useTransferBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async ({ botId, to }: { botId: bigint; to: string }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("transfer_bot");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.botNft,
        method: "transfer",
        args: buildTransferBotArgs(botId, publicKey, to),
        sourceAddress: publicKey,
        id: "transfer_bot",
        label: "transfer",
        successMessage: "Bot sent successfully!",
      });
      trackStatus(txId, "Transfer", status);
      return status;
    },
    onMutate: async ({ botId }: { botId: bigint; to: string }) => {
      // Optimistic update (#462): the bot leaves the owned list immediately.
      await queryClient.cancelQueries({ queryKey: qk.bots(publicKey) });
      await queryClient.cancelQueries({ queryKey: qk.dashboard(publicKey) });
      const previousBots = queryClient.getQueryData(qk.bots(publicKey));
      const previousDashboard = queryClient.getQueryData(qk.dashboard(publicKey));
      queryClient.setQueryData(qk.bots(publicKey), (old: bigint[] | undefined) =>
        old ? old.filter((id) => id !== botId) : old,
      );
      queryClient.setQueryData(qk.dashboard(publicKey), (old: DashboardData | undefined) =>
        old ? { ...old, bots: old.bots.filter((id) => id !== botId) } : old,
      );
      return { previousBots, previousDashboard };
    },
    onError: (
      error: Error,
      _variables: { botId: bigint; to: string },
      context: { previousBots: unknown; previousDashboard: unknown } | undefined,
    ) => {
      if (context) {
        queryClient.setQueryData(qk.bots(publicKey), context.previousBots);
        queryClient.setQueryData(qk.dashboard(publicKey), context.previousDashboard);
      }
      toastContractError(error, "botNft");
      console.error("Bot transfer failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
  });
}

export function useListings() {
  return useQuery({
    queryKey: qk.listings(),
    queryFn: () => getActiveListings(),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/** Per-tier sales statistics: volume, sale count, last sale price and floor (#432). */
export function useMarketStats() {
  return useQuery({
    queryKey: qk.marketStats(),
    queryFn: () => getMarketStats(),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/**
 * On-chain marketplace fee configuration. Fetched once per session
 * (`STALE_TIME.STATIC`): it only changes when the admin calls `set_fee_bps`,
 * and every fee preview must read it instead of a hardcoded 2.5%.
 */
export function useMarketplaceConfig() {
  return useQuery({
    queryKey: qk.marketplaceConfig(),
    queryFn: () => getMarketplaceConfig(),
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}

export function useMyListings() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery({
    queryKey: qk.myListings(publicKey),
    queryFn: () => (publicKey ? getUserListings(publicKey) : Promise.resolve([])),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

export function useListBot() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async ({ botId, price }: { botId: bigint; price: bigint }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("list_bot");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "list_bot",
        // list_bot(seller, bot_id, price, currency): the connected wallet is
        // the seller whose auth the contract requires; currency is the
        // configured payment token.
        args: buildListBotArgs(publicKey, botId, price),
        sourceAddress: publicKey,
        id: "list_bot",
        label: "listing",
        successMessage: "Bot listed successfully!",
      });
      trackStatus(txId, "Listing", status);
      return status;
    },
    onMutate: async ({ botId }: { botId: bigint; price: bigint }) => {
      // Optimistic update (#462): remove the bot from the owned list.
      await queryClient.cancelQueries({ queryKey: qk.bots(publicKey) });
      await queryClient.cancelQueries({ queryKey: qk.dashboard(publicKey) });
      const previousBots = queryClient.getQueryData(qk.bots(publicKey));
      const previousDashboard = queryClient.getQueryData(qk.dashboard(publicKey));
      queryClient.setQueryData(qk.bots(publicKey), (old: bigint[] | undefined) =>
        old ? old.filter((id) => id !== botId) : old,
      );
      queryClient.setQueryData(qk.dashboard(publicKey), (old: DashboardData | undefined) =>
        old ? { ...old, bots: old.bots.filter((id) => id !== botId) } : old,
      );
      return { previousBots, previousDashboard };
    },
    onError: (
      error: Error,
      _variables: { botId: bigint; price: bigint },
      context: { previousBots: unknown; previousDashboard: unknown } | undefined,
    ) => {
      if (context) {
        queryClient.setQueryData(qk.bots(publicKey), context.previousBots);
        queryClient.setQueryData(qk.dashboard(publicKey), context.previousDashboard);
      }
      toastContractError(error, "marketplace");
      console.error("Bot listing failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
    },
  });
}

export function useCancelListing() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("cancel_listing");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "cancel_listing",
        args: [addressToScVal(publicKey), u64ToScVal(listingId)],
        sourceAddress: publicKey,
        id: "cancel_listing",
        label: "cancellation",
        successMessage: "Listing cancelled successfully!",
      });
      trackStatus(txId, "Cancellation", status);
      return status;
    },
    onMutate: async (listingId: bigint) => {
      // Optimistic update (#462): drop the cancelled listing immediately.
      await queryClient.cancelQueries({ queryKey: qk.listings() });
      await queryClient.cancelQueries({ queryKey: qk.myListings(publicKey) });
      const previousListings = queryClient.getQueryData(qk.listings());
      const previousMyListings = queryClient.getQueryData(qk.myListings(publicKey));
      const without = (old: MarketplaceListing[] | undefined) =>
        old ? old.filter((l) => l.id !== listingId) : old;
      queryClient.setQueryData(qk.listings(), without);
      queryClient.setQueryData(qk.myListings(publicKey), without);
      return { previousListings, previousMyListings };
    },
    onError: (
      error: Error,
      _variables: bigint,
      context: { previousListings: unknown; previousMyListings: unknown } | undefined,
    ) => {
      if (context) {
        queryClient.setQueryData(qk.listings(), context.previousListings);
        queryClient.setQueryData(qk.myListings(publicKey), context.previousMyListings);
      }
      toastContractError(error, "marketplace");
      console.error("Listing cancellation failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
    },
  });
}

/**
 * Fetch the `decimals()` of an arbitrary SEP-41 currency contract.
 * Results are cached permanently (`STALE_TIME.STATIC`) — token decimals are
 * immutable after deployment.
 */
export function useTokenDecimals(contractId: string | undefined) {
  const publicKey = useWalletStore(selectPublicKey);
  return useQuery<number>({
    queryKey: qk.tokenDecimals(contractId ?? ""),
    queryFn: () => getTokenDecimals(contractId!, publicKey ?? undefined),
    enabled: Boolean(contractId),
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}

/**
 * Fetch the `symbol()` of an arbitrary SEP-41 currency contract.
 * Falls back to a truncated address if the contract does not expose `symbol`.
 * Cached permanently — token symbols are immutable after deployment.
 */
export function useTokenSymbol(contractId: string | undefined) {
  const publicKey = useWalletStore(selectPublicKey);
  return useQuery<string>({
    queryKey: qk.tokenSymbol(contractId ?? ""),
    queryFn: () => getTokenSymbol(contractId!, publicKey ?? undefined),
    enabled: Boolean(contractId),
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}
