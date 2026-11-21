// ── Contract data types (matching Soroban contracttype structs) ───────────────

export type BotTier = 'Basic' | 'Bronze' | 'Silver' | 'Gold' | 'Diamond';
export type Tier = BotTier;

export interface BotNFT {
  id: bigint;
  tier: BotTier;
  owner: string;
  nickname?: string;
  name?: string;
  accrualRate?: bigint; // points per hour
  accrual_rate?: bigint;
  mintedAt?: bigint;
  minted_at?: bigint;
  lastClaimTimestamp?: bigint;
  last_claim_timestamp?: bigint;
}

export interface UserProfile {
  address: string;
  username: string;
  totalPoints: bigint;
  points?: bigint;
  total_points?: bigint;
  claimed_amt?: bigint;
  display_name?: string;
  claimedAmt: bigint;
  registeredAt: bigint;
  registered_at?: bigint;
  botCount: number;
  bot_count?: number;
}

export interface Listing {
  id: bigint;
  seller: string;
  botId: bigint;
  botTier: number;
  price: bigint; // in stroops
  currency: string;
  listedAt: bigint;
  active: boolean;
}

export interface MarketplaceListing {
  id: bigint;
  seller: string;
  bot_id: bigint;
  bot_tier: BotTier;
  price: bigint;
  currency: string;
  listed_at: bigint;
  active: boolean;
  // Camel-case aliases used by existing marketplace cards.
  botId: bigint;
  botTier: number;
  listedAt: bigint;
}

export interface MarketplacePurchase {
  listing_id: bigint;
  bot_id: bigint;
  bot_tier: BotTier | number;
  price: bigint;
  currency: string;
  seller: string;
  buyer: string;
  purchased_at: bigint;
}

export interface AccrualState {
  last_claim_ts: bigint;
  lastClaimTs?: bigint;
  totalClaimedPoints?: bigint;
  carry_points: bigint;
  lifetime_points: bigint;
  rate: bigint;
  started_at: bigint;
}

export interface TierStats {
  tier: BotTier;
  volume: bigint;
  sale_count: bigint;
  last_sale_price: bigint;
  floor_price: bigint;
}

export interface TierInfo {
  tier?: BotTier;
  name: string;
  rate: bigint;
  price: bigint;
}

export const TIER_ORDER: BotTier[] = ['Basic', 'Bronze', 'Silver', 'Gold', 'Diamond'];

// ── UI state types ────────────────────────────────────────────────────────────

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WalletState {
  status: WalletStatus;
  publicKey: string | null;
  network: string | null;
  error: string | null;
}

export type TxStatus = 'idle' | 'building' | 'signing' | 'submitting' | 'polling' | 'success' | 'error';

export interface TxState {
  status: TxStatus;
  hash?: string;
  error?: string;
}

// ── Tier metadata ─────────────────────────────────────────────────────────────

export interface TierMeta {
  tier: BotTier;
  index: number;
  label: string;
  ratePerHour: number;
  priceXlm: number;
  color: string;
  bgGradient: string;
  emoji: string;
}

export const TIER_META: Record<BotTier, TierMeta> = {
  Basic: {
    tier: 'Basic',
    index: 0,
    label: 'Basic Bot',
    ratePerHour: 1,
    priceXlm: 0,
    color: '#6B7280',
    bgGradient: 'from-gray-700 to-gray-900',
    emoji: '🤖',
  },
  Bronze: {
    tier: 'Bronze',
    index: 1,
    label: 'Bronze Bot',
    ratePerHour: 5,
    priceXlm: 100,
    color: '#CD7F32',
    bgGradient: 'from-amber-800 to-amber-950',
    emoji: '🥉',
  },
  Silver: {
    tier: 'Silver',
    index: 2,
    label: 'Silver Bot',
    ratePerHour: 25,
    priceXlm: 500,
    color: '#C0C0C0',
    bgGradient: 'from-slate-400 to-slate-700',
    emoji: '🥈',
  },
  Gold: {
    tier: 'Gold',
    index: 3,
    label: 'Gold Bot',
    ratePerHour: 100,
    priceXlm: 2000,
    color: '#FFD700',
    bgGradient: 'from-yellow-500 to-yellow-800',
    emoji: '🥇',
  },
  Diamond: {
    tier: 'Diamond',
    index: 4,
    label: 'Diamond Bot',
    ratePerHour: 500,
    priceXlm: 10000,
    color: '#B9F2FF',
    bgGradient: 'from-cyan-300 to-blue-700',
    emoji: '💎',
  },
};

export function tierFromIndex(index: number): BotTier {
  const tiers: BotTier[] = ['Basic', 'Bronze', 'Silver', 'Gold', 'Diamond'];
  return tiers[index] ?? 'Basic';
}

export function formatPoints(points: bigint | number): string {
  const n = typeof points === 'bigint' ? Number(points) : points;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function xlmToStroops(xlm: number): bigint {
  return BigInt(Math.round(xlm * 10_000_000));
}

export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / 10_000_000;
}
