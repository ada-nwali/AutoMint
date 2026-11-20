"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShoppingBag, Zap } from "lucide-react";
import clsx from "clsx";
import { useTiers } from "@/hooks/useTiers";
import { useAmtBalance, useAmtDecimals } from "@/hooks/useAccrual";
import { useMintTierBot, useTierRemaining } from "@/hooks/useMarketplace";
import { usePauseStatus } from "@/hooks/usePauseStatus";
import { useWalletStore, selectNetworkMismatch } from "@/store/walletStore";
import { TIER_UNCAPPED } from "@/lib/contracts";
import { fromBaseUnits } from "@/lib/format";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { BOT_TIER_COLORS, BOT_TIER_NAMES, TIER_META, TIER_ORDER } from "@/types";
import type { BotTier, TierInfo } from "@/types";

/** Tiers sold through `mint_tier`; Basic is the free bot from registration. */
const PAID_TIERS: BotTier[] = TIER_ORDER.filter((tier) => tier !== "Basic");

function formatAmt(units: bigint, decimals: number): string {
  return fromBaseUnits(units, decimals).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

interface TierOfferProps {
  tier: BotTier;
  info: TierInfo;
  balance: bigint | undefined;
  decimals: number;
}

function TierOffer({ tier, info, balance, decimals }: TierOfferProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: remaining, isPending: isRemainingPending } = useTierRemaining(tier);
  const mint = useMintTierBot();
  const { mintPaused } = usePauseStatus();
  const networkMismatch = useWalletStore(selectNetworkMismatch);

  const tierName = BOT_TIER_NAMES[tier];
  const price = info.price;
  const priceLabel = `${formatAmt(price, decimals)} AMT`;
  const uncapped = remaining === TIER_UNCAPPED;
  const soldOut = remaining === 0n;
  const insufficient = balance !== undefined && balance < price;

  // First matching reason wins; null means the button is enabled.
  const disabledReason = mint.isPending
    ? null
    : mintPaused
      ? "Paid mints are unavailable while the AMT token is paused."
      : networkMismatch
        ? "Freighter is on the wrong network."
        : soldOut
          ? `${tierName} bots are sold out.`
          : insufficient
            ? `You need ${priceLabel} — your balance is ${formatAmt(balance ?? 0n, decimals)} AMT.`
            : null;
  const disabled = mint.isPending || disabledReason !== null || isRemainingPending;
  const reasonId = `tier-shop-${tier}-reason`;

  const handleConfirm = () => {
    setConfirmOpen(false);
    mint.mutate({ tier });
  };

  return (
    <li
      data-testid={`tier-offer-${tier}`}
      className="flex flex-col gap-3 rounded-xl border border-liner bg-card-2 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={clsx("font-display text-sm font-semibold", BOT_TIER_COLORS[tier])}>
          <span aria-hidden="true">{TIER_META[tier].emoji} </span>
          {tierName}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted">
          <Zap className="h-3 w-3 text-gold" aria-hidden="true" />
          {info.rate.toString()} pt/hr
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="font-display text-lg font-bold text-text">{priceLabel}</span>
        <span
          data-testid={`tier-stock-${tier}`}
          className={clsx("text-xs", soldOut ? "font-medium text-red-400" : "text-muted")}
        >
          {isRemainingPending
            ? "Checking stock…"
            : remaining === undefined
              ? "Stock unavailable"
              : uncapped
                ? "Unlimited supply"
                : soldOut
                  ? "Sold out"
                  : `${remaining.toString()} left`}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={disabled}
        aria-busy={mint.isPending}
        aria-describedby={disabledReason ? reasonId : undefined}
        className={clsx(
          "flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          disabled
            ? "cursor-not-allowed border-liner bg-card text-muted opacity-50"
            : "border-gold/30 bg-gold/10 text-gold hover:border-gold/50 hover:bg-gold/20",
        )}
      >
        <ShoppingBag className="h-4 w-4" aria-hidden="true" />
        {mint.isPending ? "Minting…" : `Buy ${tierName}`}
      </button>
      {disabledReason && (
        <p id={reasonId} className="text-xs text-muted">
          {disabledReason}
        </p>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Buy a ${tierName} Bot`}
        description={`Mint a ${tierName} bot for ${priceLabel}. It earns ${info.rate.toString()} points per hour.`}
        confirmText={`Pay ${priceLabel}`}
        cancelText="Not now"
        onConfirm={handleConfirm}
        confirmDisabled={disabled}
      >
        {balance !== undefined && (
          <dl className="rounded-xl border border-liner bg-card-2 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Your balance</dt>
              <dd className="font-mono text-text">{formatAmt(balance, decimals)} AMT</dd>
            </div>
            <div className="mt-1.5 flex justify-between">
              <dt className="text-muted">Price</dt>
              <dd className="font-mono text-pink">-{priceLabel}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-liner pt-2 font-semibold">
              <dt className="text-text">Balance after</dt>
              <dd className="font-mono text-text">
                {formatAmt(balance > price ? balance - price : 0n, decimals)} AMT
              </dd>
            </div>
          </dl>
        )}
      </ConfirmDialog>
    </li>
  );
}

/**
 * Purchase flow for paid tier bots via bot_nft `mint_tier` (#1418). Prices
 * and rates come from the contract (`all_tiers`), stock from
 * `tier_remaining`, and the user's AMT balance gates the buy button.
 */
export default function TierShop() {
  const { data: tiers, isPending: isTiersPending, isError: isTiersError } = useTiers();
  const { data: balance } = useAmtBalance();
  const { data: decimals = 7 } = useAmtDecimals();

  return (
    <motion.section
      id="tier-shop"
      aria-labelledby="tier-shop-heading"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-liner bg-card p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="tier-shop-heading" className="font-display text-sm font-semibold text-text">
          Buy a Tier Bot
        </h3>
        <span className="text-xs text-muted" data-testid="tier-shop-balance">
          Balance:{" "}
          <span className="font-mono text-text">
            {balance === undefined ? "—" : `${formatAmt(balance, decimals)} AMT`}
          </span>
        </span>
      </div>

      {isTiersError ? (
        <p className="mt-3 text-xs text-muted">
          Tier prices could not be loaded. Try again shortly.
        </p>
      ) : isTiersPending || !tiers ? (
        <p className="mt-3 text-xs text-muted">Loading tiers…</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {PAID_TIERS.map((tier) => (
            <TierOffer
              key={tier}
              tier={tier}
              info={tiers[tier]}
              balance={balance}
              decimals={decimals}
            />
          ))}
        </ul>
      )}
    </motion.section>
  );
}
