"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, TrendingUp } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import { useTiers } from "@/hooks/useTiers";

interface UpgradePromptProps {
  currentRate: number;
}

export default function UpgradePrompt({ currentRate: _currentRate }: UpgradePromptProps) {
  // Tier rates come from the bot_nft contract (#478), not a client-side table.
  const { data: tiers } = useTiers();
  const basicRate = tiers ? Number(tiers.Basic.rate) : 0;
  const diamondMultiplier = tiers && basicRate > 0 ? Number(tiers.Diamond.rate) / basicRate : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-liner bg-card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green" aria-hidden="true" />
            <h4 className="font-display text-sm font-semibold text-text">Boost Your Earnings</h4>
          </div>
          <p className="mt-2 text-xs text-muted">
            Upgrade to higher-tier bots to earn points faster.
            {diamondMultiplier !== null &&
              ` Diamond bots earn ${diamondMultiplier}x the rate of Basic bots!`}
          </p>
        </div>

        <Link
          href="/marketplace"
          className={clsx(
            "flex shrink-0 items-center gap-1.5 rounded-xl",
            "border border-liner bg-card-2 px-3 py-2",
            "text-xs font-medium text-text",
            "hover:bg-white/5 hover:border-white/10 transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          <span>Marketplace</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </motion.div>
  );
}
