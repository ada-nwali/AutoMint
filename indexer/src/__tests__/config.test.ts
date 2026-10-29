import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadContractConfig,
  assertCompleteConfig,
  isContractAddress,
  readDotEnvLocal,
  type LoadedConfig,
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

  it("fails fast on a manifest that exists but is not valid JSON (#1232)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-config-"));
    const manifest = path.join(dir, "testnet.json");
    fs.writeFileSync(manifest, "{ not json");

    const prev = process.env.AM_MANIFEST;
    process.env.AM_MANIFEST = manifest;
    try {
      expect(() => loadContractConfig("testnet")).toThrow(/Failed to parse deployment manifest/);
    } finally {
      if (prev === undefined) delete process.env.AM_MANIFEST;
      else process.env.AM_MANIFEST = prev;
    }
  });

  it("finds the default manifest under the repo root (#1234)", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const dir = path.join(repoRoot, "deployments");
    const network = `am-config-test-${process.pid}`;
    const manifest = path.join(dir, `${network}.json`);
    const createdDir = fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ contracts: { registry: { contract_id: CREG } } }));
    const prev = process.env.AM_MANIFEST;
    delete process.env.AM_MANIFEST;
    try {
      const loaded = loadContractConfig(network);
      expect(loaded.config.contracts.registry).toBe(CREG);
      expect(loaded.sources.registry).toBe(`manifest:${manifest}`);
    } finally {
      if (prev !== undefined) process.env.AM_MANIFEST = prev;
      fs.rmSync(createdDir ?? manifest, { recursive: true, force: true });
    }
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

  it("assertCompleteConfig rejects a malformed contract id and names the contract (#659, #1230)", () => {
    const loaded: LoadedConfig = {
      config: {
        network: "testnet",
        contracts: { registry: CREG, bot_nft: CBOT, accrual: "PLACEHOLDER", marketplace: CMAR, token: CTOK },
      },
      sources: {
        registry: "env:AM_REGISTRY_CONTRACT_ID",
        bot_nft: "env:AM_BOT_NFT_CONTRACT_ID",
        accrual: "env:AM_ACCRUAL_CONTRACT_ID",
        marketplace: "env:AM_MARKETPLACE_CONTRACT_ID",
        token: "env:AM_TOKEN_CONTRACT_ID",
      },
      missing: [],
    };

    expect(() => assertCompleteConfig(loaded)).toThrow(/Invalid contract IDs for: accrual/);
    expect(() => assertCompleteConfig(loaded)).toThrow(/AM_ACCRUAL_CONTRACT_ID/);
  });

  it("assertCompleteConfig accepts a config where every contract id is well formed (#659, #1230)", () => {
    const loaded: LoadedConfig = {
      config: {
        network: "testnet",
        contracts: { registry: CREG, bot_nft: CBOT, accrual: CACC, marketplace: CMAR, token: CTOK },
      },
      sources: {
        registry: "manifest:x",
        bot_nft: "manifest:x",
        accrual: "manifest:x",
        marketplace: "manifest:x",
        token: "manifest:x",
      },
      missing: [],
    };

    expect(() => assertCompleteConfig(loaded)).not.toThrow();
  });
});

describe("readDotEnvLocal (#1243)", () => {
  it("strips trailing comments and accepts optional export prefix and quotes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "am-dotenv-"));
    const envFile = path.join(dir, ".env.local");
    fs.writeFileSync(
      envFile,
      [
        "# Full line comment",
        "",
        "AM_REGISTRY_CONTRACT_ID=C123 # testnet registry",
        'export AM_TOKEN_CONTRACT_ID="C456" # testnet token',
        "export AM_BOT_NFT_CONTRACT_ID='C789'",
        "AM_MARKETPLACE_CONTRACT_ID=CMKT",
      ].join("\n"),
    );

    const parsed = readDotEnvLocal(envFile);
    expect(parsed.AM_REGISTRY_CONTRACT_ID).toBe("C123");
    expect(parsed.AM_TOKEN_CONTRACT_ID).toBe("C456");
    expect(parsed.AM_BOT_NFT_CONTRACT_ID).toBe("C789");
    expect(parsed.AM_MARKETPLACE_CONTRACT_ID).toBe("CMKT");
  });
});

