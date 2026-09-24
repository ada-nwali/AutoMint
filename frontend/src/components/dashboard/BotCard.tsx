"use client";

import { motion } from "framer-motion";
import { Bot, Clock, Zap, Tag, Circle, Shield, Hexagon, Crown, Gem } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { BOT_TIER_NAMES, BOT_TIER_COLORS, BOT_TIER_BG_COLORS } from "@/types";
import type { BotNFT, BotTier } from "@/types";

interface BotCardProps {
  bot: BotNFT;
  onListForSale?: (botId: bigint) => void;
}

/**
 * Non-colour tier differentiators (WCAG 1.4.1). Each tier gets a distinct
 * icon *shape* and a distinct badge *border pattern* so the tier is
 * identifiable in greyscale and by screen readers via the adjacent text
 * label — colour is never the only signal.
 */
const TIER_ICON: Record<BotTier, LucideIcon> = {
  Basic: Circle,
  Bronze: Shield,
  Silver: Hexagon,
  Gold: Crown,
  Diamond: Gem,
};

const TIER_BADGE_BORDER: Record<BotTier, string> = {
  Basic: "border border-dashed border-current/40",
  Bronze: "border border-dotted border-current/50",
  Silver: "border border-solid border-current/40",
  Gold: "border-2 border-double border-current/60",
  Diamond: "border-2 border-dashed border-current/50",
};

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BotCard({ bot, onListForSale }: BotCardProps) {
  const tierName = BOT_TIER_NAMES[bot.tier] ?? "Unknown";
  const tierColor = BOT_TIER_COLORS[bot.tier] ?? "text-muted";
  const tierBg = BOT_TIER_BG_COLORS[bot.tier] ?? "bg-muted/20";
  const TierIcon = TIER_ICON[bot.tier] ?? Circle;
  const tierBorder = TIER_BADGE_BORDER[bot.tier] ?? "border border-solid border-current/40";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={clsx(
        "relative rounded-2xl border border-liner bg-card p-5",
        "flex flex-col gap-4",
        "hover:border-white/10 transition-colors",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={clsx(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              tierBg,
            )}
          >
            <Bot className={clsx("h-5 w-5", tierColor)} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p
              className="truncate font-display text-sm font-semibold text-text"
              title={bot.name || tierName}
            >
              {bot.name || tierName}
            </p>
            <p className="text-xs text-muted">#{bot.id.toString()}</p>
          </div>
        </div>

        <span
          data-testid="tier-badge"
          data-tier={tierName}
          className={clsx(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5",
            "text-xs font-medium",
            tierBg,
            tierColor,
            tierBorder,
          )}
        >
          <TierIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {tierName}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2">
          <Zap className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted">Rate</p>
            <p className="truncate text-sm font-semibold text-text">
              {bot.accrual_rate.toString()}{" "}
              <span className="text-xs font-normal text-muted">pt/hr</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-blue" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted">Minted</p>
            <p className="truncate text-sm font-semibold text-text">{formatDate(bot.minted_at)}</p>
          </div>
        </div>
      </div>

      {onListForSale && (
        <button
          type="button"
          onClick={() => onListForSale(bot.id)}
          aria-label={`List for Sale — ${bot.name || tierName} #${bot.id.toString()}`}
          className={clsx(
            "flex min-h-11 items-center justify-center gap-2",
            "rounded-xl border border-liner bg-card-2 px-4 py-2.5",
            "text-sm font-medium text-text",
            "hover:bg-white/5 hover:border-white/10 transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          <Tag className="h-3.5 w-3.5" aria-hidden="true" />
          List for Sale
        </button>
      )}
    </motion.div>
  );
}
