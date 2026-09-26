/**
 * Conversions between display amounts and on-chain base units (#479).
 *
 * A stroop is 1e-7 XLM, so one XLM is 10,000,000 stroops — the scale the
 * bot_nft tier prices use (`500_0000000` is 500 XLM). AMT is a separate token
 * with its own `decimals()`; convert it with {@link toBaseUnits} /
 * {@link fromBaseUnits} and the token's actual value rather than assuming 7.
 */

export const XLM_DECIMALS = 7;
export const STROOPS_PER_XLM = 10_000_000n;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
}

/**
 * Convert a display amount to base units for a token with `decimals` places.
 *
 * Strings are converted exactly; digits past `decimals` are truncated, not
 * rounded. Numbers are rounded to the nearest base unit. Invalid input
 * (empty, non-numeric, NaN, Infinity) yields `0n`.
 */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!trimmed || isNaN(Number(trimmed))) return 0n;
    const parts = trimmed.split(".");
    const integerPart = parts[0] ? BigInt(parts[0]) : 0n;
    let fractionStr = parts[1] || "";
    if (fractionStr.length > decimals) {
      fractionStr = fractionStr.slice(0, decimals);
    } else {
      fractionStr = fractionStr.padEnd(decimals, "0");
    }
    const sign = integerPart < 0n || trimmed.startsWith("-") ? -1n : 1n;
    const absInt = integerPart < 0n ? -integerPart : integerPart;
    const fractionPart = fractionStr ? BigInt(fractionStr) : 0n;
    return sign * (absInt * 10n ** BigInt(decimals) + fractionPart);
  }
  if (typeof amount === "number") {
    if (isNaN(amount) || !isFinite(amount)) return 0n;
    return BigInt(Math.round(amount * 10 ** decimals));
  }
  return 0n;
}

/** Convert base units of a token with `decimals` places to a display number. */
export function fromBaseUnits(units: bigint, decimals: number): number {
  assertDecimals(decimals);
  return Number(units) / 10 ** decimals;
}

export function xlmToStroops(xlm: number | string): bigint {
  return toBaseUnits(xlm, XLM_DECIMALS);
}

export function stroopsToXlm(stroops: bigint): number {
  return fromBaseUnits(stroops, XLM_DECIMALS);
}

export function stroopsToXlmString(stroops: bigint): string {
  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;
  const intPart = absStroops / STROOPS_PER_XLM;
  const fracPart = absStroops % STROOPS_PER_XLM;
  if (fracPart === 0n) {
    return `${isNegative ? "-" : ""}${intPart.toString()}`;
  }
  const fracStr = fracPart.toString().padStart(XLM_DECIMALS, "0").replace(/0+$/, "");
  return `${isNegative ? "-" : ""}${intPart.toString()}.${fracStr}`;
}
