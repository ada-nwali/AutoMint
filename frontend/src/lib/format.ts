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

/**
 * A plain decimal: optional `-`, at least one digit, at most one `.` (#1179).
 * Rejects what `Number()` accepts but `BigInt()` cannot parse, or parses
 * differently: exponents ("1e3"), "Infinity", hex/octal/binary ("0x10").
 */
const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

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
 * (empty, non-decimal such as "1e3" or "0x10", NaN, Infinity) yields `0n`.
 */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!DECIMAL_PATTERN.test(trimmed)) return 0n;
    const negative = trimmed.startsWith("-");
    const [integerDigits, fractionDigits = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
    const fraction = fractionDigits.slice(0, decimals).padEnd(decimals, "0");
    const magnitude =
      BigInt(integerDigits || "0") * 10n ** BigInt(decimals) + BigInt(fraction || "0");
    return negative ? -magnitude : magnitude;
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

/**
 * Whether a listing is past its `expires_at` ledger timestamp (seconds); the
 * marketplace's `buy_bot` rejects it once `now > expires_at` (#1405).
 * Listings without an expiry (`0n` / missing) never expire.
 */
export function isListingExpired(
  listing: { expires_at?: bigint },
  nowSecs: number = Math.floor(Date.now() / 1000),
): boolean {
  const expiresAt = listing.expires_at ?? 0n;
  return expiresAt > 0n && BigInt(nowSecs) > expiresAt;
}

/** Short "time left" label for a listing expiry, e.g. "2d 3h", "45m". */
export function formatTimeLeft(
  expiresAt: bigint,
  nowSecs: number = Math.floor(Date.now() / 1000),
): string {
  const left = Number(expiresAt) - nowSecs;
  if (left <= 0) return "Expired";
  const days = Math.floor(left / 86_400);
  const hours = Math.floor((left % 86_400) / 3_600);
  const minutes = Math.floor((left % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}
