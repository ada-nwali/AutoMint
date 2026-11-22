/**
 * Contract helpers for tier minting (#1418), bot transfers (#1415), pause
 * status (#1416) and the minimum listing price (#1417).
 *
 * The real stellar-sdk encoders are used so a wrong ScVal type or argument
 * order fails here instead of at RPC simulation; only `simulateContractCall`
 * is replaced.
 */

jest.mock("../constants", () => {
  const { StrKey } = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...jest.requireActual("../constants"),
    CONTRACT_ADDRESSES: {
      ...jest.requireActual("../constants").CONTRACT_ADDRESSES,
      botNft: StrKey.encodeContract(Buffer.alloc(32, 1)),
      marketplace: StrKey.encodeContract(Buffer.alloc(32, 2)),
      token: StrKey.encodeContract(Buffer.alloc(32, 3)),
    },
  };
});

jest.mock("../stellar", () => ({
  ...jest.requireActual("../stellar"),
  simulateContractCall: jest.fn(),
}));

import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import { simulateContractCall } from "../stellar";
import { CONTRACT_ADDRESSES } from "../constants";
import {
  tierToScVal,
  buildMintTierArgs,
  buildTransferBotArgs,
  getTierRemaining,
  getMinListingPrice,
  isMarketplacePaused,
  isTokenPaused,
  TIER_UNCAPPED,
} from "../contracts";
import { TIER_ORDER } from "@/types";

const mockSimulate = simulateContractCall as jest.MockedFunction<typeof simulateContractCall>;
const OWNER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

beforeEach(() => mockSimulate.mockReset());

describe("tierToScVal", () => {
  it("encodes BotTier as its repr(u32) discriminant", () => {
    TIER_ORDER.forEach((tier, index) => {
      const scv = tierToScVal(tier);
      expect(scv.switch().name).toBe("scvU32");
      expect(scValToNative(scv)).toBe(index);
    });
  });
});

describe("buildMintTierArgs", () => {
  it("matches mint_tier(owner: Address, tier: BotTier) with no token argument", () => {
    const args = buildMintTierArgs(OWNER, "Silver");
    expect(args.map((a) => a.switch().name)).toEqual(["scvAddress", "scvU32"]);
    expect(args.map(scValToNative)).toEqual([OWNER, 2]);
  });
});

describe("buildTransferBotArgs", () => {
  it("matches transfer(bot_id: u64, from: Address, to: Address)", () => {
    const args = buildTransferBotArgs(12n, OWNER, RECIPIENT);
    expect(args.map((a) => a.switch().name)).toEqual(["scvU64", "scvAddress", "scvAddress"]);
    expect(args.map(scValToNative)).toEqual([12n, OWNER, RECIPIENT]);
  });
});

describe("getTierRemaining", () => {
  it("reads tier_remaining on bot_nft and passes the uncapped sentinel through", async () => {
    mockSimulate.mockResolvedValue(TIER_UNCAPPED);
    await expect(getTierRemaining("Bronze", OWNER)).resolves.toBe(TIER_UNCAPPED);

    const [contractId, method, args] = mockSimulate.mock.calls[0]!;
    expect(contractId).toBe(CONTRACT_ADDRESSES.botNft);
    expect(method).toBe("tier_remaining");
    expect(scValToNative(args[0]!)).toBe(1);
  });

  it("throws on a malformed result instead of reporting 0 stock", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getTierRemaining("Bronze", OWNER)).rejects.toThrow(/tier_remaining/);
  });
});

describe("getMinListingPrice", () => {
  it("reads get_min_price(currency) on the marketplace", async () => {
    mockSimulate.mockResolvedValue(40n);
    await expect(getMinListingPrice(CONTRACT_ADDRESSES.token, OWNER)).resolves.toBe(40n);

    const [contractId, method, args] = mockSimulate.mock.calls[0]!;
    expect(contractId).toBe(CONTRACT_ADDRESSES.marketplace);
    expect(method).toBe("get_min_price");
    expect(scValToNative(args[0]!)).toBe(CONTRACT_ADDRESSES.token);
  });
});

describe("pause flags", () => {
  it("reads marketplace is_paused()", async () => {
    mockSimulate.mockResolvedValue(true);
    await expect(isMarketplacePaused(OWNER)).resolves.toBe(true);
    expect(mockSimulate.mock.calls[0]!.slice(0, 2)).toEqual([
      CONTRACT_ADDRESSES.marketplace,
      "is_paused",
    ]);
  });

  it("reads token paused()", async () => {
    mockSimulate.mockResolvedValue(false);
    await expect(isTokenPaused(OWNER)).resolves.toBe(false);
    expect(mockSimulate.mock.calls[0]!.slice(0, 2)).toEqual([CONTRACT_ADDRESSES.token, "paused"]);
  });
});
