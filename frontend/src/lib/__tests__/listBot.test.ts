/**
 * list_bot argument encoding (#468).
 *
 * The marketplace contract is
 *   list_bot(seller: Address, bot_id: u64, price: i128, currency: Address)
 *
 * These tests use the real stellar-sdk to build the Soroban invocation and
 * read the ScVal types back out of the operation, so a wrong argument count,
 * order or integer width fails here instead of at RPC simulation.
 */

jest.mock("../constants", () => {
  const { StrKey } = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...jest.requireActual("../constants"),
    // The placeholder defaults are not valid strkeys; the real Contract and
    // Address encoders validate their checksum.
    MARKETPLACE_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 1)),
    TOKEN_CONTRACT_ID: StrKey.encodeContract(Buffer.alloc(32, 2)),
  };
});

const mockServer = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
};

// Keep the real ScVal helpers; only the RPC round trips are replaced.
jest.mock("../stellar", () => ({
  ...jest.requireActual("../stellar"),
  rpcCall: (fn: (server: unknown) => unknown) => fn(mockServer),
}));

import { Account, Contract, Keypair, StrKey, scValToNative } from "@stellar/stellar-sdk";
import { buildListBotArgs, listBot } from "../contracts";
import { MARKETPLACE_CONTRACT_ID, TOKEN_CONTRACT_ID } from "../constants";

const SELLER = Keypair.random().publicKey();
const OTHER_CURRENCY = StrKey.encodeContract(Buffer.alloc(32, 9));

/** Build the real operation and return the invocation it encodes. */
function invocationOf(args: ReturnType<typeof buildListBotArgs>) {
  const op = new Contract(MARKETPLACE_CONTRACT_ID).call("list_bot", ...args);
  return op.body().invokeHostFunctionOp().hostFunction().invokeContract();
}

describe("buildListBotArgs", () => {
  it("encodes exactly four arguments in the contract's order and ScVal types", () => {
    const invocation = invocationOf(buildListBotArgs(SELLER, 42n, 25_000_000n));

    expect(invocation.functionName().toString()).toBe("list_bot");

    const args = invocation.args();
    expect(args).toHaveLength(4);
    expect(args.map((arg) => arg.switch().name)).toEqual([
      "scvAddress", // seller: Address
      "scvU64", //     bot_id: u64
      "scvI128", //    price: i128
      "scvAddress", // currency: Address
    ]);
  });

  it("carries the seller, bot id and price through unchanged", () => {
    const args = invocationOf(buildListBotArgs(SELLER, 42n, 25_000_000n)).args();

    expect(scValToNative(args[0])).toBe(SELLER);
    expect(scValToNative(args[1])).toBe(42n);
    expect(scValToNative(args[2])).toBe(25_000_000n);
  });

  it("defaults the currency to the configured payment token", () => {
    const args = invocationOf(buildListBotArgs(SELLER, 1n, 1n)).args();

    expect(scValToNative(args[3])).toBe(TOKEN_CONTRACT_ID);
  });

  it("uses an explicit currency when one is supplied", () => {
    const args = invocationOf(buildListBotArgs(SELLER, 1n, 1n, OTHER_CURRENCY)).args();

    expect(scValToNative(args[3])).toBe(OTHER_CURRENCY);
  });
});

describe("listBot", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockServer.getAccount.mockResolvedValue(new Account(SELLER, "1"));
    // Stop at simulation: the transaction handed to it is what is under test.
    mockServer.simulateTransaction.mockResolvedValue({ error: "stopped before assembly" });
  });

  it("simulates a list_bot call against the marketplace, sourced from the seller", async () => {
    await expect(listBot(SELLER, 7n, 100n)).rejects.toThrow(
      "Simulation failed for list_bot: stopped before assembly"
    );

    expect(mockServer.getAccount).toHaveBeenCalledWith(SELLER);

    const built = mockServer.simulateTransaction.mock.calls[0][0];
    expect(built.source).toBe(SELLER);

    const invocation = built
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction()
      .invokeContract();
    expect(invocation.functionName().toString()).toBe("list_bot");

    const args = invocation.args();
    expect(args.map((arg: { switch(): { name: string } }) => arg.switch().name)).toEqual([
      "scvAddress",
      "scvU64",
      "scvI128",
      "scvAddress",
    ]);
    expect(scValToNative(args[0])).toBe(SELLER);
    expect(scValToNative(args[3])).toBe(TOKEN_CONTRACT_ID);
  });
});
