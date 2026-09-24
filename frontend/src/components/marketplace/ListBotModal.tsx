"use client";

import { useState, useMemo, useId } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { useListBot } from "@/hooks/useMarketplace";
import { xlmToStroops, stroopsToXlm, XLM_DECIMALS } from "@/lib/format";
import type { BotNFT } from "@/types";
import clsx from "clsx";

// Code-split the modal shell (framer-motion + createPortal) out of the
// marketplace route's initial bundle — it's only needed once a bot is listed.
const Modal = dynamic(() => import("@/components/ui/Modal"), { ssr: false });

const FEE_PERCENT = 2.5;
const NET_PERCENT = 100 - FEE_PERCENT;
const MAX_PRICE_XLM = 100_000_000;

interface ListBotModalProps {
  bot: BotNFT;
  isOpen: boolean;
  onClose: () => void;
}

export default function ListBotModal({ bot, isOpen, onClose }: ListBotModalProps) {
  const [priceXlm, setPriceXlm] = useState("");
  const [touched, setTouched] = useState(false);
  const listBot = useListBot();
  const priceInputId = useId();

  // Validate decimal precision, minimum and maximum against AM-122 and Stellar 7 decimals
  const validation = useMemo(() => {
    const trimmed = priceXlm.trim();
    if (!trimmed) {
      return { isValid: false, error: "Please enter a listing price in XLM.", reason: "Enter a price to enable listing." };
    }

    const num = Number(trimmed);
    if (isNaN(num) || !isFinite(num)) {
      return { isValid: false, error: "Price must be a valid number.", reason: "Price must be a valid number." };
    }

    if (num <= 0) {
      return { isValid: false, error: "Price must be greater than 0 XLM (minimum 0.0000001 XLM).", reason: "Price must be greater than 0 XLM." };
    }

    if (num > MAX_PRICE_XLM) {
      return { isValid: false, error: `Price cannot exceed ${MAX_PRICE_XLM.toLocaleString("en-US")} XLM.`, reason: "Price exceeds maximum allowed amount." };
    }

    const parts = trimmed.split(".");
    if (parts.length > 1 && (parts[1]?.length ?? 0) > XLM_DECIMALS) {
      return {
        isValid: false,
        error: `Price cannot exceed ${XLM_DECIMALS} decimal places (Stellar token precision limit).`,
        reason: `Maximum ${XLM_DECIMALS} decimal places allowed.`,
      };
    }

    const stroops = xlmToStroops(trimmed);
    if (stroops <= 0n) {
      return { isValid: false, error: "Price must be at least 1 stroop (0.0000001 XLM).", reason: "Price too low." };
    }

    return { isValid: true, error: null, reason: null, stroops, num };
  }, [priceXlm]);

  // Live fee breakdown computed in exact stroops matching contract base units
  const feeBreakdown = useMemo(() => {
    if (!validation.isValid || !validation.stroops) {
      return null;
    }
    const priceStroops = validation.stroops;
    // Contract logic: price * 25 / 1000
    const feeStroops = (priceStroops * 25n) / 1000n;
    const netStroops = priceStroops - feeStroops;

    return {
      priceStroops,
      feeStroops,
      netStroops,
      priceXlm: validation.num,
      feeXlm: stroopsToXlm(feeStroops),
      netXlm: stroopsToXlm(netStroops),
    };
  }, [validation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!validation.isValid || !validation.stroops) return;

    listBot.mutate(
      { botId: bot.id, price: validation.stroops },
      {
        onSuccess: () => {
          toast.success(`${bot.name} listed for ${priceXlm} XLM`);
          onClose();
          setPriceXlm("");
          setTouched(false);
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to list bot for sale. Please try again.",
          );
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
    <Modal isOpen={isOpen} onClose={onClose} title={`List ${bot.name} for Sale`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {/* Price input field with associated label, help text, and error linkage */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={priceInputId}
            id={`${priceInputId}-label`}
            className="text-sm font-medium text-text"
          >
            Listing Price (XLM) <span className="text-gold" aria-hidden="true">*</span>
          </label>

          <div className="relative">
            <input
              id={priceInputId}
              type="text"
              inputMode="decimal"
              placeholder="0.0000000"
              value={priceXlm}
              onChange={(e) => {
                setPriceXlm(e.target.value);
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
                  : "border-liner focus:border-gold/50 focus:ring-gold/30"
              )}
            />
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-muted text-sm">
              XLM
            </div>
          </div>

          <p id={`${priceInputId}-help`} className="text-xs text-muted">
            Enter price in XLM (min 0.0000001 XLM, max 7 decimal places).
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
              <span className="font-mono text-text">{priceXlm} XLM</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-muted text-xs sm:text-sm">
              <span>Marketplace Fee ({FEE_PERCENT}%)</span>
              <span className="font-mono text-pink">-{feeBreakdown.feeXlm.toFixed(7)} XLM</span>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-liner pt-2.5 font-semibold text-text">
              <span>You Receive ({NET_PERCENT}%)</span>
              <span className="font-mono text-green">{feeBreakdown.netXlm.toFixed(7)} XLM</span>
            </div>
          </div>
        )}

        {/* Submit button & disabled reason explanation */}
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={!validation.isValid || listBot.isPending}
            aria-busy={listBot.isPending}
            aria-describedby={!validation.isValid ? `${priceInputId}-disabled-reason` : undefined}
            className={clsx(
              "btn-primary w-full py-3 text-base font-semibold transition-all",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {listBot.isPending ? "Listing Bot…" : "List for Sale"}
          </button>

          {!validation.isValid && validation.reason && (
            <p
              id={`${priceInputId}-disabled-reason`}
              role="status"
              className="text-center text-xs text-muted"
            >
              {validation.reason}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
