/**
 * Unit tests for constants.ts (#238)
 * Tests that all exported constants resolve correctly from environment variables
 * and fall back to default values when environment variables are unset.
 */

describe("constants.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Fallback Defaults (when env vars are unset)", () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
      delete process.env.NEXT_PUBLIC_RPC_FAILOVER_AFTER;
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
      delete process.env.NEXT_PUBLIC_NETWORK;
      delete process.env.NEXT_PUBLIC_HORIZON_URL;
      delete process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID;
      delete process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID;
      delete process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID;
      delete process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID;
      delete process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID;
      delete process.env.NEXT_PUBLIC_TX_TIMEOUT;
      delete process.env.NEXT_PUBLIC_BASE_FEE;
      delete process.env.NEXT_PUBLIC_POINTS_PER_AMT;
      delete process.env.NEXT_PUBLIC_LEADERBOARD_LIMIT;
      delete process.env.NEXT_PUBLIC_POLL_INTERVAL_MS;
      delete process.env.NEXT_PUBLIC_COUNTER_TICK_MS;
    });

    it("resolves default network URLs and passphrase", () => {
      const constants = require("../constants");
      expect(constants.SOROBAN_RPC_URL).toBe("https://soroban-testnet.stellar.org");
      expect(constants.SOROBAN_RPC_URLS).toEqual(["https://soroban-testnet.stellar.org"]);
      expect(constants.RPC_FAILOVER_AFTER).toBe(3);
      expect(constants.NETWORK_PASSPHRASE).toBe("Test SDF Network ; September 2015");
      expect(constants.STELLAR_NETWORK_PASSPHRASE).toBe("Test SDF Network ; September 2015");
      expect(constants.NETWORK).toBe("TESTNET");
      expect(constants.HORIZON_URL).toBe("https://horizon-testnet.stellar.org");
    });

    it("resolves default contract IDs and CONTRACT_ADDRESSES mapping", () => {
      const constants = require("../constants");
      expect(constants.REGISTRY_CONTRACT_ID).toBe(
        "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX01"
      );
      expect(constants.BOT_NFT_CONTRACT_ID).toBe(
        "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX02"
      );
      expect(constants.ACCRUAL_CONTRACT_ID).toBe(
        "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX03"
      );
      expect(constants.MARKETPLACE_CONTRACT_ID).toBe(
        "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX04"
      );
      expect(constants.TOKEN_CONTRACT_ID).toBe(
        "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX05"
      );

      expect(constants.CONTRACT_ADDRESSES).toEqual({
        registry: constants.REGISTRY_CONTRACT_ID,
        botNft: constants.BOT_NFT_CONTRACT_ID,
        accrual: constants.ACCRUAL_CONTRACT_ID,
        marketplace: constants.MARKETPLACE_CONTRACT_ID,
        token: constants.TOKEN_CONTRACT_ID,
      });
    });

    it("resolves default numeric tunables, fees, and intervals", () => {
      const constants = require("../constants");
      expect(constants.TX_TIMEOUT).toBe(30);
      expect(constants.BASE_FEE).toBe("100");
      expect(constants.POINTS_PER_AMT).toBe(1000);
      expect(constants.LEADERBOARD_LIMIT).toBe(50);
      expect(constants.POLL_INTERVAL_MS).toBe(1000);
      expect(constants.COUNTER_TICK_MS).toBe(1000);
    });
  });

  describe("Custom Environment Variables", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://custom-rpc.example.com";
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = "Custom Network Passphrase";
      process.env.NEXT_PUBLIC_NETWORK = "MAINNET";
      process.env.NEXT_PUBLIC_HORIZON_URL = "https://custom-horizon.example.com";
      process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID = "CAREGISTRY1234567890";
      process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID = "CABOTNFT1234567890";
      process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID = "CAACCRUAL1234567890";
      process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID = "CAMARKETPLACE1234567890";
      process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID = "CATOKEN1234567890";
      process.env.NEXT_PUBLIC_TX_TIMEOUT = "60";
      process.env.NEXT_PUBLIC_BASE_FEE = "200";
      process.env.NEXT_PUBLIC_POINTS_PER_AMT = "500";
      process.env.NEXT_PUBLIC_LEADERBOARD_LIMIT = "100";
      process.env.NEXT_PUBLIC_POLL_INTERVAL_MS = "2500";
      process.env.NEXT_PUBLIC_COUNTER_TICK_MS = "500";
    });

    it("resolves custom network endpoints and passphrase", () => {
      const constants = require("../constants");
      expect(constants.SOROBAN_RPC_URL).toBe("https://custom-rpc.example.com");
      expect(constants.NETWORK_PASSPHRASE).toBe("Custom Network Passphrase");
      expect(constants.STELLAR_NETWORK_PASSPHRASE).toBe("Custom Network Passphrase");
      expect(constants.NETWORK).toBe("MAINNET");
      expect(constants.HORIZON_URL).toBe("https://custom-horizon.example.com");
    });

    it("parses a comma-separated RPC URL list for failover (#454)", () => {
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL =
        "https://primary.example.com, https://backup-a.example.com ,,https://backup-b.example.com";

      const constants = require("../constants");
      expect(constants.SOROBAN_RPC_URLS).toEqual([
        "https://primary.example.com",
        "https://backup-a.example.com",
        "https://backup-b.example.com",
      ]);
      // The legacy single-URL export always points at the primary entry.
      expect(constants.SOROBAN_RPC_URL).toBe("https://primary.example.com");
    });

    it("falls back to the default RPC URL list when the env var is empty", () => {
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = " , ,";

      const constants = require("../constants");
      expect(constants.SOROBAN_RPC_URLS).toEqual(["https://soroban-testnet.stellar.org"]);
      expect(constants.SOROBAN_RPC_URL).toBe("https://soroban-testnet.stellar.org");
    });

    it("reads the configured RPC failover threshold (#454)", () => {
      process.env.NEXT_PUBLIC_RPC_FAILOVER_AFTER = "5";

      const constants = require("../constants");
      expect(constants.RPC_FAILOVER_AFTER).toBe(5);
    });

    it("falls back to the default failover threshold when it is invalid", () => {
      process.env.NEXT_PUBLIC_RPC_FAILOVER_AFTER = "not-a-number";

      const constants = require("../constants");
      expect(constants.RPC_FAILOVER_AFTER).toBe(3);
    });

    it("resolves custom contract IDs and updates CONTRACT_ADDRESSES mapping", () => {
      const constants = require("../constants");
      expect(constants.REGISTRY_CONTRACT_ID).toBe("CAREGISTRY1234567890");
      expect(constants.BOT_NFT_CONTRACT_ID).toBe("CABOTNFT1234567890");
      expect(constants.ACCRUAL_CONTRACT_ID).toBe("CAACCRUAL1234567890");
      expect(constants.MARKETPLACE_CONTRACT_ID).toBe("CAMARKETPLACE1234567890");
      expect(constants.TOKEN_CONTRACT_ID).toBe("CATOKEN1234567890");

      expect(constants.CONTRACT_ADDRESSES).toEqual({
        registry: "CAREGISTRY1234567890",
        botNft: "CABOTNFT1234567890",
        accrual: "CAACCRUAL1234567890",
        marketplace: "CAMARKETPLACE1234567890",
        token: "CATOKEN1234567890",
      });
    });

    it("resolves custom numeric tunables, fees, and intervals", () => {
      const constants = require("../constants");
      expect(constants.TX_TIMEOUT).toBe(60);
      expect(constants.BASE_FEE).toBe("200");
      expect(constants.POINTS_PER_AMT).toBe(500);
      expect(constants.LEADERBOARD_LIMIT).toBe(100);
      expect(constants.POLL_INTERVAL_MS).toBe(2500);
      expect(constants.COUNTER_TICK_MS).toBe(500);
    });

    it("handles invalid or non-numeric environment values by falling back", () => {
      process.env.NEXT_PUBLIC_TX_TIMEOUT = "invalid-timeout";
      process.env.NEXT_PUBLIC_POINTS_PER_AMT = "not-a-number";
      process.env.NEXT_PUBLIC_LEADERBOARD_LIMIT = "";
      process.env.NEXT_PUBLIC_POLL_INTERVAL_MS = "abc";
      process.env.NEXT_PUBLIC_COUNTER_TICK_MS = "0"; // 0 is falsy, falls back to 1000

      const constants = require("../constants");
      expect(constants.TX_TIMEOUT).toBe(30);
      expect(constants.POINTS_PER_AMT).toBe(1000);
      expect(constants.LEADERBOARD_LIMIT).toBe(50);
      expect(constants.POLL_INTERVAL_MS).toBe(1000);
      expect(constants.COUNTER_TICK_MS).toBe(1000);
    });
  });
});
