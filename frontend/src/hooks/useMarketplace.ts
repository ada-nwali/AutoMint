import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getActiveListings,
  getUserListings,
  getMarketStats,
  getMarketplaceConfig,
  buildListBotArgs,
  buildUpdatePriceArgs,
  buildReclaimExpiredArgs,
  buildAcceptOfferArgs,
  buildDismissOfferArgs,
  getOffersForBot,
  getTokenDecimals,
  getTokenSymbol,
  getMinListingPrice,
  getUserOffers,
  getTierRemaining,
  buildMintTierArgs,
  buildTransferBotArgs,
} from "@/lib/contracts";
import { runTxWithToasts } from "@/lib/transaction";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import type { BotTier, MarketplaceListing, MarketplaceOffer, BotOffer } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk } from "@/lib/queryKeys";
import { trackStatus, newTxId } from "@/components/ui/TxStatus";
import type { DashboardData } from "./useAccrual";
import { useBots } from "./useAccrual";
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

export function useMyOffers() {
  const publicKey = useWalletStore(selectPublicKey);
  return useQuery({
    queryKey: ["marketplace", "offers", publicKey],
    queryFn: () => (publicKey ? getUserOffers(publicKey) : Promise.resolve([])),
    enabled: Boolean(publicKey),
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

export function useCancelOffer() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);
  return useMutation({
    mutationFn: async (offerId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const txId = newTxId("cancel_offer");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "cancel_offer",
        args: [addressToScVal(publicKey), u64ToScVal(offerId)],
        sourceAddress: publicKey,
        id: "cancel_offer",
        label: "offer cancellation",
        successMessage: "Offer cancelled and refunded!",
      });
      trackStatus(txId, "Offer cancellation", status);
      return status;
    },
    onMutate: async (offerId: bigint) => {
      const key = ["marketplace", "offers", publicKey];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MarketplaceOffer[]>(key);
      queryClient.setQueryData<MarketplaceOffer[]>(key, (offers = []) => offers.filter((offer) => offer.id !== offerId));
      return { previous, key };
    },
    onError: (error: Error, _offerId, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      toastContractError(error, "marketplace");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["marketplace", "offers", publicKey] }),
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

/**
 * Update the price of an active listing via `update_price` (#1406).
 */
export function useUpdatePrice() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async ({
      listingId,
      newPrice,
    }: {
      listingId: bigint;
      newPrice: bigint;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("update_price");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "update_price",
        args: buildUpdatePriceArgs(publicKey, listingId, newPrice),
        sourceAddress: publicKey,
        id: "update_price",
        label: "price update",
        successMessage: "Listing price updated successfully!",
      });
      trackStatus(txId, "Price Update", status);
      return status;
    },
    onMutate: async ({ listingId, newPrice }) => {
      await queryClient.cancelQueries({ queryKey: qk.listings() });
      await queryClient.cancelQueries({ queryKey: qk.myListings(publicKey) });
      const previousListings = queryClient.getQueryData(qk.listings());
      const previousMyListings = queryClient.getQueryData(qk.myListings(publicKey));

      const update = (old: MarketplaceListing[] | undefined) =>
        old ? old.map((l) => (l.id === listingId ? { ...l, price: newPrice } : l)) : old;

      queryClient.setQueryData(qk.listings(), update);
      queryClient.setQueryData(qk.myListings(publicKey), update);

      return { previousListings, previousMyListings };
    },
    onError: (
      error: Error,
      _variables,
      context: { previousListings: unknown; previousMyListings: unknown } | undefined,
    ) => {
      if (context) {
        queryClient.setQueryData(qk.listings(), context.previousListings);
        queryClient.setQueryData(qk.myListings(publicKey), context.previousMyListings);
      }
      toastContractError(error, "marketplace");
      console.error("Price update failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
    },
  });
}

/**
 * Reclaim an expired listing's escrowed bot via `reclaim_expired` (#1407).
 */
export function useReclaimExpired() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (listingId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("reclaim_expired");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "reclaim_expired",
        args: buildReclaimExpiredArgs(listingId),
        sourceAddress: publicKey,
        id: "reclaim_expired",
        label: "reclaim",
        successMessage: "Bot reclaimed successfully!",
      });
      trackStatus(txId, "Reclaim", status);
      return status;
    },
    onMutate: async (listingId: bigint) => {
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
      console.error("Listing reclaim failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.dashboard(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
  });
}

/**
 * Fetch open offers for a single bot (#1409).
 */
export function useBotOffers(botId: bigint | undefined) {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<BotOffer[]>({
    queryKey: qk.botOffers(botId ?? 0n),
    queryFn: () =>
      botId !== undefined ? getOffersForBot(botId, publicKey ?? undefined) : Promise.resolve([]),
    enabled: botId !== undefined,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/**
 * Aggregate incoming active offers across all bots owned or listed by the connected user (#1409).
 */
export function useIncomingOffers() {
  const publicKey = useWalletStore(selectPublicKey);
  const { data: ownBotIds = [] } = useBots();
  const { data: myListings = [] } = useMyListings();

  const botIds = useMemo(() => {
    const ids = new Set<bigint>();
    ownBotIds.forEach((id) => ids.add(id));
    myListings.forEach((listing) => ids.add(listing.bot_id));
    return Array.from(ids);
  }, [ownBotIds, myListings]);

  return useQuery<BotOffer[]>({
    queryKey: qk.incomingOffers(publicKey),
    queryFn: async () => {
      if (!publicKey || botIds.length === 0) return [];
      const offersNested = await Promise.all(
        botIds.map((botId) => getOffersForBot(botId, publicKey)),
      );
      const allOffers = offersNested.flat().filter((offer) => offer.status === "Active");
      return allOffers.sort((a, b) => Number(b.created_at - a.created_at));
    },
    enabled: !!publicKey && botIds.length > 0,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.SHORT,
    gcTime: GC_TIME.SHORT,
  });
}

/**
 * Accept an incoming offer on a bot via `accept_offer` (#1409).
 */
export function useAcceptOffer() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (offerId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("accept_offer");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "accept_offer",
        args: buildAcceptOfferArgs(publicKey, offerId),
        sourceAddress: publicKey,
        id: "accept_offer",
        label: "accept offer",
        successMessage: "Offer accepted successfully!",
      });
      trackStatus(txId, "Accept Offer", status);
      return status;
    },
    onError: (error: Error) => {
      toastContractError(error, "marketplace");
      console.error("Accept offer failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["incomingOffers"] });
      queryClient.invalidateQueries({ queryKey: ["botOffers"] });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.myListings(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.listings() });
      queryClient.invalidateQueries({ queryKey: qk.dashboard(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
    },
  });
}

/**
 * Decline/dismiss an incoming offer on a bot via `dismiss_offer` (#1409).
 */
export function useDeclineOffer() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async (offerId: bigint) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const txId = newTxId("dismiss_offer");
      const status = await runTxWithToasts({
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "dismiss_offer",
        args: buildDismissOfferArgs(publicKey, offerId),
        sourceAddress: publicKey,
        id: "dismiss_offer",
        label: "decline offer",
        successMessage: "Offer declined and dismissed.",
      });
      trackStatus(txId, "Decline Offer", status);
      return status;
    },
    onError: (error: Error) => {
      toastContractError(error, "marketplace");
      console.error("Decline offer failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["incomingOffers"] });
      queryClient.invalidateQueries({ queryKey: ["botOffers"] });
    },
  });
}
