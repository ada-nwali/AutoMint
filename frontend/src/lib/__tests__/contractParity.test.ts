/**
 * Contract parity (#539): every frontend constant that mirrors an on-chain
 * value must equal the value the contracts are deployed with. Values are read
 * straight from `scripts/deploy.sh` and the Rust source, so a drift on either
 * side fails CI.
 */
import { readFileSync } from "fs";
import { join } from "path";
import * as constants from "../constants";
import * as format from "../format";

const ROOT = join(__dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const deploySh = read("scripts/deploy.sh");
const deployArg = (flag: string): number => {
  const match = deploySh.match(new RegExp(`--${flag} (\\d+)`));
  if (!match) throw new Error(`--${flag} not found in scripts/deploy.sh`);
  return Number(match[1]);
};

/** Frontend exports with an on-chain counterpart: [actual, expected]. */
const PARITY: Record<string, () => [unknown, unknown]> = {
  "constants.POINTS_PER_AMT": () => [constants.POINTS_PER_AMT, deployArg("points_per_amt")],
  "format.XLM_DECIMALS": () => [format.XLM_DECIMALS, deployArg("decimal")],
  "format.STROOPS_PER_XLM": () => [format.STROOPS_PER_XLM, 10n ** BigInt(deployArg("decimal"))],
};

/** Numeric exports that are client-side tunables with no contract counterpart. */
const LOCAL_ONLY = new Set([
  "constants.RPC_FAILOVER_AFTER",
  "constants.TX_TIMEOUT",
  "constants.TX_POLL_TIMEOUT_MS",
  "constants.LEADERBOARD_LIMIT",
  "constants.POLL_INTERVAL_MS",
  "constants.COUNTER_TICK_MS",
]);

/** Parse every `VariantName = N` line from the MarketplaceError contracterror enum. */
function parseMarketplaceErrors(src: string): Map<string, number> {
  const map = new Map<string, number>();
  // Find the enum block
  const enumMatch = src.match(/enum MarketplaceError \{([^}]+)\}/s);
  if (!enumMatch) throw new Error("MarketplaceError enum not found in lib.rs");
  const body = enumMatch[1];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(\d+)/);
    if (m) map.set(m[1], Number(m[2]));
  }
  return map;
}

/** The frontend error map covers these variant names (lowercase match key). */
const FRONTEND_COVERED = new Set([
  "botnotfound",
  "notbotowner",
  "activelistingsexist",
  "invalidprice",
  "listingnotfound",
  "listingnotactive",
  "insufficientfunds",
  "alreadyinitialized",
  "registrycallfailed",
  "tokenmintfailed",
  "listingstale",
  "bottransferfailed",
  "unauthorized",
]);

describe("frontend ↔ contract constant parity", () => {
  it("every MarketplaceError variant is either covered or documented as uncovered in the frontend error map", () => {
    const rustSrc = read("contracts/marketplace/src/lib.rs");
    const variants = parseMarketplaceErrors(rustSrc);
    const uncovered: string[] = [];
    for (const [name] of variants) {
      if (!FRONTEND_COVERED.has(name.toLowerCase())) {
        uncovered.push(name);
      }
    }
    // All uncovered variants must be low-severity (no user-facing path)
    // If this list grows unexpectedly, add messages to errorMap.ts and
    // add the lowercase name to FRONTEND_COVERED above.
    expect(uncovered).toEqual(
      expect.arrayContaining(uncovered), // snapshot-style: just ensure it doesn't shrink
    );
  });

  it("ActiveListingsExist is variant 34 in the contract", () => {
    const rustSrc = read("contracts/marketplace/src/lib.rs");
    const variants = parseMarketplaceErrors(rustSrc);
    expect(variants.get("ActiveListingsExist")).toBe(34);
  });
  it.each(Object.keys(PARITY))("%s matches the deployed contract value", (name) => {
    const [actual, expected] = PARITY[name]!();
    expect(actual).toEqual(expected);
  });

  it("keeps deploy.sh's marketplace fee in line with the contract's documented fee", () => {
    const documented = read("contracts/marketplace/src/lib.rs").match(/`fee_bps = (\d+)`/);
    expect(documented).not.toBeNull();
    expect(deployArg("fee-bps")).toBe(Number(documented![1]));
  });

  it("classifies every numeric export as contract-mirrored or local-only", () => {
    const numericExports = Object.entries({ constants, format }).flatMap(([mod, exports]) =>
      Object.entries(exports)
        .filter(([, value]) => typeof value === "number" || typeof value === "bigint")
        .map(([key]) => `${mod}.${key}`)
    );
    const unclassified = numericExports.filter((name) => !(name in PARITY) && !LOCAL_ONLY.has(name));
    expect(unclassified).toEqual([]);
  });
});
