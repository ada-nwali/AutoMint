"use client";

import { useState, useMemo, useId } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  useListBot,
  useMarketplaceConfig,
  useMinListingPrice,
  useTokenDecimals,
  useTokenSymbol,
} from "@/hooks/useMarketplace";
import { toBaseUnits, fromBaseUnits } from "@/lib/format";
import { CONTRACT_ADDRESSES } from "@/lib/constants";
import { usePauseStatus } from "@/hooks/usePauseStatus";
import type { BotNFT } from "@/types";
import clsx from "clsx";

// Code-split the modal shell (framer-motion + createPortal) out of the
// marketplace route's initial bundle — it's only needed once a bot is listed.
const Modal = dynamic(() => import("@/components/ui/Modal"), { ssr: false });

const BPS_DENOMINATOR = 10_000n;
const MAX_PRICE_DISPLAY = 100_000_000;

/** `amount * bps / 10_000`, exactly as the contract's `bps_of` helper. */
function bpsOf(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/** Basis points as a human-readable percentage, without float noise. */
function bpsToPercent(bps: number): number {
  return Number((bps / 100).toFixed(2));
}

interface ListBotModalProps {
  bot: BotNFT;
  isOpen: boolean;
  onClose: () => void;
}

export default function ListBotModal({ bot, isOpen, onClose }: ListBotModalProps) {
  const [priceInput, setPriceInput] = useState("");
  const [touched, setTouched] = useState(false);
  const listBot = useListBot();
  const { data: config } = useMarketplaceConfig();
  const priceInputId = useId();

  // The listing currency is the configured payment token (AMT by default).
  // Read its decimals and symbol from the contract so the UI reflects the
  // actual token rather than assuming XLM.
  const currency = CONTRACT_ADDRESSES.token;
  const { data: tokenDecimals = 7 } = useTokenDecimals(currency);
  const { data: tokenSymbol = "AMT" } = useTokenSymbol(currency);
  // list_bot rejects prices below get_min_price(currency) with PriceTooLow
  // (#1417); check it here so the user is never asked to sign a doomed tx.
  const { data: minPrice } = useMinListingPrice(currency);
  const minPriceDisplay =
    minPrice !== undefined
      ? fromBaseUnits(minPrice, tokenDecimals).toLocaleString("en-US", {
          maximumFractionDigits: tokenDecimals,
        })
      : null;
  const { listPaused } = usePauseStatus();

  // Validate decimal precision, minimum and maximum.
  const validation = useMemo(() => {
    const trimmed = priceInput.trim();
    if (!trimmed) {
      return {
        isValid: false,
        error: `Please enter a listing price in ${tokenSymbol}.`,
        reason: "Enter a price to enable listing.",
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

  // Live fee breakdown in exact base units, mirroring `buy_bot` on-chain:
  // platform fee = price * fee_bps / 10_000, creator royalty = price *
  // royalty_bps / 10_000 (paid only when the seller is not the original
  // minter), seller payout = price - platform fee - royalty. Both rates come
  // from the marketplace's config() so an admin `set_fee_bps` is reflected.
  const feeBreakdown = useMemo(() => {
    if (!validation.isValid || !validation.baseUnits || !config) {
      return null;
    }
    const priceBase = validation.baseUnits;
    const feeBase = bpsOf(priceBase, config.feeBps);
    const payRoyalty = config.royaltyBps > 0 && (bot.minter ?? bot.owner) !== bot.owner;
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
  }, [validation, config, bot.minter, bot.owner, tokenDecimals]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!validation.isValid || !validation.baseUnits || listPaused) return;

    listBot.mutate(
      { botId: bot.id, price: validation.baseUnits },
      {
        onSuccess: () => {
          toast.success(`${bot.nickname ?? bot.tier} listed for ${priceInput} ${tokenSymbol}`);
          onClose();
          setPriceInput("");
          setTouched(false);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`List ${bot.nickname ?? bot.tier} Bot for Sale`}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {/* Price input field with associated label, help text, and error linkage */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={priceInputId}
            id={`${priceInputId}-label`}
            className="text-sm font-medium text-text"
          >
            Listing Price ({tokenSymbol}){" "}
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
            Enter price in {tokenSymbol} (up to {tokenDecimals} decimal places).
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

        {/* Live fee breakdown matching contract base unit math */}
        {feeBreakdown && (
          <div
            id={`${priceInputId}-fee`}
            role="status"
            aria-live="polite"
            className="rounded-xl border border-liner bg-card p-4 text-sm"
          >
            <div className="flex items-center justify-between text-muted text-xs sm:text-sm">
              <span>Listing Price</span>
              <span className="font-mono text-text">
                {priceInput} {tokenSymbol}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-muted text-xs sm:text-sm">
              <span>Marketplace Fee ({feeBreakdown.feePercent}%)</span>
              <span className="font-mono text-pink">
                -{feeBreakdown.feeDisplay.toFixed(tokenDecimals)} {tokenSymbol}
              </span>
            </div>
            {feeBreakdown.royaltyBase > 0n && (
              <div className="mt-1.5 flex items-center justify-between text-muted text-xs sm:text-sm">
                <span>Creator Royalty ({feeBreakdown.royaltyPercent}%)</span>
                <span className="font-mono text-pink">
                  -{feeBreakdown.royaltyDisplay.toFixed(tokenDecimals)} {tokenSymbol}
                </span>
              </div>
            )}
            <div className="mt-2.5 flex items-center justify-between border-t border-liner pt-2.5 font-semibold text-text">
              <span>You Receive ({feeBreakdown.netPercent}%)</span>
              <span className="font-mono text-green">
                {feeBreakdown.netDisplay.toFixed(tokenDecimals)} {tokenSymbol}
              </span>
            </div>
          </div>
        )}

        {/* Submit button & disabled reason explanation */}
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={!validation.isValid || listBot.isPending || listPaused}
            aria-busy={listBot.isPending}
            aria-describedby={
              !validation.isValid || listPaused ? `${priceInputId}-disabled-reason` : undefined
            }
            className={clsx(
              "btn-primary w-full py-3 text-base font-semibold transition-all",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {listBot.isPending ? "Listing Bot…" : "List for Sale"}
          </button>

          {listPaused ? (
            <p
              id={`${priceInputId}-disabled-reason`}
              role="status"
              className="text-center text-xs text-amber-400"
            >
              Listing is unavailable while the marketplace is paused.
            </p>
          ) : (
            !validation.isValid &&
            validation.reason && (
              <p
                id={`${priceInputId}-disabled-reason`}
                role="status"
                className="text-center text-xs text-muted"
              >
                {validation.reason}
              </p>
            )
          )}
        </div>
      </form>
    </Modal>
  );
}
