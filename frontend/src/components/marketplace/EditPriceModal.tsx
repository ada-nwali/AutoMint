"use client";

import { useState, useMemo, useId, useEffect } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  useUpdatePrice,
  useMarketplaceConfig,
  useMinListingPrice,
  useTokenDecimals,
  useTokenSymbol,
} from "@/hooks/useMarketplace";
import { toBaseUnits, fromBaseUnits } from "@/lib/format";
import { usePauseStatus } from "@/hooks/usePauseStatus";
import type { BotNFT, MarketplaceListing } from "@/types";
import clsx from "clsx";

const Modal = dynamic(() => import("@/components/ui/Modal"), { ssr: false });

const BPS_DENOMINATOR = 10_000n;
const MAX_PRICE_DISPLAY = 100_000_000;

function bpsOf(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

function bpsToPercent(bps: number): number {
  return Number((bps / 100).toFixed(2));
}

interface EditPriceModalProps {
  listing: MarketplaceListing;
  bot?: BotNFT | undefined;
  isOpen: boolean;
  onClose: () => void;
  onUpdatePrice?: ((listingId: bigint, newPrice: bigint) => void) | undefined;
}

export default function EditPriceModal({
  listing,
  bot,
  isOpen,
  onClose,
  onUpdatePrice,
}: EditPriceModalProps) {
  const currency = listing.currency;
  const { data: tokenDecimals = 7 } = useTokenDecimals(currency);
  const { data: tokenSymbol = "AMT" } = useTokenSymbol(currency);
  const { data: config } = useMarketplaceConfig();
  const { data: minPrice } = useMinListingPrice(currency);
  const { listPaused } = usePauseStatus();
  const updatePrice = useUpdatePrice();

  const currentPriceDisplay = useMemo(
    () => fromBaseUnits(listing.price, tokenDecimals),
    [listing.price, tokenDecimals],
  );

  const [priceInput, setPriceInput] = useState("");
  const [touched, setTouched] = useState(false);
  const priceInputId = useId();

  // Reset or initialize input when modal opens
  useEffect(() => {
    if (isOpen) {
      setPriceInput(currentPriceDisplay.toString());
      setTouched(false);
    }
  }, [isOpen, currentPriceDisplay]);

  const minPriceDisplay =
    minPrice !== undefined
      ? fromBaseUnits(minPrice, tokenDecimals).toLocaleString("en-US", {
          maximumFractionDigits: tokenDecimals,
        })
      : null;

  const validation = useMemo(() => {
    const trimmed = priceInput.trim();
    if (!trimmed) {
      return {
        isValid: false,
        error: `Please enter a listing price in ${tokenSymbol}.`,
        reason: "Enter a price to enable updating.",
      };
    }

    const num = Number(trimmed);
    if (isNaN(num) || !isFinite(num)) {
      return {
        isValid: false,
        error: "Price must be a valid number.",
        reason: "Price must be a valid number.",
      };
    }

    if (num <= 0) {
      return {
        isValid: false,
        error: `Price must be greater than 0 ${tokenSymbol}.`,
        reason: `Price must be greater than 0 ${tokenSymbol}.`,
      };
    }

    if (num > MAX_PRICE_DISPLAY) {
      return {
        isValid: false,
        error: `Price cannot exceed ${MAX_PRICE_DISPLAY.toLocaleString("en-US")} ${tokenSymbol}.`,
        reason: "Price exceeds maximum allowed amount.",
      };
    }

    const parts = trimmed.split(".");
    if (parts.length > 1 && (parts[1]?.length ?? 0) > tokenDecimals) {
      return {
        isValid: false,
        error: `Price cannot exceed ${tokenDecimals} decimal places (token precision limit).`,
        reason: `Maximum ${tokenDecimals} decimal places allowed.`,
      };
    }

    const baseUnits = toBaseUnits(trimmed, tokenDecimals);
    if (baseUnits <= 0n) {
      return {
        isValid: false,
        error: `Price must be at least 1 base unit (0.${"0".repeat(tokenDecimals - 1)}1 ${tokenSymbol}).`,
        reason: "Price too low.",
      };
    }

    if (minPrice !== undefined && baseUnits < minPrice) {
      return {
        isValid: false,
        error: `Price must be at least ${minPriceDisplay} ${tokenSymbol} (marketplace minimum).`,
        reason: `Minimum listing price is ${minPriceDisplay} ${tokenSymbol}.`,
      };
    }

    return { isValid: true, error: null, reason: null, baseUnits, num };
  }, [priceInput, tokenDecimals, tokenSymbol, minPrice, minPriceDisplay]);

  const feeBreakdown = useMemo(() => {
    if (!validation.isValid || !validation.baseUnits || !config) {
      return null;
    }
    const priceBase = validation.baseUnits;
    const feeBase = bpsOf(priceBase, config.feeBps);
    const payRoyalty =
      config.royaltyBps > 0 && bot && (bot.minter ?? bot.owner) !== bot.owner;
    const royaltyBase = payRoyalty ? bpsOf(priceBase, config.royaltyBps) : 0n;
    const netBase = priceBase - feeBase - royaltyBase;

    return {
      priceBase,
      feeBase,
      royaltyBase,
      netBase,
      feePercent: bpsToPercent(config.feeBps),
      royaltyPercent: payRoyalty ? bpsToPercent(config.royaltyBps) : 0,
      netPercent: bpsToPercent(10_000 - config.feeBps - (payRoyalty ? config.royaltyBps : 0)),
      priceDisplay: validation.num,
      feeDisplay: fromBaseUnits(feeBase, tokenDecimals),
      royaltyDisplay: fromBaseUnits(royaltyBase, tokenDecimals),
      netDisplay: fromBaseUnits(netBase, tokenDecimals),
    };
  }, [validation, config, bot, tokenDecimals]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!validation.isValid || !validation.baseUnits || listPaused) return;

    if (onUpdatePrice) {
      onUpdatePrice(listing.id, validation.baseUnits);
      onClose();
      return;
    }

    updatePrice.mutate(
      { listingId: listing.id, newPrice: validation.baseUnits },
      {
        onSuccess: () => {
          toast.success(`Price updated to ${priceInput} ${tokenSymbol}`);
          onClose();
        },
      },
    );
  };

  const describedBy = [
    `${priceInputId}-help`,
    touched && validation.error ? `${priceInputId}-error` : null,
    feeBreakdown ? `${priceInputId}-fee` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const botTitle = `${bot?.nickname || listing.bot_tier} Bot #${bot?.id?.toString() || listing.bot_id.toString()}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Price for ${botTitle}`}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={priceInputId}
            id={`${priceInputId}-label`}
            className="text-sm font-medium text-text"
          >
            New Price ({tokenSymbol}){" "}
            <span className="text-gold" aria-hidden="true">
              *
            </span>
          </label>

          <div className="relative">
            <input
              id={priceInputId}
              type="text"
              inputMode="decimal"
              placeholder={"0." + "0".repeat(tokenDecimals)}
              value={priceInput}
              onChange={(e) => {
                setPriceInput(e.target.value);
                if (!touched) setTouched(true);
              }}
              onBlur={() => setTouched(true)}
              aria-labelledby={`${priceInputId}-label`}
              aria-describedby={describedBy}
              aria-invalid={touched && Boolean(validation.error)}
              aria-required="true"
              className={clsx(
                "w-full rounded-xl border bg-card-2 px-4 py-3 text-lg text-text placeholder:text-muted/50 transition-colors",
                "focus:outline-none focus:ring-2",
                touched && validation.error
                  ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/30"
                  : "border-liner focus:border-gold/50 focus:ring-gold/30",
              )}
            />
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-muted text-sm">
              {tokenSymbol}
            </div>
          </div>

          <p id={`${priceInputId}-help`} className="text-xs text-muted">
            Enter new price in {tokenSymbol}. Current: {currentPriceDisplay} {tokenSymbol}.
            {minPriceDisplay !== null && ` Minimum: ${minPriceDisplay} ${tokenSymbol}.`}
          </p>

          {touched && validation.error && (
            <p
              id={`${priceInputId}-error`}
              role="alert"
              className="text-xs font-medium text-red-400"
            >
              {validation.error}
            </p>
          )}
        </div>

        {/* Live fee breakdown */}
        {feeBreakdown && (
          <div
            id={`${priceInputId}-fee`}
            aria-live="polite"
            className="rounded-xl border border-liner bg-card-2 p-3 text-xs flex flex-col gap-1.5"
          >
            <div className="flex justify-between text-muted">
              <span>Platform fee ({feeBreakdown.feePercent}%)</span>
              <span className="font-mono">
                {feeBreakdown.feeDisplay} {tokenSymbol}
              </span>
            </div>
            {feeBreakdown.royaltyPercent > 0 && (
              <div className="flex justify-between text-muted">
                <span>Creator royalty ({feeBreakdown.royaltyPercent}%)</span>
                <span className="font-mono">
                  {feeBreakdown.royaltyDisplay} {tokenSymbol}
                </span>
              </div>
            )}
            <div className="flex justify-between text-text font-semibold pt-1 border-t border-liner">
              <span>You receive ({feeBreakdown.netPercent}%)</span>
              <span className="font-mono text-green">
                {feeBreakdown.netDisplay} {tokenSymbol}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-liner px-4 py-2 text-sm font-medium text-muted hover:text-text hover:bg-card-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!validation.isValid || updatePrice.isPending || listPaused}
            data-testid="confirm-update-price-btn"
            className={clsx(
              "flex items-center justify-center rounded-xl px-5 py-2 text-sm font-medium transition-all",
              !validation.isValid || updatePrice.isPending || listPaused
                ? "border border-liner bg-card-2 text-muted cursor-not-allowed opacity-50"
                : "border border-gold/40 bg-gold/15 text-gold hover:bg-gold/25 hover:border-gold/60",
            )}
          >
            {updatePrice.isPending ? "Updating..." : "Update Price"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
