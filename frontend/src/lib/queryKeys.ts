/**
 * Centralized React Query configuration for the AutoMint frontend.
 *
 * One place for query keys, the poll cadence, and per-query freshness policy so
 * they cannot drift apart the way they did before: a global 5-minute
 * `staleTime` in `app/providers.tsx` while every hook set `refetchInterval:
 * 30000` (#496), and eight hooks each hard-coding their own interval (#495).
 *
 * Policy
 * ──────
 * - The global `staleTime` is **0**. A query that wants a longer freshness
 *   window opts into one from `STALE_TIME` at its own definition, so the policy
 *   is visible where the query lives.
 * - The poll cadence is `DASHBOARD_POLL_MS`, one constant, used via
 *   `pollWhenVisible()` from `./polling` (which also pauses a hidden tab).
 * - Retry behaviour is a predicate, see `./retry`.
 */
import type { QueryKey } from "@tanstack/react-query";

/**
 * Single source of truth for the dashboard poll cadence (#495).
 * Override with `NEXT_PUBLIC_DASHBOARD_POLL_MS`.
 */
export const DASHBOARD_POLL_MS =
  Number(process.env.NEXT_PUBLIC_DASHBOARD_POLL_MS) || 30_000;

/**
 * Freshness windows, declared once and referenced at each query definition
 * (#496). The global default is `REALTIME` (0).
 */
export const STALE_TIME = {
  /** Balances, points, registration — anything the user's own action changes. Always refetch on demand. */
  REALTIME: 0,
  /** Marketplace listings, leaderboard — moves often, not per-user, a few seconds of staleness is fine. */
  SHORT: 15_000,
  /** Profile, bot ownership — changes only on a mint / buy / claim. */
  STANDARD: 30_000,
  /** Tier metadata, contract config — effectively immutable for a session. */
  STATIC: Number.POSITIVE_INFINITY,
} as const;

/** Cache retention windows. */
export const GC_TIME = {
  SHORT: 120_000,
  STANDARD: 300_000,
  LONG: 600_000,
} as const;

/**
 * Structured query keys. The individual hooks still accept a nullable address
 * (their `enabled` guard stops the query firing with `null`); prefix
 * invalidation (`invalidateQueries({ queryKey: ["profile"] })`) keeps working.
 *
 * Every bigint is serialised to a string so React Query can hash keys
 * consistently — raw bigints are not JSON-serialisable (#494).
 *
 * Bot detail queries live under their own root key `["botDetails", ...]`,
 * separate from `["bots", ...]`, so invalidating the bot-ID list does not
 * trigger expensive N+1 detail refetches (#494).
 */
export const qk = {
  registered: (address: string | null): QueryKey => ["registered", address],
  profile: (address: string | null): QueryKey => ["profile", address],
  bots: (address: string | null): QueryKey => ["bots", address],
  /**
   * Nested under `bots` because the total rate is derived from bot ownership:
   * every mutation that invalidates `qk.bots(address)` refreshes it too (#490).
   */
  userTotalRate: (address: string | null): QueryKey => ["bots", address, "totalRate"],
  botDetails: (address: string | null, botId: bigint): QueryKey => [
    "botDetails",
    address,
    botId.toString(),
  ],
  allBotDetails: (address: string | null, botIds: bigint[]): QueryKey => [
    "botDetails",
    "all",
    address,
    botIds.map(String).join(","),
  ],
  accrualState: (address: string | null): QueryKey => ["accrualState", address],
  amtBalance: (address: string | null): QueryKey => ["amtBalance", address],
  amtDecimals: (): QueryKey => ["amtDecimals"],
  tiers: (): QueryKey => ["tiers"],
  dashboard: (address: string | null): QueryKey => ["dashboard", address],
  listings: (): QueryKey => ["listings"],
  myListings: (address: string | null): QueryKey => ["myListings", address],
  leaderboard: (limit: number): QueryKey => ["leaderboard", limit],
} as const;
