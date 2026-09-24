/**
 * Shared TypeScript types for the AutoMint frontend.
 */

export type BotTier = "Basic" | "Bronze" | "Silver" | "Gold" | "Diamond";
export type Tier = BotTier;

export interface UserProfile {
  /** Wallet address the profile belongs to. Always present — `parseUserProfile`
   *  reads it from the registry's `UserProfile.address` field. */
  address: string;
  username: string;
  /** Total points accrued on-chain (registry `total_points`). */
  total_points: bigint;
  /** Alias for `total_points` kept for existing UI code. */
  points: bigint;
  claimed_amt: bigint;
  /** Alias for `claimed_amt` (`claimedAmt` camelCase). */
  claimedAmt: bigint;
  registered_at: number;
  /** Alias for `registered_at` (`registeredAt` camelCase). */
  registeredAt: number;
  bot_count: number;
  /** Alias for `bot_count` (`botCount` camelCase). */
  botCount: number;
}

export interface BotNFT {
  id: bigint;
  name: string;
  owner: string;
  tier: BotTier;
  accrual_rate: bigint;
  minted_at: number;
  last_claim_timestamp: bigint;
}

export interface MarketplaceListing {
  id: bigint;
  seller: string;
  bot_id: bigint;
  price: bigint;
  listed_at: bigint;
}

export type Listing = MarketplaceListing;

export interface UserVault {
  user: string;
  balance: bigint;
}

export const BOT_TIER_NAMES: Record<BotTier, string> = {
  Basic: "Basic",
  Bronze: "Bronze",
  Silver: "Silver",
  Gold: "Gold",
  Diamond: "Diamond",
};

export const BOT_TIER_COLORS: Record<BotTier, string> = {
  Basic: "text-tier-basic",
  Bronze: "text-tier-bronze",
  Silver: "text-tier-silver",
  Gold: "text-tier-gold",
  Diamond: "text-tier-diamond",
};

export const BOT_TIER_BG_COLORS: Record<BotTier, string> = {
  Basic: "bg-tier-basic/20",
  Bronze: "bg-tier-bronze/20",
  Silver: "bg-tier-silver/20",
  Gold: "bg-tier-gold/20",
  Diamond: "bg-tier-diamond/20",
};
export interface AccrualState {
  last_claim_ts: bigint;
  total_claimed_points: bigint;
}

/**
 * Presentational tier fields only. Rates and prices are contract data, read
 * from bot_nft by `useTiers` (#478) — never hardcode them here.
 */
export interface TierMeta {
  color: string;
  emoji: string;
}

export const TIER_META: Record<BotTier, TierMeta> = {
  Basic: { color: "text-tier-basic", emoji: "🤖" },
  Bronze: { color: "text-tier-bronze", emoji: "🥉" },
  Silver: { color: "text-tier-silver", emoji: "🥈" },
  Gold: { color: "text-tier-gold", emoji: "🥇" },
  Diamond: { color: "text-tier-diamond", emoji: "💎" },
};

/** A tier's economics as reported by bot_nft `get_tier_info` (#478). */
export interface TierInfo {
  tier: BotTier;
  /** Contract display name, e.g. "Gold Bot". */
  name: string;
  /** Accrual rate in points per hour (`BotTier::rate()`). */
  rate: bigint;
  /** Mint price in stroops (`BotTier::price()`). */
  price: bigint;
}

/** Tiers in `BotTier` discriminant order (Basic = 0 … Diamond = 4). */
export const TIER_ORDER: BotTier[] = ["Basic", "Bronze", "Silver", "Gold", "Diamond"];

export function tierFromIndex(index: number): BotTier {
  return TIER_ORDER[Math.min(index, TIER_ORDER.length - 1)] ?? "Basic";
}

export function formatPoints(points: bigint): string {
  // `Intl` formats a BigInt directly. Going through `Number` first would
  // round away every digit past 2^53, so a large points balance would render
  // a value the contract never held.
  return points.toLocaleString("en-US");
}

