"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import clsx from "clsx";
import type { BotNFT } from "@/types";
import { TIER_META, BOT_TIER_COLORS, BOT_TIER_BG_COLORS } from "@/types";
import { fromBaseUnits } from "@/lib/format";

export interface BotRateBreakdown {
  bot: BotNFT;
}

export interface PointsCounterProps {
  /** Total accumulated points to display */
  points: number;
  /** Aggregate accrual rate (pts/hr) */
  rate: number;
  /** Optional per-bot breakdown for the rate detail rows */
  bots?: BotNFT[];
  /** Optional AMT token balance, in the token's base units */
  amtBalance?: bigint;
  /** The AMT token's `decimals()`; the balance row renders once it is known */
  amtDecimals?: number | undefined;
}

/**
 * Animate a numeric value smoothly between updates.
 */
function useAnimatedNumber(target: number, duration = 0.8) {
  const [displayed, setDisplayed] = useState(target);
  const prev = useRef(target);

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    let start: number | null = null;

    const step = (timestamp: number) => {
      if (start === null) start = timestamp;
      const elapsed = (timestamp - start) / (duration * 1000);
      const t = Math.min(elapsed, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out quad
      setDisplayed(Math.round(from + (target - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }, [target, duration]);

  return displayed;
}

function PointsCounterComponent({
  points,
  rate,
  bots,
  amtBalance,
  amtDecimals,
}: PointsCounterProps) {
  const animatedPoints = useAnimatedNumber(points);

  return (
    <div
      className={clsx("rounded-2xl border border-liner bg-card p-5", "flex flex-col gap-4")}
      data-testid="points-counter"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted" id="total-points-label">
          Total Points
        </p>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/15">
          <Zap className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
        </div>
      </div>

      {/* Animated points display */}
      <div>
        <p
          className="font-display text-3xl font-bold text-text tabular-nums sm:text-4xl"
          data-testid="total-points"
          aria-live="polite"
          aria-atomic="true"
          aria-labelledby="total-points-label"
        >
          {animatedPoints.toLocaleString("en-US")}
        </p>

        {/* AMT balance row */}
        {amtBalance !== undefined && amtDecimals !== undefined && (
          <p className="mt-1 text-xs text-muted">
            ≈{" "}
            <span className="text-gold font-semibold">
              {fromBaseUnits(amtBalance, amtDecimals).toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </span>{" "}
            AMT
          </p>
        )}
      </div>

      {/* Accrual rate summary */}
      <div
        className="flex items-center gap-1.5 rounded-lg bg-card-2 px-3 py-2 text-xs"
        data-testid="accrual-rate"
        aria-label={`Earning ${rate} points per hour`}
      >
        <Zap className="h-3 w-3 text-green flex-shrink-0" aria-hidden="true" />
        <span className="text-muted">Earning</span>
        <span className="font-semibold text-green">+{rate} pts/hr</span>
      </div>

      {/* Per-bot rate breakdown */}
      {bots && bots.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-wider text-muted">Rate Breakdown</p>
          <div className="flex flex-col gap-1.5">
            {bots.map((bot) => {
              const meta = TIER_META[bot.tier];
              const tierColor = BOT_TIER_COLORS[bot.tier] ?? "text-muted";
              const tierBg = BOT_TIER_BG_COLORS[bot.tier] ?? "bg-muted/20";
              return (
                <motion.div
                  key={bot.id.toString()}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-between gap-2 rounded-lg bg-card-2 px-3 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={clsx(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs",
                        tierBg,
                      )}
                      aria-hidden="true"
                    >
                      {meta?.emoji ?? "🤖"}
                    </span>
                    <span
                      className={clsx("min-w-0 flex-1 truncate text-xs font-medium", tierColor)}
                    >
                      {bot.name || bot.tier}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">#{bot.id.toString()}</span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-text">
                    +{bot.accrual_rate.toString()}{" "}
                    <span className="font-normal text-muted">pt/hr</span>
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export const PointsCounter = React.memo(PointsCounterComponent);
