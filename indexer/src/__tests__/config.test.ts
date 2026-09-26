import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadContractConfig,
  assertCompleteConfig,
  isContractAddress,
} from "../config.js";
import { CREG, CBOT, CACC, CMAR, CTOK } from "./helpers.js";

describe("loadContractConfig", () => {
  it("reads contract ids from a deployment manifest (deploy.sh format)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-config-"));
    const manifest = path.join(dir, "testnet.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        network: "testnet",
        git_sha: "abc123",
        contracts: {
          registry: { contract_id: CREG, initialized: true },
          bot_nft: { contract_id: CBOT, initialized: true },
          accrual: { contract_id: CACC, initialized: true },
          marketplace: { contract_id: CMAR, initialized: true },
          token: { contract_id: CTOK, initialized: true },
        },
      }),
    );

    const prev = process.env.AM_MANIFEST;
    process.env.AM_MANIFEST = manifest;
    const loaded = loadContractConfig("testnet");
    process.env.AM_MANIFEST = prev;

    expect(loaded.missing).toEqual([]);
    expect(loaded.config.contracts.registry).toBe(CREG);
    expect(loaded.config.contracts.token).toBe(CTOK);
    expect(loaded.config.gitSha).toBe("abc123");
    expect(loaded.sources.registry).toContain("manifest:");
  });

  it("reports missing contracts and assertCompleteConfig throws", () => {
    const loaded = loadContractConfig("nonexistent-network-xyz");
    expect(loaded.missing.length).toBeGreaterThan(0);
    expect(() => assertCompleteConfig(loaded)).toThrow(/Missing contract IDs/);
  });

  it("isContractAddress validates Soroban contract addresses", () => {
    expect(isContractAddress(CREG)).toBe(true);
    expect(isContractAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isContractAddress("not-an-address")).toBe(false);
    expect(isContractAddress("C" + "A".repeat(54))).toBe(false); // 55 chars total
    expect(isContractAddress("C" + "A".repeat(55))).toBe(true); // 56 chars total
  });
});
