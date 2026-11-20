"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, ShoppingCart, X, Zap, Tag } from "lucide-react";
import clsx from "clsx";
import { BotTier, BOT_TIER_NAMES, BOT_TIER_COLORS, BOT_TIER_BG_COLORS, TIER_META } from "@/types";
import type { MarketplaceListing, BotNFT, UserProfile } from "@/types";
import { fromBaseUnits } from "@/lib/format";
import { useTokenDecimals, useTokenSymbol } from "@/hooks/useMarketplace";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface BotListingCardProps {
  listing: MarketplaceListing;
  bot?: BotNFT;
  sellerProfile?: UserProfile | null;
  sellerUsername?: string;
  connectedAddress: string | null;
  onBuy: (listingId: bigint) => void;
  onCancel: (listingId: bigint) => void;
  isBuying?: boolean;
  isCancelling?: boolean;
  /** True while the marketplace or payment token is paused — `buy_bot` would fail (#1416). */
  isBuyPaused?: boolean;
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function BotListingCard({
  listing,
  bot,
  sellerProfile,
  sellerUsername,
  connectedAddress,
  onBuy,
  onCancel,
  isBuying = false,
  isCancelling = false,
  isBuyPaused: buyPaused = false,
}: BotListingCardProps) {
  // #476: listings carry their own bot_tier now, so the card no longer
  // needs `bot` (a separate per-row lookup) just to know the tier — `bot`
  // is still used below for nickname/id/accrual-rate, which the listing
  // itself doesn't carry.
  const tier = (listing.bot_tier ?? bot?.tier ?? "Basic") as BotTier;
  const tierName = BOT_TIER_NAMES[tier] ?? "Unknown";
  const tierColor = BOT_TIER_COLORS[tier] ?? "text-muted";
  const tierBg = BOT_TIER_BG_COLORS[tier] ?? "bg-muted/20";
  const tierMeta = TIER_META[tier];

  // Read the listing's currency contract to format the price with the correct
  // decimals and symbol instead of assuming XLM.
  const { data: currencyDecimals = 7 } = useTokenDecimals(listing.currency);
  const { data: currencySymbol = "…" } = useTokenSymbol(listing.currency);
  const priceDisplay = fromBaseUnits(listing.price, currencyDecimals);

  const buyDisabled = isBuying || !connectedAddress || buyPaused;

  const isOwner =
    connectedAddress !== null && listing.seller.toLowerCase() === connectedAddress.toLowerCase();
  const botLabel = `${bot?.nickname || tierName} Bot #${bot?.id?.toString() || listing.bot_id.toString()}`;

  const [isBuyingConfirmed, setIsBuyingConfirmed] = useState(false);
  const [isCancellingConfirmed, setIsCancellingConfirmed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={clsx(
        "relative rounded-2xl border border-liner bg-card p-4 sm:p-5",
        "flex flex-col gap-4",
        "hover:border-white/10 transition-colors",
      )}
      data-testid={`listing-card-${listing.id.toString()}`}
      role="group"
      aria-label={botLabel}
    >
      {/* Header: tier icon + name + tier badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={clsx(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl",
              tierBg,
            )}
            aria-hidden="true"
          >
            {tierMeta?.emoji ?? <Bot className={clsx("h-5 w-5", tierColor)} />}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-text">
              {bot?.nickname || tierName} Bot
            </p>
            <p className="text-xs text-muted">
              #{bot?.id?.toString() || listing.bot_id.toString()}
            </p>
          </div>
        </div>

        <span
          className={clsx(
            "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5",
            "text-xs font-medium",
            tierBg,
            tierColor,
          )}
        >
          {tierName} tier
        </span>
      </div>

      {/* Stats: rate + price */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2">
          <Zap className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted">Rate</p>
            <p className="text-sm font-semibold text-text">
              {bot ? bot.accrual_rate.toString() : "—"}{" "}
              <span className="text-xs font-normal text-muted">pt/hr</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2">
          <Tag className="h-3.5 w-3.5 shrink-0 text-green" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted">Price</p>
            <p className="text-sm font-semibold text-text">
              {priceDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
              <span className="text-xs font-normal text-muted">{currencySymbol}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Seller */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-card-2 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">Seller</span>
        <span
          className="truncate font-mono text-xs text-text"
          title={listing.seller}
          aria-label={`Seller address ${listing.seller}`}
          data-testid={`listing-seller-${listing.id.toString()}`}
        >
          {sellerProfile?.display_name ||
            sellerProfile?.username ||
            sellerUsername ||
            truncateAddress(listing.seller)}
        </span>
      </div>

      {/* Currency (#476) — the contract's token address for this listing's price. */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-card-2 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">Currency</span>
        <span
          className="truncate font-mono text-xs text-text"
          title={listing.currency}
          aria-label={`Priced in currency contract ${listing.currency}`}
        >
          {truncateAddress(listing.currency)}
        </span>
      </div>

      {/* Action button */}
      {isOwner ? (
        <>
          <ConfirmDialog
            isOpen={isCancellingConfirmed}
            onClose={() => setIsCancellingConfirmed(false)}
            title="Cancel Listing"
            description={`Are you sure you want to cancel listing ${botLabel} for ${priceDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currencySymbol}?`}
            onConfirm={() => onCancel(listing.id)}
            confirmText="Cancel"
            cancelText="Keep Listed"
          />
          <button
            type="button"
            onClick={() => setIsCancellingConfirmed(true)}
            disabled={isCancelling}
            data-testid={`cancel-btn-${listing.id.toString()}`}
            aria-label={
              isCancelling ? `Cancelling listing for ${botLabel}` : `Cancel listing for ${botLabel}`
            }
            className={clsx(
              "flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5",
              "text-sm font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              isCancelling
                ? "border-liner bg-card-2 text-muted cursor-not-allowed opacity-50"
                : "border-pink/30 bg-pink/10 text-pink hover:bg-pink/20 hover:border-pink/50",
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {isCancelling ? "Cancelling..." : "Cancel Listing"}
          </button>
        </>
      ) : (
        <>
          <ConfirmDialog
            isOpen={isBuyingConfirmed}
            onClose={() => setIsBuyingConfirmed(false)}
            title="Buy Bot"
            description={`Are you sure you want to buy ${botLabel} for ${priceDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currencySymbol}?`}
            onConfirm={() => onBuy(listing.id)}
            confirmText="Buy"
            cancelText="Keep Browsing"
          />
          <button
            type="button"
            onClick={() => setIsBuyingConfirmed(true)}
            disabled={buyDisabled}
            data-testid={`buy-btn-${listing.id.toString()}`}
            aria-label={
              !connectedAddress
                ? `Connect your wallet to buy ${botLabel}`
                : buyPaused
                  ? `Buying ${botLabel} is unavailable while trading is paused`
                  : isBuying
                    ? `Buying ${botLabel}`
                    : `Buy ${botLabel} for ${priceDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currencySymbol}`
            }
            title={
              !connectedAddress
                ? "Connect your wallet to buy"
                : buyPaused
                  ? "Buying is unavailable while trading is paused"
                  : undefined
            }
            className={clsx(
              "flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5",
              "text-sm font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              buyDisabled
                ? "border-liner bg-card-2 text-muted cursor-not-allowed opacity-50"
                : "border-gold/30 bg-gold/10 text-gold hover:bg-gold/20 hover:border-gold/50",
            )}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            {isBuying ? "Buying..." : buyPaused ? "Paused" : "Buy"}
          </button>
        </>
      )}
    </motion.div>
  );
}
