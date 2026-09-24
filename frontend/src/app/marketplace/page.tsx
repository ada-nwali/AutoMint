"use client";

import { useMemo, useState } from "react";
import { Store, Wallet, PackageOpen, Tag, SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import {
  useListings,
  useMyListings,
  useBuyBot,
  useCancelListing,
} from "@/hooks/useMarketplace";
import { useAllBotDetails } from "@/hooks/useBotDetails";
import { useBots } from "@/hooks/useAccrual";
import BotListingCard from "@/components/marketplace/BotListingCard";
import BotCard from "@/components/dashboard/BotCard";
import ListBotModal from "@/components/marketplace/ListBotModal";
import { CardSkeleton, BotCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import type { BotNFT, BotTier, MarketplaceListing } from "@/types";

const TIERS: BotTier[] = ["Basic", "Bronze", "Silver", "Gold", "Diamond"];

type Tab = "all" | "mine";
type TierFilter = "all" | BotTier;
type PriceFilter = "any" | "under100" | "100to1000" | "over1000";
type SortOrder = "recent" | "priceAsc" | "priceDesc";

const PRICE_FILTERS: { value: PriceFilter; label: string }[] = [
  { value: "any", label: "Any price" },
  { value: "under100", label: "Under 100 XLM" },
  { value: "100to1000", label: "100 – 1,000 XLM" },
  { value: "over1000", label: "Over 1,000 XLM" },
];

const STROOPS_PER_100_XLM = 1_000_000_000n;
const STROOPS_PER_1000_XLM = 10_000_000_000n;

function matchesPriceFilter(listing: MarketplaceListing, filter: PriceFilter): boolean {
  switch (filter) {
    case "any":
      return true;
    case "under100":
      return listing.price < STROOPS_PER_100_XLM;
    case "100to1000":
      return listing.price >= STROOPS_PER_100_XLM && listing.price <= STROOPS_PER_1000_XLM;
    case "over1000":
      return listing.price > STROOPS_PER_1000_XLM;
  }
}

function compareStroops(a: bigint, b: bigint): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export default function MarketplacePage() {
  const publicKey = useWalletStore(selectPublicKey);
  const [tab, setTab] = useState<Tab>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("any");
  const [sort, setSort] = useState<SortOrder>("recent");
  const [listedBot, setListedBot] = useState<BotNFT | null>(null);
  const [buyingId, setBuyingId] = useState<bigint | null>(null);
  const [cancellingId, setCancellingId] = useState<bigint | null>(null);

  const {
    data: allListings,
    isLoading: isListingsLoading,
    isError: isListingsError,
    error: listingsError,
    refetch: refetchListings,
    isRefetching: isListingsRefetching,
  } = useListings();

  const {
    data: myListings,
    isLoading: isMyListingsLoading,
    isError: isMyListingsError,
    error: myListingsError,
    refetch: refetchMyListings,
    isRefetching: isMyListingsRefetching,
  } = useMyListings();

  const { data: ownBotIds = [] } = useBots();

  // Bot details (tier, name, accrual rate) for the visible listings plus the
  // connected user's own bots, resolved through `useAllBotDetails` so an
  // anonymous visitor still gets real tier metadata for active listings.
  const relevantBotIds = useMemo(() => {
    const ids = new Set<bigint>();
    (allListings ?? []).forEach((l) => ids.add(l.bot_id));
    (myListings ?? []).forEach((l) => ids.add(l.bot_id));
    ownBotIds.forEach((id) => ids.add(id));
    return Array.from(ids);
  }, [allListings, myListings, ownBotIds]);

  const { data: botDetails = [] } = useAllBotDetails(relevantBotIds);

  const botMap = useMemo(() => {
    const map = new Map<bigint, BotNFT>();
    botDetails.forEach((bot) => map.set(bot.id, bot));
    return map;
  }, [botDetails]);

  const buy = useBuyBot();
  const cancel = useCancelListing();

  const sourceListings = tab === "mine" ? myListings : allListings;

  const filteredListings = useMemo(() => {
    let list = (sourceListings ?? []).filter(
      (l) => matchesPriceFilter(l, priceFilter) && (tierFilter === "all" || botMap.get(l.bot_id)?.tier === tierFilter),
    );
    if (sort === "priceAsc") {
      list = [...list].sort((a, b) => compareStroops(a.price, b.price));
    } else if (sort === "priceDesc") {
      list = [...list].sort((a, b) => compareStroops(b.price, a.price));
    }
    return list;
  }, [sourceListings, priceFilter, tierFilter, botMap, sort]);

  const hasFilters = tierFilter !== "all" || priceFilter !== "any";

  const clearFilters = () => {
    setTierFilter("all");
    setPriceFilter("any");
  };

  // Owned bots that aren't already listed — these are the ones eligible to
  // go on sale from this page.
  const unlistedOwnedBots = useMemo(() => {
    const listedIds = new Set((myListings ?? []).map((l) => l.bot_id));
    return ownBotIds
      .map((id) => botMap.get(id))
      .filter((bot): bot is BotNFT => bot !== undefined && !listedIds.has(bot.id));
  }, [ownBotIds, myListings, botMap]);

  const handleBuy = (listingId: bigint) => {
    setBuyingId(listingId);
    buy.mutate(listingId, { onSettled: () => setBuyingId(null) });
  };

  const handleCancel = (listingId: bigint) => {
    setCancellingId(listingId);
    cancel.mutate(listingId, { onSettled: () => setCancellingId(null) });
  };

  const handleListForSale = (botId: bigint) => {
    const bot = botMap.get(botId);
    if (bot) setListedBot(bot);
  };

  const chipClass = (active: boolean) =>
    clsx(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      active
        ? "border-gold/50 bg-gold/15 text-gold"
        : "border-liner bg-card-2 text-muted hover:text-text hover:border-liner-hover",
    );

  const renderFilters = () => (
    <div className="mb-6 flex flex-col gap-3" data-testid="marketplace-filters">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs uppercase tracking-wider text-muted">Tier</span>
        <button
          type="button"
          className={chipClass(tierFilter === "all")}
          aria-pressed={tierFilter === "all"}
          onClick={() => setTierFilter("all")}
        >
          All
        </button>
        {TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            className={chipClass(tierFilter === tier)}
            aria-pressed={tierFilter === tier}
            onClick={() => setTierFilter(tierFilter === tier ? "all" : tier)}
          >
            {tier}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs uppercase tracking-wider text-muted">Price</span>
        {PRICE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={chipClass(priceFilter === f.value)}
            aria-pressed={priceFilter === f.value}
            onClick={() => setPriceFilter(priceFilter === f.value ? "any" : f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs uppercase tracking-wider text-muted">Sort</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
          aria-label="Sort listings by price"
          className="rounded-lg border border-liner bg-card-2 px-3 py-1.5 text-xs font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="recent">Recently listed</option>
          <option value="priceAsc">Price: low to high</option>
          <option value="priceDesc">Price: high to low</option>
        </select>
      </div>
    </div>
  );

  const renderEmptyFiltered = () => (
    <div
      data-testid="marketplace-empty-filtered"
      className="flex flex-col items-center justify-center rounded-2xl border border-liner bg-card px-6 py-12 text-center"
    >
      <SlidersHorizontal className="mb-3 h-8 w-8 text-muted/40" aria-hidden="true" />
      <p className="text-sm text-muted">No listings match your filters.</p>
      <button
        type="button"
        onClick={clearFilters}
        className="mt-4 text-sm font-medium text-gold hover:underline"
      >
        Clear filters
      </button>
    </div>
  );

  const renderListingGrid = (loading: boolean, error: unknown, retrying: boolean, onRetry: () => void, emptyMessage: string, gridTestId: string) => {
    if (loading) {
      return (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <ErrorState
          error={error}
          title="Failed to Load Marketplace Listings"
          onRetry={onRetry}
          isRetrying={retrying}
          data-testid="marketplace-error-state"
        />
      );
    }
    if (filteredListings.length === 0) {
      return hasFilters ? renderEmptyFiltered() : (
        <div
          data-testid="marketplace-empty"
          className="flex flex-col items-center justify-center rounded-2xl border border-liner bg-card px-6 py-12 text-center"
        >
          <PackageOpen className="mb-3 h-8 w-8 text-muted/40" aria-hidden="true" />
          <p className="text-sm text-muted">{emptyMessage}</p>
        </div>
      );
    }
    return (
      <div data-testid={gridTestId} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filteredListings.map((listing) => {
          const bot = botMap.get(listing.bot_id);
          return (
            <BotListingCard
              key={listing.id.toString()}
              listing={listing}
              {...(bot ? { bot } : {})}
              connectedAddress={publicKey}
              onBuy={handleBuy}
              onCancel={handleCancel}
              isBuying={buyingId === listing.id}
              isCancelling={cancellingId === listing.id}
            />
          );
        })}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* Page header */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15">
          <Store className="h-5 w-5 text-gold" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-text">Marketplace</h1>
          <p className="text-sm text-muted">Buy and sell AI bot NFTs with AMT</p>
        </div>
      </div>

      {/* Connect banner — listings stay visible for visitors (#499) */}
      {!publicKey && (
        <div
          data-testid="marketplace-connect-banner"
          className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-liner bg-card p-4"
        >
          <p className="flex items-center gap-2 text-sm text-muted">
            <Wallet className="h-4 w-4 shrink-0" aria-hidden="true" />
            Connect your wallet to buy bots and list your own.
          </p>
          <button
            type="button"
            onClick={() => useWalletStore.getState().setConnecting()}
            className="btn-primary text-sm"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Marketplace views"
        className="mb-6 inline-flex rounded-xl border border-liner bg-card p-1"
      >
        <button
          type="button"
          role="tab"
          id="tab-all"
          aria-selected={tab === "all"}
          aria-controls="marketplace-all"
          onClick={() => setTab("all")}
          className={clsx(
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "all" ? "bg-gold/15 text-gold" : "text-muted hover:text-text",
          )}
        >
          All Listings
        </button>
        <button
          type="button"
          role="tab"
          id="tab-mine"
          aria-selected={tab === "mine"}
          aria-controls="marketplace-mine"
          onClick={() => setTab("mine")}
          className={clsx(
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "mine" ? "bg-gold/15 text-gold" : "text-muted hover:text-text",
          )}
        >
          My Listings
        </button>
      </div>

      {tab === "all" ? (
        <section id="marketplace-all" role="tabpanel" aria-label="All listings">
          {renderFilters()}
          {renderListingGrid(
            isListingsLoading,
            isListingsError ? listingsError : null,
            isListingsRefetching,
            () => refetchListings(),
            "No active listings right now. Check back soon.",
            "marketplace-grid",
          )}
        </section>
      ) : (
        <section id="marketplace-mine" role="tabpanel" aria-label="My listings">
          {!publicKey ? (
            <div
              data-testid="marketplace-mine-connect"
              className="flex flex-col items-center justify-center rounded-2xl border border-liner bg-card px-6 py-12 text-center"
            >
              <Wallet className="mb-3 h-8 w-8 text-muted/40" aria-hidden="true" />
              <h2 className="font-display text-lg font-semibold text-text">Connect Your Wallet</h2>
              <p className="mt-1 text-sm text-muted">
                Connect your wallet to list your bots and manage active listings.
              </p>
              <button
                type="button"
                onClick={() => useWalletStore.getState().setConnecting()}
                className="btn-primary mt-5 text-sm"
              >
                Connect Wallet
              </button>
            </div>
          ) : (
            <>
              {renderFilters()}

              {/* Owned bots ready to list */}
              <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-text">
                <Tag className="h-4 w-4 text-gold" aria-hidden="true" />
                Owned Bots
              </h2>
              {unlistedOwnedBots.length === 0 ? (
                <div
                  data-testid="marketplace-no-owned"
                  className="mb-8 rounded-2xl border border-liner bg-card px-6 py-8 text-center text-sm text-muted"
                >
                  No bots available to list. Mint a bot from the dashboard to get started.
                </div>
              ) : (
                <div data-testid="marketplace-owned-grid" className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {unlistedOwnedBots.map((bot) => (
                    <BotCard key={bot.id.toString()} bot={bot} onListForSale={handleListForSale} />
                  ))}
                </div>
              )}

              {/* The user's active listings */}
              <h2 className="mb-3 font-display text-base font-semibold text-text">
                Your Active Listings
              </h2>
              {isMyListingsLoading ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <BotCardSkeleton key={i} />
                  ))}
                </div>
              ) : isMyListingsError ? (
                <ErrorState
                  error={myListingsError}
                  title="Failed to Load Your Listings"
                  onRetry={() => refetchMyListings()}
                  isRetrying={isMyListingsRefetching}
                  data-testid="marketplace-mine-error-state"
                />
              ) : filteredListings.length === 0 ? (
                hasFilters ? (
                  renderEmptyFiltered()
                ) : (
                  <div
                    data-testid="marketplace-mine-empty"
                    className="rounded-2xl border border-liner bg-card px-6 py-8 text-center text-sm text-muted"
                  >
                    You have no active listings yet. Pick an owned bot above to list it for sale.
                  </div>
                )
              ) : (
                <div data-testid="marketplace-mine-grid" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredListings.map((listing) => {
                    const bot = botMap.get(listing.bot_id);
                    return (
                      <BotListingCard
                        key={listing.id.toString()}
                        listing={listing}
                        {...(bot ? { bot } : {})}
                        connectedAddress={publicKey}
                        onBuy={handleBuy}
                        onCancel={handleCancel}
                        isBuying={buyingId === listing.id}
                        isCancelling={cancellingId === listing.id}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* List-for-sale modal */}
      {listedBot && (
        <ListBotModal bot={listedBot} isOpen onClose={() => setListedBot(null)} />
      )}
    </main>
  );
}