"use client";

import { useMemo, useState, useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { Handshake, Check, X, Clock, User, Tag } from "lucide-react";
import clsx from "clsx";
import {
  useIncomingOffers,
  useAcceptOffer,
  useDeclineOffer,
  useTokenDecimals,
  useTokenSymbol,
} from "@/hooks/useMarketplace";
import { useAllBotDetails } from "@/hooks/useBotDetails";
import { useProfiles } from "@/hooks/useProfiles";
import { fromBaseUnits, formatTimeLeft } from "@/lib/format";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import type { BotOffer, BotNFT, BotTier } from "@/types";
import { BOT_TIER_NAMES, BOT_TIER_COLORS, BOT_TIER_BG_COLORS } from "@/types";

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

interface OfferRowProps {
  offer: BotOffer;
  bot?: BotNFT | undefined;
  buyerName?: string | undefined;
  onAccept: (offer: BotOffer) => void;
  onDecline: (offer: BotOffer) => void;
  isActionPending: boolean;
}

function OfferRow({
  offer,
  bot,
  buyerName,
  onAccept,
  onDecline,
  isActionPending,
}: OfferRowProps) {
  const { data: tokenDecimals = 7 } = useTokenDecimals(offer.currency);
  const { data: tokenSymbol = "AMT" } = useTokenSymbol(offer.currency);

  const tier = (bot?.tier ?? "Basic") as BotTier;
  const tierName = BOT_TIER_NAMES[tier] ?? "Unknown";
  const tierColor = BOT_TIER_COLORS[tier] ?? "text-muted";
  const tierBg = BOT_TIER_BG_COLORS[tier] ?? "bg-muted/20";

  const priceDisplay = fromBaseUnits(offer.amount, tokenDecimals);
  const botLabel = `${bot?.nickname || tierName} Bot #${offer.bot_id.toString()}`;

  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const isExpired = offer.expires_at <= nowSecs;

  return (
    <div
      data-testid={`offer-card-${offer.id.toString()}`}
      className="flex flex-col gap-3 rounded-xl border border-liner bg-card-2 p-4 transition-colors hover:border-liner-hover sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-sm font-semibold text-text">
            {botLabel}
          </span>
          <span
            className={clsx(
              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
              tierBg,
              tierColor,
            )}
          >
            {tierName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-text font-mono" title={offer.buyer}>
              {buyerName || truncateAddress(offer.buyer)}
            </span>
          </span>

          <span className="flex items-center gap-1 font-semibold text-text">
            <Tag className="h-3.5 w-3.5 text-green" aria-hidden="true" />
            <span className="text-green font-mono">
              {priceDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })} {tokenSymbol}
            </span>
          </span>

          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span className={isExpired ? "text-pink" : "text-muted"}>
              {isExpired ? "Expired" : `Expires in ${formatTimeLeft(offer.expires_at)}`}
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
        <button
          type="button"
          disabled={isActionPending || isExpired}
          onClick={() => onAccept(offer)}
          data-testid={`accept-offer-btn-${offer.id.toString()}`}
          aria-label={`Accept offer for ${botLabel}`}
          className={clsx(
            "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            isActionPending || isExpired
              ? "border-liner bg-card text-muted cursor-not-allowed opacity-50"
              : "border-green/30 bg-green/10 text-green hover:bg-green/20 hover:border-green/50",
          )}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Accept
        </button>

        <button
          type="button"
          disabled={isActionPending}
          onClick={() => onDecline(offer)}
          data-testid={`decline-offer-btn-${offer.id.toString()}`}
          aria-label={`Decline offer for ${botLabel}`}
          className={clsx(
            "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            isActionPending
              ? "border-liner bg-card text-muted cursor-not-allowed opacity-50"
              : "border-pink/30 bg-pink/10 text-pink hover:bg-pink/20 hover:border-pink/50",
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Decline
        </button>
      </div>
    </div>
  );
}

export default function OffersSection() {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) return null;
  return <OffersSectionContent />;
}

function OffersSectionContent() {
  const {
    data: offers = [],
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useIncomingOffers();

  const acceptOffer = useAcceptOffer();
  const declineOffer = useDeclineOffer();

  const [selectedOfferForAccept, setSelectedOfferForAccept] = useState<BotOffer | null>(null);
  const [selectedOfferForDecline, setSelectedOfferForDecline] = useState<BotOffer | null>(null);
  const [activeOfferId, setActiveOfferId] = useState<bigint | null>(null);

  const botIds = useMemo(() => {
    return Array.from(new Set(offers.map((o) => o.bot_id)));
  }, [offers]);

  const { data: botDetails = [] } = useAllBotDetails(botIds);

  const botMap = useMemo(() => {
    const map = new Map<bigint, BotNFT>();
    botDetails.forEach((bot) => map.set(bot.id, bot));
    return map;
  }, [botDetails]);

  const buyerAddresses = useMemo(() => {
    return Array.from(new Set(offers.map((o) => o.buyer)));
  }, [offers]);

  const { data: buyerProfiles } = useProfiles(buyerAddresses);

  const handleConfirmAccept = () => {
    if (!selectedOfferForAccept) return;
    const id = selectedOfferForAccept.id;
    setActiveOfferId(id);
    acceptOffer.mutate(id, {
      onSettled: () => {
        setActiveOfferId(null);
        setSelectedOfferForAccept(null);
      },
    });
  };

  const handleConfirmDecline = () => {
    if (!selectedOfferForDecline) return;
    const id = selectedOfferForDecline.id;
    setActiveOfferId(id);
    declineOffer.mutate(id, {
      onSettled: () => {
        setActiveOfferId(null);
        setSelectedOfferForDecline(null);
      },
    });
  };

  const isActionPending = acceptOffer.isPending || declineOffer.isPending;

  return (
    <div
      data-testid="incoming-offers-section"
      className="flex flex-col gap-4 rounded-2xl border border-liner bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="h-5 w-5 text-gold" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-text">
            Incoming Offers
          </h2>
        </div>
        <span
          data-testid="incoming-offers-count"
          className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-gold"
        >
          {offers.length}
        </span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <ErrorState
          error={error}
          title="Failed to Load Offers"
          message="Could not load incoming offers on your bots."
          onRetry={refetch}
          isRetrying={isRefetching}
          compact
          data-testid="offers-error-state"
        />
      ) : offers.length === 0 ? (
        <div
          data-testid="offers-empty-state"
          className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-liner/50 bg-card-2/50 p-6 text-center"
        >
          <Handshake className="h-6 w-6 text-muted/40" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted">
            No incoming offers on your bots at this time.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {offers.map((offer) => {
            const bot = botMap.get(offer.bot_id);
            const profile = buyerProfiles?.[offer.buyer];
            const buyerName = profile?.display_name || profile?.username;

            return (
              <OfferRow
                key={offer.id.toString()}
                offer={offer}
                bot={bot}
                buyerName={buyerName}
                onAccept={(o) => setSelectedOfferForAccept(o)}
                onDecline={(o) => setSelectedOfferForDecline(o)}
                isActionPending={isActionPending || activeOfferId === offer.id}
              />
            );
          })}
        </div>
      )}

      {/* Confirmation Dialog for Accept */}
      <ConfirmDialog
        isOpen={selectedOfferForAccept !== null}
        onClose={() => setSelectedOfferForAccept(null)}
        title="Accept Offer"
        description={
          selectedOfferForAccept
            ? `Are you sure you want to accept this offer on Bot #${selectedOfferForAccept.bot_id.toString()}? The bot will transfer to the buyer and payment will be released to your wallet.`
            : ""
        }
        onConfirm={handleConfirmAccept}
        confirmText="Accept Offer"
        cancelText="Cancel"
      />

      {/* Confirmation Dialog for Decline */}
      <ConfirmDialog
        isOpen={selectedOfferForDecline !== null}
        onClose={() => setSelectedOfferForDecline(null)}
        title="Decline Offer"
        description={
          selectedOfferForDecline
            ? `Are you sure you want to decline this offer on Bot #${selectedOfferForDecline.bot_id.toString()}? The offer will be dismissed and escrowed funds refunded to the buyer.`
            : ""
        }
        onConfirm={handleConfirmDecline}
        confirmText="Decline Offer"
        cancelText="Keep Offer"
      />
    </div>
  );
}
