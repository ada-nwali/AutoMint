export const STALE_TIME = {
  SHORT: 15_000,
  LONG: 5 * 60_000,
};

export const GC_TIME = {
  SHORT: 60_000,
  LONG: 30 * 60_000,
};

export const qk = {
  listings: () => ["listings"] as const,
  filteredListings: (tier: number | null, maxPrice: bigint | null) =>
    ["listings", "filtered", tier, maxPrice?.toString()] as const,
  myListings: (address: string | null) => ["myListings", address] as const,
  marketStats: () => ["marketStats"] as const,
  purchases: (address: string | null) => ["purchases", address] as const,
  bots: (address: string | null) => ["bots", address] as const,
  botDetails: (botId: bigint | string) => ["botDetails", String(botId)] as const,
  accrualState: (address: string | null) => ["accrualState", address] as const,
  dashboard: (address: string | null) => ["dashboard", address] as const,
};
