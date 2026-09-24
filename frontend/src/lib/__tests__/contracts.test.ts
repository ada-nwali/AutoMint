/**
 * Tests for the read functions in contracts.ts (#459, #460, AM-143).
 *
 * Verifies three properties for every read function:
 *   1. RPC failures throw — they are never swallowed or returned as empty data.
 *   2. Specific contract error codes (NotRegistered / NotFound) return null
 *      where the contract semantics warrant it, not all errors.
 *   3. Normal data round-trips correctly.
 *
 * Also tests the defaultSource() priority chain (#459):
 *   explicit arg > connected wallet (Zustand) > env-var fallback > throw
 *
 * The stellar.ts helper is mocked so tests exercise only the
 * argument-building / result-decoding / error-handling logic in contracts.ts.
 */

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    // Avoid strkey validation for placeholder addresses in unit tests.
    nativeToScVal: jest.fn((v: unknown) => ({ scv: v })),
  };
});

jest.mock("../stellar", () => ({
  __esModule: true,
  getServer: jest.fn(),
  rpcCall: jest.fn(),
  simulateContractCall: jest.fn(),
}));

// Wallet store mock: expose a controllable getState() snapshot so we can
// simulate connected / disconnected states without a React tree.
const mockWalletGetState = jest.fn<{ publicKey: string | null }, []>();
jest.mock("@/store/walletStore", () => ({
  useWalletStore: {
    getState: () => mockWalletGetState(),
  },
}));

// Constants mock: lets individual tests override ANONYMOUS_READ_SOURCE.
jest.mock("../constants", () => ({
  ...jest.requireActual("../constants"),
  ANONYMOUS_READ_SOURCE: "",
}));

import { simulateContractCall } from "../stellar";
import {
  isRegistered,
  getTotalUsers,
  getUserProfile,
  getAccrualState,
  getLeaderboard,
  getActiveListings,
  getUserListings,
  getUserRank,
  getPendingPoints,
  getUserBots,
  getUserBotsDetailed,
  getBotById,
  getUserTotalRate,
  getAllTiers,
  getAmtDecimals,
  UNRANKED_SENTINEL,
  parseListing,
  parseUserProfile,
  parseBotNFT,
  toBigInt,
  toBigIntOr,
} from "../contracts";

const mockSimulate = simulateContractCall as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: wallet disconnected, no env-var fallback.
  mockWalletGetState.mockReturnValue({ publicKey: null });
});

// ---------------------------------------------------------------------------
// defaultSource() priority chain (#459)
//
// defaultSource is private so we exercise it through the public functions
// that call it (getLeaderboard and getTotalUsers accept an optional
// sourceAddress parameter).
// ---------------------------------------------------------------------------
describe("defaultSource", () => {
  it("uses an explicit sourceAddress when provided", async () => {
    mockSimulate.mockResolvedValue([]);
    await getLeaderboard(10, "GEXPLICIT");
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_leaderboard",
      expect.any(Array),
      "GEXPLICIT"  // explicit arg wins
    );
  });

  it("falls back to the connected wallet when no explicit arg is given", async () => {
    mockWalletGetState.mockReturnValue({ publicKey: "GWALLET" });
    mockSimulate.mockResolvedValue([]);
    await getLeaderboard(10);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_leaderboard",
      expect.any(Array),
      "GWALLET"  // Zustand store snapshot used
    );
  });

  it("falls back to ANONYMOUS_READ_SOURCE when wallet is disconnected", async () => {
    // Override the constants mock for this test only.
    const constants = jest.requireMock("../constants") as Record<string, unknown>;
    const original = constants.ANONYMOUS_READ_SOURCE;
    constants.ANONYMOUS_READ_SOURCE = "GENV_FALLBACK";
    try {
      mockWalletGetState.mockReturnValue({ publicKey: null });
      mockSimulate.mockResolvedValue([]);
      await getLeaderboard(10);
      expect(mockSimulate).toHaveBeenCalledWith(
        expect.any(String),
        "get_leaderboard",
        expect.any(Array),
        "GENV_FALLBACK"  // env-var fallback used
      );
    } finally {
      constants.ANONYMOUS_READ_SOURCE = original;
    }
  });

  it("throws a descriptive error when no source is available at all", async () => {
    mockWalletGetState.mockReturnValue({ publicKey: null });
    // ANONYMOUS_READ_SOURCE is "" (default in the mock above)
    await expect(getLeaderboard(10)).rejects.toThrow(
      "NEXT_PUBLIC_SIMULATION_SOURCE"
    );
  });

  it("explicit arg takes precedence over a connected wallet", async () => {
    mockWalletGetState.mockReturnValue({ publicKey: "GWALLET" });
    mockSimulate.mockResolvedValue(0);
    await getTotalUsers("GOVERRIDE");
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "total_users",
      [],
      "GOVERRIDE"  // explicit arg beats wallet
    );
  });
});

// ---------------------------------------------------------------------------
// isRegistered
// ---------------------------------------------------------------------------
describe("isRegistered", () => {
  it("returns true when the registry reports the user as registered", async () => {
    mockSimulate.mockResolvedValue(true);
    await expect(isRegistered("GUSER")).resolves.toBe(true);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "is_registered",
      expect.any(Array),
      "GUSER"
    );
  });

  it("returns false when the registry reports the user as not registered", async () => {
    mockSimulate.mockResolvedValue(false);
    await expect(isRegistered("GUSER")).resolves.toBe(false);
  });

  it("throws on RPC failure — never returns false for a network error (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(isRegistered("GUSER")).rejects.toThrow("rpc down");
  });
});

// ---------------------------------------------------------------------------
// getTotalUsers
// ---------------------------------------------------------------------------
describe("getTotalUsers", () => {
  it("returns the numeric total on success", async () => {
    mockSimulate.mockResolvedValue(7);
    await expect(getTotalUsers("GSRC")).resolves.toBe(7);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "total_users",
      [],
      "GSRC"
    );
  });

  it("throws when the simulation throws (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getTotalUsers("GSRC")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns null — not silently 0", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getTotalUsers("GSRC")).rejects.toThrow("total_users returned no value");
  });

  it("throws when the contract returns undefined — not silently 0", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getTotalUsers("GSRC")).rejects.toThrow("total_users returned no value");
  });
});

// ---------------------------------------------------------------------------
// getUserProfile
// ---------------------------------------------------------------------------
describe("getUserProfile", () => {
  it("parses the raw profile into a typed UserProfile", async () => {
    mockSimulate.mockResolvedValue({
      address: "GUSER",
      username: "Alice",
      total_points: 350n,
      claimed_amt: 0n,
      registered_at: 0,
      bot_count: 0,
    });
    const profile = await getUserProfile("GUSER");
    expect(profile).toMatchObject({ address: "GUSER", username: "Alice", points: 350n });
  });

  it("throws on generic RPC failure — not swallowed as null (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserProfile("GUSER")).rejects.toThrow("rpc down");
  });

  it("returns null on contract NotRegistered error code #1", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_user: Error(Contract, #1)")
    );
    await expect(getUserProfile("GSTRANGER")).resolves.toBeNull();
  });

  it("returns null on contract NotRegistered named error", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_user: NotRegistered")
    );
    await expect(getUserProfile("GSTRANGER")).resolves.toBeNull();
  });

  it("throws on a different contract error code — not swallowed as null", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_user: Error(Contract, #5)")
    );
    await expect(getUserProfile("GUSER")).rejects.toThrow("Error(Contract, #5)");
  });
});

// ---------------------------------------------------------------------------
// getAccrualState
// ---------------------------------------------------------------------------
describe("getAccrualState", () => {
  it("parses raw accrual state correctly", async () => {
    mockSimulate.mockResolvedValue({
      last_claim_ts: 1_700_000_000n,
      total_claimed_points: 42n,
    });
    const state = await getAccrualState("GUSER");
    expect(state).toEqual({
      last_claim_ts: 1_700_000_000n,
      total_claimed_points: 42n,
    });
  });

  it("throws on generic RPC failure — not swallowed as null (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getAccrualState("GUSER")).rejects.toThrow("rpc down");
  });

  it("returns null on contract NotFound error code #2", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: Error(Contract, #2)")
    );
    await expect(getAccrualState("GNEWUSER")).resolves.toBeNull();
  });

  it("returns null on contract NotFound named error", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: NotFound")
    );
    await expect(getAccrualState("GNEWUSER")).resolves.toBeNull();
  });

  it("returns null on contract NotRegistered error code #1", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: Error(Contract, #1)")
    );
    await expect(getAccrualState("GNEWUSER")).resolves.toBeNull();
  });

  it("throws on a different contract error code — not swallowed as null", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: Error(Contract, #9)")
    );
    await expect(getAccrualState("GUSER")).rejects.toThrow("Error(Contract, #9)");
  });
});

// ---------------------------------------------------------------------------
// getLeaderboard
// ---------------------------------------------------------------------------
describe("getLeaderboard", () => {
  it("maps an array of raw profiles", async () => {
    mockSimulate.mockResolvedValue([
      {
        address: "GA",
        username: "A",
        total_points: 500n,
        claimed_amt: 0n,
        registered_at: 0,
        bot_count: 1,
      },
      {
        address: "GB",
        username: "B",
        total_points: 100n,
        claimed_amt: 0n,
        registered_at: 0,
        bot_count: 0,
      },
    ]);
    const lb = await getLeaderboard(10, "GSRC");
    expect(lb).toMatchObject([
      { address: "GA", username: "A", points: 500n },
      { address: "GB", username: "B", points: 100n },
    ]);
  });

  it("throws on RPC failure — not silently [] (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("boom"));
    await expect(getLeaderboard(10, "GSRC")).rejects.toThrow("boom");
  });

  it("throws when the contract returns a non-array — schema mismatch, not empty list", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getLeaderboard(10, "GSRC")).rejects.toThrow(
      "get_leaderboard returned unexpected type"
    );
  });

  it("returns an empty array when the contract genuinely returns []", async () => {
    mockSimulate.mockResolvedValue([]);
    await expect(getLeaderboard(10, "GSRC")).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActiveListings
// ---------------------------------------------------------------------------
describe("getActiveListings", () => {
  const rawListing = {
    id: 1n,
    seller: "GSELLER",
    bot_id: 10n,
    price: 500n,
    listed_at: 1_700_000_000n,
  };

  it("maps an array of raw listings", async () => {
    mockSimulate.mockResolvedValue([rawListing]);
    const listings = await getActiveListings(0, 100, "GSRC");
    expect(listings).toEqual([
      { id: 1n, seller: "GSELLER", bot_id: 10n, price: 500n, listed_at: 1_700_000_000n },
    ]);
  });

  it("throws on RPC failure — not silently [] (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getActiveListings(0, 100, "GSRC")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns a non-array — schema mismatch, not empty list", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getActiveListings(0, 100, "GSRC")).rejects.toThrow(
      "get_active_listings returned unexpected type"
    );
  });

  it("returns an empty array when the contract genuinely returns []", async () => {
    mockSimulate.mockResolvedValue([]);
    await expect(getActiveListings(0, 100, "GSRC")).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getUserListings
// ---------------------------------------------------------------------------
describe("getUserListings", () => {
  const rawListing = {
    id: 2n,
    seller: "GUSER",
    bot_id: 20n,
    price: 1000n,
    listed_at: 1_700_000_001n,
  };

  it("maps an array of raw listings for the user", async () => {
    mockSimulate.mockResolvedValue([rawListing]);
    const listings = await getUserListings("GUSER");
    expect(listings).toEqual([
      { id: 2n, seller: "GUSER", bot_id: 20n, price: 1000n, listed_at: 1_700_000_001n },
    ]);
  });

  it("throws on RPC failure — not silently [] (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserListings("GUSER")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns a non-array — schema mismatch, not empty list", async () => {
    mockSimulate.mockResolvedValue("unexpected");
    await expect(getUserListings("GUSER")).rejects.toThrow(
      "get_user_listings returned unexpected type"
    );
  });

  it("returns an empty array when the contract genuinely returns []", async () => {
    mockSimulate.mockResolvedValue([]);
    await expect(getUserListings("GUSER")).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getUserRank (pre-existing, kept for regression coverage)
// ---------------------------------------------------------------------------
describe("getUserRank", () => {
  const board = [
    { address: "GA", username: "A", total_points: 500n },
    { address: "GB", username: "B", total_points: 300n },
    { address: "GC", username: "C", total_points: 100n },
  ];

  it("derives the rank and the gap to the position above from the board", async () => {
    mockSimulate.mockResolvedValueOnce(board);

    await expect(getUserRank("GB", "GSRC")).resolves.toEqual({
      address: "GB",
      username: "B",
      rank: 2,
      points: 300n,
      pointsToNextRank: 200n,
    });

    // The user was found in the scanned window, so `get_rank` is not needed.
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("reports no gap for the rank-1 user", async () => {
    mockSimulate.mockResolvedValueOnce(board);

    await expect(getUserRank("GA", "GSRC")).resolves.toMatchObject({
      rank: 1,
      pointsToNextRank: null,
    });
  });

  it("falls back to the registry's get_rank for a user below the window", async () => {
    mockSimulate
      .mockResolvedValueOnce(board) // get_leaderboard
      .mockResolvedValueOnce(312) // get_rank
      .mockResolvedValueOnce({ address: "GD", username: "D", total_points: 42n }); // get_user

    await expect(getUserRank("GD", "GSRC")).resolves.toEqual({
      address: "GD",
      username: "D",
      rank: 312,
      points: 42n,
      pointsToNextRank: null,
    });
  });

  it("treats the u32::MAX sentinel as unranked, not as a position", async () => {
    mockSimulate
      .mockResolvedValueOnce(board)
      .mockResolvedValueOnce(UNRANKED_SENTINEL)
      .mockResolvedValueOnce({ address: "GD", username: "D", total_points: 0n });

    await expect(getUserRank("GD", "GSRC")).resolves.toMatchObject({ rank: null });
  });

  it("still reports the standing when the registry has no get_rank yet", async () => {
    mockSimulate
      .mockResolvedValueOnce(board)
      .mockRejectedValueOnce(new Error("unknown function get_rank"))
      .mockResolvedValueOnce({ address: "GD", username: "D", total_points: 42n });

    await expect(getUserRank("GD", "GSRC")).resolves.toMatchObject({
      rank: null,
      points: 42n,
    });
  });

  it("resolves to null when the address has no registry profile", async () => {
    mockSimulate
      .mockResolvedValueOnce(board)
      .mockRejectedValueOnce(new Error("no get_rank"))
      .mockRejectedValueOnce(new Error("NotRegistered"));

    await expect(getUserRank("GSTRANGER", "GSRC")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read functions routed through simulateContractCall (#481)
//
// These four used to build their own TransactionBuilder, check for errors
// and decode by hand, and silently return 0n / [] / null on simulation
// failure. Now they share the helper and let errors propagate (AM-143).
// ---------------------------------------------------------------------------
describe("getPendingPoints (#481)", () => {
  it("decodes the simulated return value as bigint", async () => {
    mockSimulate.mockResolvedValue(123n);
    await expect(getPendingPoints("GUSER")).resolves.toBe(123n);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "pending_points",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning 0n", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getPendingPoints("GUSER")).rejects.toThrow("rpc down");
  });
});

describe("getUserBots (#481)", () => {
  it("maps the id list to bigints", async () => {
    mockSimulate.mockResolvedValue([1n, 2n]);
    await expect(getUserBots("GUSER")).resolves.toEqual([1n, 2n]);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_user_bots",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning []", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserBots("GUSER")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns a non-array", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getUserBots("GUSER")).rejects.toThrow("expected array");
  });
});

describe("getBotById (#481)", () => {
  const rawBot = {
    id: 5n,
    name: "Bot",
    owner: "GOWNER",
    tier: "Gold",
    accrual_rate: 10n,
    minted_at: 1,
    last_claim_timestamp: 0n,
  };

  it("parses the simulated bot record", async () => {
    mockSimulate.mockResolvedValue(rawBot);
    const bot = await getBotById("GUSER", 5n);
    expect(bot).toMatchObject({ id: 5n, tier: "Gold", accrual_rate: 10n });
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_bot",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning null", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getBotById("GUSER", 5n)).rejects.toThrow("rpc down");
  });
});

describe("getUserTotalRate (#481)", () => {
  it("decodes the rate as bigint", async () => {
    mockSimulate.mockResolvedValue(77n);
    await expect(getUserTotalRate("GUSER")).resolves.toBe(77n);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_user_total_rate",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning 0n", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserTotalRate("GUSER")).rejects.toThrow("rpc down");
  });
});

// ---------------------------------------------------------------------------
// getUserBotsDetailed (#483)
// ---------------------------------------------------------------------------
describe("getUserBotsDetailed (#483)", () => {
  const rawBot = {
    id: 5n,
    name: "Bot",
    owner: "GOWNER",
    tier: "Gold",
    accrual_rate: 10n,
    minted_at: 1,
    last_claim_timestamp: 0n,
  };

  it("maps the single round trip of detailed records through parseBotNFT", async () => {
    mockSimulate.mockResolvedValue([rawBot]);
    const bots = await getUserBotsDetailed("GUSER");
    expect(bots).toHaveLength(1);
    expect(bots[0]).toMatchObject({ id: 5n, tier: "Gold", accrual_rate: 10n });
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_user_bots_detailed",
      expect.any(Array),
      "GUSER"
    );
  });

  it("throws when the contract returns a non-array", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getUserBotsDetailed("GUSER")).rejects.toThrow("expected array");
  });

  it("propagates simulation errors", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserBotsDetailed("GUSER")).rejects.toThrow("rpc down");
  });
});

// ---------------------------------------------------------------------------
// getAllTiers (#478) — tier economics come from the contract, not the client
// ---------------------------------------------------------------------------
describe("getAllTiers (#478)", () => {
  // Decoded `get_tier_info` results, keyed by the BotTier u32 discriminant.
  const contractTiers: Record<number, [string, bigint, bigint]> = {
    0: ["Basic Bot", 1n, 0n],
    1: ["Bronze Bot", 5n, 5_000_000_000n],
    2: ["Silver Bot", 25n, 20_000_000_000n],
    3: ["Gold Bot", 100n, 75_000_000_000n],
    4: ["Diamond Bot", 500n, 250_000_000_000n],
  };

  beforeEach(() => {
    mockSimulate.mockImplementation(
      async (_contractId: string, _method: string, args: Array<{ scv: number }>) =>
        contractTiers[args[0].scv]
    );
  });

  it("reads every tier from get_tier_info by its u32 discriminant", async () => {
    const tiers = await getAllTiers("GSRC");

    expect(mockSimulate).toHaveBeenCalledTimes(5);
    for (let index = 0; index < 5; index++) {
      expect(mockSimulate).toHaveBeenCalledWith(
        expect.any(String),
        "get_tier_info",
        [{ scv: index }],
        "GSRC"
      );
    }
    expect(tiers.Basic).toEqual({ tier: "Basic", name: "Basic Bot", rate: 1n, price: 0n });
    expect(tiers.Diamond).toEqual({
      tier: "Diamond",
      name: "Diamond Bot",
      rate: 500n,
      price: 250_000_000_000n,
    });
  });

  it("reflects a contract-side rate change with no frontend change", async () => {
    contractTiers[4] = ["Diamond Bot", 750n, 250_000_000_000n];
    try {
      const tiers = await getAllTiers("GSRC");
      expect(tiers.Diamond.rate).toBe(750n);
    } finally {
      contractTiers[4] = ["Diamond Bot", 500n, 250_000_000_000n];
    }
  });

  it("throws when a tier comes back in an unexpected shape", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getAllTiers("GSRC")).rejects.toThrow(
      "get_tier_info returned unexpected shape"
    );
  });

  it("propagates simulation errors", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getAllTiers("GSRC")).rejects.toThrow("rpc down");
  });
});

// ---------------------------------------------------------------------------
// getAmtDecimals (#479)
// ---------------------------------------------------------------------------
describe("getAmtDecimals (#479)", () => {
  it("returns the token's decimals", async () => {
    mockSimulate.mockResolvedValue(7);
    await expect(getAmtDecimals("GSRC")).resolves.toBe(7);
    expect(mockSimulate).toHaveBeenCalledWith(expect.any(String), "decimals", [], "GSRC");
  });

  it("uses whatever precision the token reports rather than assuming 7", async () => {
    mockSimulate.mockResolvedValue(6);
    await expect(getAmtDecimals("GSRC")).resolves.toBe(6);
  });

  it("throws when the contract returns no value", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getAmtDecimals("GSRC")).rejects.toThrow(
      "decimals returned unexpected value"
    );
  });
});

// ---------------------------------------------------------------------------
// Parse helpers and integer coercion (#484)
//
// Merged from the former src/lib/contracts.test.ts (#489) so contracts.ts has
// a single test file. These are pure functions: the module mocks above do not
// affect them.
// ---------------------------------------------------------------------------
describe("parse helpers in contracts.ts", () => {
  describe("parseUserProfile", () => {
    it("should parse raw user profile data correctly with all six fields", () => {
      const rawData = {
        address: "GALICE",
        username: "alice",
        total_points: "150",
        claimed_amt: "10",
        registered_at: 1700000000,
        bot_count: 2,
      };

      const result = parseUserProfile(rawData);

      expect(result).toEqual({
        address: "GALICE",
        username: "alice",
        total_points: 150n,
        points: 150n,
        claimed_amt: 10n,
        claimedAmt: 10n,
        registered_at: 1700000000,
        registeredAt: 1700000000,
        bot_count: 2,
        botCount: 2,
      });
    });

    it("parses correctly with bigint total_points", () => {
      const raw = {
        address: "GALICE",
        username: "alice",
        total_points: 100n,
        claimed_amt: 0n,
        registered_at: 0,
        bot_count: 0,
      };
      const parsed = parseUserProfile(raw);
      expect(parsed.total_points).toBe(100n);
      expect(parsed.points).toBe(100n);
    });

    it("parses correctly with number total_points", () => {
      const raw = {
        address: "GBOB",
        username: "bob",
        total_points: 50,
        claimed_amt: 5,
        registered_at: 100,
        bot_count: 1,
      };
      const parsed = parseUserProfile(raw);
      expect(parsed.total_points).toBe(50n);

      // A profile shape with no address still parses; the field is an empty
      // string rather than undefined so consumers never branch on it.
      expect(
        parseUserProfile({
          username: "bob",
          total_points: 50,
          claimed_amt: 0,
          registered_at: 0,
          bot_count: 0,
        }).address
      ).toBe("");
    });

    it("throws naming the field when total_points is absent (#484)", () => {
      expect(() => parseUserProfile({ address: "G", username: "u" } as any)).toThrow(
        /"total_points"/
      );
    });

    it("defaults claimed_amt when absent (backward compatible)", () => {
      const parsed = parseUserProfile({
        address: "G",
        username: "u",
        total_points: 0,
      } as any);
      expect(parsed.claimed_amt).toBe(0n);
      expect(parsed.claimedAmt).toBe(0n);
    });

    it("deletes the legacy points fallback (no points field)", () => {
      const raw = {
        address: "GALICE",
        username: "alice",
        total_points: 150n,
        claimed_amt: 0n,
        registered_at: 0,
        bot_count: 0,
        points: 999n, // legacy field should be ignored
      };
      const parsed = parseUserProfile(raw as any);
      // Should use total_points, not points, so legacy 999 is ignored
      expect(parsed.total_points).toBe(150n);
      expect(parsed.points).toBe(150n);
    });

    it("exposes camelCase aliases for UI compatibility", () => {
      const raw = {
        address: "GTEST",
        username: "tester",
        total_points: 42n,
        claimed_amt: 7n,
        registered_at: 1234567890,
        bot_count: 3,
      };
      const parsed = parseUserProfile(raw);
      expect(parsed.claimedAmt).toBe(7n);
      expect(parsed.registeredAt).toBe(1234567890);
      expect(parsed.botCount).toBe(3);
    });
  });

  describe("parseBotNFT", () => {
    const baseRaw = {
      id: 1n,
      name: "Bot1",
      owner: "GBDUJF...",
      accrual_rate: 10n,
      minted_at: 123456789,
      last_claim_timestamp: 123456789n,
    };

    // Real simulation fixture: tier as ScVec([ScSymbol("Gold")]) decodes to ["Gold"]
    // via scValToNative. This is the sole shape we accept; string "Gold" is also
    // accepted as the spec-aware generated client decodes the same enum directly
    // to its string name.
    const realBotFixture: Record<string, unknown> = {
      id: 42n,
      name: "Gold Bot",
      owner: "GBDUJFNDCXMOAY654HWWDVOHGGCL4NZIAXGXDF4WODNUMUPTIGULZTN2",
      tier: ["Gold"],
      accrual_rate: 100n,
      minted_at: 1700000000,
      last_claim_timestamp: 1700000000n,
      variant: 3,
      bonus_bps: 123,
    };

    it("should parse raw bot NFT data correctly with string tier", () => {
      const rawData = {
        id: 10,
        name: "Bot #10",
        owner: "GXYZ987654321",
        tier: "Gold",
        accrual_rate: "50",
        minted_at: 1690000000,
        last_claim_timestamp: "1690005000",
      };

      const result = parseBotNFT(rawData);

      expect(result).toEqual({
        id: 10n,
        name: "Bot #10",
        owner: "GXYZ987654321",
        tier: "Gold",
        accrual_rate: 50n,
        minted_at: 1690000000,
        last_claim_timestamp: 1690005000n,
      });
    });

    it("parses tier as array-wrapped string from real simulation", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: ["Gold"] });
      expect(parsed.tier).toBe("Gold");
    });

    it("decodes all five tiers correctly from real response shape", () => {
      (["Basic", "Bronze", "Silver", "Gold", "Diamond"] as const).forEach((t) => {
        const parsed = parseBotNFT({ ...baseRaw, tier: [t] });
        expect(parsed.tier).toBe(t);
      });
      // String shape from generated client is also accepted
      (["Basic", "Bronze", "Silver", "Gold", "Diamond"] as const).forEach((t) => {
        const parsed = parseBotNFT({ ...baseRaw, tier: t });
        expect(parsed.tier).toBe(t);
      });
    });

    it("parses real bot fixture from simulation and round-trips tier", () => {
      const parsed = parseBotNFT(realBotFixture);
      expect(parsed.tier).toBe("Gold");
      expect(parsed.id).toBe(42n);
      expect(parsed.accrual_rate).toBe(100n);
      // Fixture's tier round-trips
      expect(parsed.tier).toBe(realBotFixture.tier[0]);
    });

    it("throws on unrecognized tier instead of silently defaulting to Basic", () => {
      expect(() => parseBotNFT({ ...baseRaw, tier: ["UnknownTier"] })).toThrow(
        /unrecognized tier/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: "UnknownTier" })).toThrow(
        /unrecognized tier/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: { variant: "Pro" } as any })).toThrow(
        /unexpected tier shape/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: { foo: "bar" } as any })).toThrow(
        /unexpected tier shape/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: [0, "Enterprise"] as any })).toThrow(
        /unexpected tier shape/
      );
    });

    it("throws naming the field when required fields are missing (#484)", () => {
      // Provide tier so the parser reaches the id/accrual_rate checks, not tier shape
      expect(() => parseBotNFT({} as any)).toThrow(/unexpected tier shape/);
      expect(() => parseBotNFT({ tier: ["Basic"] } as any)).toThrow(/"id"/);
      expect(() => parseBotNFT({ id: 1n, tier: ["Basic"] } as any)).toThrow(
        /"accrual_rate"/
      );
    });

    it("defaults the genuinely optional fields via toBigIntOr (#484)", () => {
      const parsed = parseBotNFT({
        id: 1n,
        name: "Bot",
        owner: "GOWNER",
        tier: ["Basic"],
        accrual_rate: 1n,
        // minted_at and last_claim_timestamp intentionally absent
      });
      expect(parsed.minted_at).toBe(0);
      expect(parsed.last_claim_timestamp).toBe(0n);
    });
  });

  describe("parseListing", () => {
    it("should parse a valid raw marketplace listing map into a MarketplaceListing object", () => {
      const rawData = {
        id: "1",
        seller: "GABC1234567890",
        bot_id: 42,
        price: "1000000000",
        listed_at: 1700000000n,
      };

      const result = parseListing(rawData);

      expect(result).toEqual({
        id: 1n,
        seller: "GABC1234567890",
        bot_id: 42n,
        price: 1000000000n,
        listed_at: 1700000000n,
      });
    });

    it("throws naming the field when a required field is missing (#484)", () => {
      expect(() => parseListing({})).toThrow(/"id"/);
      expect(() => parseListing({ id: 1n })).toThrow(/"bot_id"/);
    });
  });
});

// ---------------------------------------------------------------------------
// toBigInt / toBigIntOr (#484)
// ---------------------------------------------------------------------------
describe("toBigInt (#484)", () => {
  it("accepts a bigint", () => {
    expect(toBigInt(42n, "value")).toBe(42n);
  });

  it("accepts an integral number", () => {
    expect(toBigInt(42, "value")).toBe(42n);
    expect(toBigInt(0, "value")).toBe(0n);
    expect(toBigInt(-7, "value")).toBe(-7n);
  });

  it("accepts a base-10 integer string", () => {
    expect(toBigInt("42", "value")).toBe(42n);
    expect(toBigInt("-42", "value")).toBe(-42n);
    expect(toBigInt("18446744073709551615", "value")).toBe(
      18446744073709551615n
    );
  });

  it("throws naming the field when the value is missing", () => {
    expect(() => toBigInt(undefined, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(null, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(undefined, "phantom")).toThrow(/missing/);
  });

  it("throws naming the field for garbage that String() would stringify", () => {
    expect(() => toBigInt({}, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt("[object Object]", "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(true, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(1.5, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(10n ** 30n, "phantom")).not.toThrow();
  });
});

describe("toBigIntOr (#484)", () => {
  it("returns the explicit fallback when the field is absent", () => {
    expect(toBigIntOr(undefined, 7n, "opt")).toBe(7n);
    expect(toBigIntOr(null, 7n, "opt")).toBe(7n);
  });

  it("converts present values through toBigInt", () => {
    expect(toBigIntOr(9, 7n, "opt")).toBe(9n);
    expect(toBigIntOr("9", 7n, "opt")).toBe(9n);
    expect(toBigIntOr(0n, 7n, "opt")).toBe(0n);
  });

  it("still throws for present-but-garbage values, naming the field", () => {
    expect(() => toBigIntOr("garbage", 7n, "opt")).toThrow(/"opt"/);
    expect(() => toBigIntOr({}, 7n, "opt")).toThrow(/"opt"/);
    expect(() => toBigIntOr(1.5, 7n, "opt")).toThrow(/"opt"/);
  });
});
