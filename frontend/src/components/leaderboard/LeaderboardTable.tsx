"use client";

import React from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { formatPoints, type UserProfile } from "@/types";
import type { UserRank } from "@/lib/contracts";
import { truncateAddress, fullAddressTitle, fullAddressAriaLabel, useCopyToClipboard } from "@/lib/truncateAddress";

/**
 * A leaderboard row: exactly the profile the registry returns, plus the
 * 1-based position it occupies.
 *
 * Deliberately built on `UserProfile` rather than restating its fields.
 * The previous hand-written shape declared `points: number`, which forced
 * the page to call `Number(profile.points)` on a `u64` and silently lose
 * precision past 2^53, and it made `username` optional and `address`
 * nullable even though the contract always supplies both.
 */
export interface LeaderboardUser extends UserProfile {
  /** 1-based position in the ranking. */
  rank: number;
}

export interface LeaderboardTableProps {
  users: LeaderboardUser[];
  /** Connected wallet's public key — used to highlight the current user's row */
  currentAddress?: string | null;
  /**
   * The connected user's own standing. Pinned to the bottom of the table
   * when they fall outside the visible rows, so a user ranked #312 still
   * sees where they are. Omitted (or `null`) for a disconnected visitor,
   * and ignored when the user already has a row above.
   */
  currentUserRank?: UserRank | null;
}

const RANK_ICON: Record<number, { icon: string; color: string; label: string }> = {
  1: { icon: "🥇", color: "text-gold", label: "1st place" },
  2: { icon: "🥈", color: "text-tier-silver", label: "2nd place" },
  3: { icon: "🥉", color: "text-tier-bronze", label: "3rd place" },
};

function LeaderboardCard({
  user,
  isCurrentUser,
  rankMeta,
  index,
}: {
  user: LeaderboardUser;
  isCurrentUser: boolean;
  rankMeta: (typeof RANK_ICON)[number] | undefined;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      data-testid={`user-card-${user.rank}`}
      aria-current={isCurrentUser ? "true" : undefined}
      className={clsx(
        "rounded-xl border border-liner p-4 transition-colors",
        isCurrentUser
          ? "bg-gold/5 border-l-2 border-l-gold ring-1 ring-gold/30"
          : "bg-card hover:bg-white/[0.02]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {rankMeta ? (
            <span className={clsx("inline-flex items-center gap-1.5", rankMeta.color)}>
              <span aria-hidden="true" className="text-xl leading-none">
                {rankMeta.icon}
              </span>
              <span aria-hidden="true" className="text-sm font-bold text-text">
                {user.rank}
              </span>
              <span className="sr-only">{rankMeta.label}</span>
            </span>
          ) : (
            <span className="text-muted">
              <span aria-hidden="true" className="font-bold">#{user.rank}</span>
              <span className="sr-only">Rank {user.rank}</span>
            </span>
          )}
        </div>
        {isCurrentUser && (
          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
            You
          </span>
        )}
      </div>
      <div className="mt-2">
        <span className={clsx("font-medium", isCurrentUser ? "text-gold" : "text-text")}>
          {user.username || `Trader #${user.rank}`}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-text">{user.points.toLocaleString()} pts</span>
        {user.address && (
          <span className="font-mono text-xs text-muted"
  title={fullAddressTitle(user.address)}
  aria-label={fullAddressAriaLabel(user.address)}
>
  {truncateAddress(user.address)}
</span>
        )}
      </div>
    </motion.div>
  );
}

function LeaderboardTableComponent({
  users,
  currentAddress,
  currentUserRank,
}: LeaderboardTableProps) {
  if (!users || users.length === 0) {
    return (
      <div data-testid="empty-leaderboard" className="text-muted text-sm text-center py-10">
        No leaderboard data available
      </div>
    );
  }

  const normalizedCurrentAddress = currentAddress?.toLowerCase() ?? null;

  // The pinned row exists to tell a user something the table above cannot.
  // Drop it when there is no connected wallet, when the contract had no
  // standing to report, and when the user already occupies a visible row —
  // a top-50 user gets the highlight, not a duplicate of themselves.
  const isAlreadyVisible =
    normalizedCurrentAddress !== null &&
    users.some((user) => user.address.toLowerCase() === normalizedCurrentAddress);
  const pinnedRank =
    normalizedCurrentAddress !== null && currentUserRank && !isAlreadyVisible
      ? currentUserRank
      : null;

  return (
    <div
      className="overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      data-testid="leaderboard-table"
      role="region"
      aria-label="Leaderboard rankings, scrollable"
      tabIndex={0}
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Leaderboard rankings</caption>
        <thead>
          <tr className="border-b border-liner text-muted text-xs uppercase tracking-wider">
            <th scope="col" className="px-2 py-3 sm:px-4">
              Rank
            </th>
            <th scope="col" className="px-2 py-3 sm:px-4">
              User
            </th>
            <th scope="col" className="px-2 py-3 text-right sm:px-4">
              Points
            </th>
            <th scope="col" className="px-2 py-3 sm:px-4">
              Address
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, idx) => {
            const isCurrentUser =
              normalizedCurrentAddress !== null &&
              user.address.toLowerCase() === normalizedCurrentAddress;
            const rankMeta = RANK_ICON[user.rank];

            return (
              <motion.tr
                key={user.address || user.username || idx}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: idx * 0.04 }}
                data-testid={`user-row-${user.rank}`}
                aria-current={isCurrentUser ? "true" : undefined}
                className={clsx(
                  "border-b border-liner transition-colors",
                  isCurrentUser ? "bg-gold/5 border-l-2 border-l-gold" : "hover:bg-white/[0.02]",
                )}
              >
                {/* Rank — colour and emoji are never the only signal: the
                    medal glyph is decorative (aria-hidden) with an sr-only
                    label, and a visible numeric rank sits alongside it so
                    the position is identifiable in greyscale. */}
                <td className="px-2 py-3 font-bold sm:px-4">
                  {rankMeta ? (
                    <span className={clsx("inline-flex items-center gap-1.5", rankMeta.color)}>
                      <span aria-hidden="true" className="text-base leading-none">
                        {rankMeta.icon}
                      </span>
                      <span aria-hidden="true" className="text-sm font-bold text-text">
                        {user.rank}
                      </span>
                      <span className="sr-only">{rankMeta.label}</span>
                    </span>
                  ) : (
                    <span className="text-muted">
                      <span aria-hidden="true">#{user.rank}</span>
                      <span className="sr-only">Rank {user.rank}</span>
                    </span>
                  )}
                </td>

                {/* Username / display name */}
                <td className="px-2 py-3 sm:px-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx("font-medium", isCurrentUser ? "text-gold" : "text-text")}
                    >
                      {user.username || `Trader #${user.rank}`}
                    </span>
                    {isCurrentUser && (
                      <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
                        You
                      </span>
                    )}
                  </div>
                </td>

                {/* Points — formatted straight from the bigint the contract
                    returned; never narrowed to a JS number. */}
                <td className="px-2 py-3 text-right font-semibold text-text sm:px-4">
                  {formatPoints(user.points)}
                </td>

                {/* Truncated address */}
<td className="px-2 py-3 font-mono text-xs text-muted sm:px-4"
  title={fullAddressTitle(user.address)}
  aria-label={fullAddressAriaLabel(user.address)}
>
                    {truncateAddress(user.address)}
                  </td>
              </motion.tr>
            );
          })}
        </tbody>

        {pinnedRank && (
          <tfoot>
            <tr
              data-testid="current-user-rank-row"
              aria-current="true"
              className="sticky bottom-0 border-t-2 border-gold/40 bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.35)]"
            >
              {/* Rank — an unranked user is told so in words rather than
                  being shown a sentinel number. */}
              <td className="px-2 py-3 font-bold sm:px-4">
                {pinnedRank.rank === null ? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Unranked
                  </span>
                ) : (
                  <span className="text-gold">
                    <span aria-hidden="true">#{pinnedRank.rank}</span>
                    <span className="sr-only">Your rank {pinnedRank.rank}</span>
                  </span>
                )}
              </td>

              <td className="px-2 py-3 sm:px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gold">
                    {pinnedRank.username || "Your position"}
                  </span>
                  <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
                    You
                  </span>
                  {pinnedRank.rank === null ? (
                    <span className="text-xs text-muted">
                      Claim points to enter the rankings
                    </span>
                  ) : (
                    pinnedRank.pointsToNextRank !== null && (
                      <span className="text-xs text-muted">
                        {formatPoints(pinnedRank.pointsToNextRank)} points to reach #
                        {pinnedRank.rank - 1}
                      </span>
                    )
                  )}
                </div>
              </td>

              <td className="px-2 py-3 text-right font-semibold text-text sm:px-4">
                {formatPoints(pinnedRank.points)}
              </td>

              <td className="px-2 py-3 font-mono text-xs text-muted sm:px-4">
                {truncateAddress(pinnedRank.address)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export const LeaderboardTable = React.memo(LeaderboardTableComponent);
