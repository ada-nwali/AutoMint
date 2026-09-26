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
  "constants.LEADERBOARD_LIMIT",
  "constants.POLL_INTERVAL_MS",
  "constants.COUNTER_TICK_MS",
]);

describe("frontend ↔ contract constant parity", () => {
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
