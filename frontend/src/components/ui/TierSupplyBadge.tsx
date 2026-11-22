"use client";

/**
 * TierSupplyBadge — displays the optional per-tier mint cap (#385).
 *
 * Shows "12 / 100 remaining" when a cap is set, or nothing (null) when the
 * tier is uncapped (remaining === u64::MAX sentinel from the contract).
 *
 * Usage:
 *   <TierSupplyBadge minted={12n} cap={100n} />      → "12 / 100 remaining"
 *   <TierSupplyBadge minted={12n} cap={0n} />        → null (uncapped)
 *   <TierSupplyBadge minted={99n} cap={100n} />      → "99 / 100 remaining" (urgent)
 *   <TierSupplyBadge minted={100n} cap={100n} />     → "Sold out" badge
 */

import clsx from "clsx";

/** u64::MAX sentinel returned by `tier_remaining` when a tier is uncapped. */
const UNCAPPED_SENTINEL = BigInt("18446744073709551615"); // u64::MAX

interface TierSupplyBadgeProps {
  /** Number of bots already minted for the tier. */
  minted: bigint;
  /**
   * The cap value returned by `tier_cap(tier)`.
   * 0n means uncapped; the component renders nothing in that case.
   */
  cap: bigint;
  className?: string;
}

export default function TierSupplyBadge({
  minted,
  cap,
  className,
}: TierSupplyBadgeProps) {
  // Uncapped: cap is 0 or sentinel — render nothing
  if (cap === 0n || cap === UNCAPPED_SENTINEL) return null;

  const remaining = cap > minted ? cap - minted : 0n;
  const soldOut = remaining === 0n;
  // Treat <=10% remaining as "urgent"
  const isUrgent = !soldOut && remaining * 10n <= cap;

  return (
    <span
      role="status"
      aria-label={
        soldOut
          ? `${cap.toString()} / ${cap.toString()} minted — Sold out`
          : `${minted.toString()} of ${cap.toString()} minted — ${remaining.toString()} remaining`
      }
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        soldOut
          ? "bg-red-500/15 text-red-400 border border-red-500/30"
          : isUrgent
          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
          : "bg-card-2 text-muted border border-liner",
        className,
      )}
      data-testid="tier-supply-badge"
    >
      {soldOut ? (
        <>
          {/* Sold out dot */}
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-red-400"
          />
          Sold out
        </>
      ) : (
        <>
          {/* Fill indicator dot */}
          <span
            aria-hidden="true"
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              isUrgent ? "bg-amber-400" : "bg-green-400",
            )}
          />
          <span>
            {minted.toString()}
            {" / "}
            {cap.toString()}
            {" "}
            <span className="font-normal opacity-70">remaining</span>
          </span>
        </>
      )}
    </span>
  );
}
