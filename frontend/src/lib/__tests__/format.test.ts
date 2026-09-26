/**
 * Unit tests for lib/format.ts (#479): the XLM/stroop conversions (moved from
 * types/index.ts, #239) and the generic base-unit helpers used for AMT, at
 * normal and boundary values.
 */

import {
  STROOPS_PER_XLM,
  xlmToStroops,
  stroopsToXlm,
  stroopsToXlmString,
  toBaseUnits,
  fromBaseUnits,
} from "../format";

describe("STROOPS_PER_XLM", () => {
  it("is 10,000,000 — a stroop is 1e-7 XLM", () => {
    expect(STROOPS_PER_XLM).toBe(10_000_000n);
    expect(xlmToStroops(1)).toBe(STROOPS_PER_XLM);
  });
});

describe("xlmToStroops", () => {
  it("converts 0 XLM to 0n stroops", () => {
    expect(xlmToStroops(0)).toBe(0n);
    expect(xlmToStroops("0")).toBe(0n);
  });

  it("converts 1 XLM to 10,000,000n stroops", () => {
    expect(xlmToStroops(1)).toBe(10_000_000n);
    expect(xlmToStroops("1")).toBe(10_000_000n);
  });

  it("converts fractional XLM values correctly", () => {
    expect(xlmToStroops(0.5)).toBe(5_000_000n);
    expect(xlmToStroops(0.0000001)).toBe(1n);
    expect(xlmToStroops("0.0000001")).toBe(1n);
    expect(xlmToStroops("12.3456789")).toBe(123_456_789n);
  });

  it("converts large XLM amounts to bigints without overflow", () => {
    expect(xlmToStroops(100_000)).toBe(1_000_000_000_000n);
    expect(xlmToStroops(5_000_000)).toBe(50_000_000_000_000n);
  });
  it("returns 0n for invalid inputs", () => {
    expect(xlmToStroops("")).toBe(0n);
    expect(xlmToStroops("abc")).toBe(0n);
    expect(xlmToStroops(NaN)).toBe(0n);
    expect(xlmToStroops(Infinity)).toBe(0n);
    // @ts-expect-error intentional invalid type
    expect(xlmToStroops(null)).toBe(0n);
  });

  it("truncates fractional precision past 7 decimal places", () => {
    // Integer part stays; the fraction is sliced to 7 digits, not rounded.
    expect(xlmToStroops("1.12345678")).toBe(11_234_567n);
    expect(xlmToStroops("0.00000019")).toBe(1n);
  });

  it("handles negative string amounts", () => {
    expect(xlmToStroops("-1.5")).toBe(-15_000_000n);
    expect(xlmToStroops("-2")).toBe(-20_000_000n);
  });
});

describe("stroopsToXlmString", () => {
  it("formats whole XLM amounts without a decimal point", () => {
    expect(stroopsToXlmString(0n)).toBe("0");
    expect(stroopsToXlmString(10_000_000n)).toBe("1");
    expect(stroopsToXlmString(1_000_000_000n)).toBe("100");
  });

  it("strips trailing zeros from the fractional part", () => {
    expect(stroopsToXlmString(15_000_000n)).toBe("1.5");
    expect(stroopsToXlmString(1_000_000n)).toBe("0.1");
    expect(stroopsToXlmString(1n)).toBe("0.0000001");
  });

  it("preserves the sign for negative amounts", () => {
    expect(stroopsToXlmString(-10_000_000n)).toBe("-1");
    expect(stroopsToXlmString(-15_000_000n)).toBe("-1.5");
  });

  it("round-trips losslessly with xlmToStroops at 7-decimal precision", () => {
    for (const xlm of [
      "0",
      "0.0000001",
      "1",
      "1.5",
      "12.3456789",
      "99999999.9999999",
      "-0.0000001",
    ]) {
      expect(stroopsToXlmString(xlmToStroops(xlm))).toBe(xlm);
    }
  });
});

describe("stroopsToXlm", () => {
  it("converts 0n stroops to 0 XLM", () => {
    expect(stroopsToXlm(0n)).toBe(0);
  });

  it("converts 10,000,000n stroops to 1 XLM", () => {
    expect(stroopsToXlm(10_000_000n)).toBe(1);
  });

  it("converts fractional stroops to exact decimal XLM values", () => {
    expect(stroopsToXlm(5_000_000n)).toBe(0.5);
    expect(stroopsToXlm(1n)).toBe(0.0000001);
    expect(stroopsToXlm(123_456_789n)).toBe(12.3456789);
  });

  it("converts large bigint stroops amounts correctly", () => {
    expect(stroopsToXlm(1_000_000_000_000n)).toBe(100_000);
    expect(stroopsToXlm(50_000_000_000_000n)).toBe(5_000_000);
  });

  it("round-trips between XLM and stroops accurately", () => {
    const testValues = [0, 0.0000001, 0.5, 1, 5, 40, 100, 2500.5, 1000000];
    for (const xlm of testValues) {
      const stroops = xlmToStroops(xlm);
      const backToXlm = stroopsToXlm(stroops);
      expect(backToXlm).toBeCloseTo(xlm, 7);
    }
  });
});

describe("toBaseUnits / fromBaseUnits", () => {
  it("scale by the given decimals rather than assuming 7", () => {
    expect(toBaseUnits("1", 7)).toBe(10_000_000n);
    expect(toBaseUnits("1", 6)).toBe(1_000_000n);
    expect(toBaseUnits("2.5", 6)).toBe(2_500_000n);
    expect(fromBaseUnits(2_500_000n, 6)).toBe(2.5);
    expect(fromBaseUnits(25_000_000n, 7)).toBe(2.5);
  });

  it("handles a token with zero decimals", () => {
    expect(toBaseUnits("42", 0)).toBe(42n);
    expect(toBaseUnits("42.9", 0)).toBe(42n);
    expect(toBaseUnits(42, 0)).toBe(42n);
    expect(fromBaseUnits(42n, 0)).toBe(42);
  });

  it("converts the smallest unit exactly at 18 decimals", () => {
    expect(toBaseUnits("1", 18)).toBe(10n ** 18n);
    expect(toBaseUnits("0.000000000000000001", 18)).toBe(1n);
    expect(toBaseUnits("0.0000000000000000019", 18)).toBe(1n);
  });

  it("round-trips base units for a non-7-decimal token", () => {
    for (const units of [0n, 1n, 999_999n, 1_000_000n, 123_456_789n]) {
      expect(toBaseUnits(String(fromBaseUnits(units, 6)), 6)).toBe(units);
    }
  });

  it("returns 0n for invalid amounts", () => {
    expect(toBaseUnits("", 6)).toBe(0n);
    expect(toBaseUnits("abc", 6)).toBe(0n);
    expect(toBaseUnits(NaN, 6)).toBe(0n);
  });

  it("rejects invalid decimals", () => {
    expect(() => toBaseUnits("1", -1)).toThrow(RangeError);
    expect(() => toBaseUnits("1", 1.5)).toThrow(RangeError);
    expect(() => fromBaseUnits(1n, -1)).toThrow(RangeError);
  });
});
