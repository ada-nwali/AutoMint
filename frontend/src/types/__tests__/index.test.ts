/**
 * Unit tests for types/index.ts helper functions (#239)
 * Tests tierFromIndex and formatPoints for correctness at normal and boundary
 * values (0, max tier index, large bigints). The XLM/stroop conversions moved
 * to lib/format.ts and are tested in lib/__tests__/format.test.ts (#479).
 */

import {
  tierFromIndex,
  formatPoints,
  BOT_TIER_NAMES,
  BOT_TIER_COLORS,
  BOT_TIER_BG_COLORS,
  TIER_META,
} from "../index";

describe("types/index.ts Helpers (#239)", () => {
  describe("tierFromIndex", () => {
    it("returns correct tier for standard valid indices", () => {
      expect(tierFromIndex(0)).toBe("Basic");
      expect(tierFromIndex(1)).toBe("Bronze");
      expect(tierFromIndex(2)).toBe("Silver");
      expect(tierFromIndex(3)).toBe("Gold");
      expect(tierFromIndex(4)).toBe("Diamond");
    });

    it("clamps at maximum tier index for out-of-bounds large indices", () => {
      expect(tierFromIndex(5)).toBe("Diamond");
      expect(tierFromIndex(10)).toBe("Diamond");
      expect(tierFromIndex(9999)).toBe("Diamond");
    });

    it("handles boundary values and negative indices gracefully", () => {
      expect(tierFromIndex(-1)).toBe("Basic");
      expect(tierFromIndex(NaN as any)).toBe("Basic");
    });
  });

  describe("formatPoints", () => {
    it("formats 0 points correctly", () => {
      expect(formatPoints(0n)).toBe("0");
    });

    it("formats small and typical point amounts with comma separators", () => {
      expect(formatPoints(100n)).toBe("100");
      expect(formatPoints(1000n)).toBe("1,000");
      expect(formatPoints(25000n)).toBe("25,000");
      expect(formatPoints(1234567n)).toBe("1,234,567");
    });

    it("formats very large bigint values correctly", () => {
      expect(formatPoints(1_000_000_000n)).toBe("1,000,000,000");
      expect(formatPoints(987_654_321_000n)).toBe("987,654,321,000");
      expect(formatPoints(10_000_000_000_000n)).toBe("10,000,000,000,000");
    });
  });

  describe("Tier metadata and styling dictionaries", () => {
    it("defines valid metadata and colors for all 5 tiers", () => {
      const tiers = ["Basic", "Bronze", "Silver", "Gold", "Diamond"] as const;
      for (const tier of tiers) {
        expect(BOT_TIER_NAMES[tier]).toBe(tier);
        expect(BOT_TIER_COLORS[tier]).toBeDefined();
        expect(BOT_TIER_BG_COLORS[tier]).toBeDefined();
        expect(TIER_META[tier]).toBeDefined();
        expect(TIER_META[tier].emoji).toBeDefined();
      }
    });

    it("keeps no numeric tier data client-side — rates and prices come from bot_nft (#478)", () => {
      for (const meta of Object.values(TIER_META)) {
        expect(Object.keys(meta).sort()).toEqual(["color", "emoji"]);
        for (const value of Object.values(meta)) {
          expect(typeof value).not.toBe("number");
          expect(typeof value).not.toBe("bigint");
        }
      }
    });
  });
});
