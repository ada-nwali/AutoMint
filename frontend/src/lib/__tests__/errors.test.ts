import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONTRACT_ERROR_MESSAGES,
  parseContractError,
} from "../errors";

const rustEnums = {
  token: ["contracts/token/src/lib.rs", "TokenError"],
  registry: ["contracts/registry/src/lib.rs", "RegistryError"],
  botNft: ["contracts/bot_nft/src/lib.rs", "BotNFTError"],
  accrual: ["contracts/accrual/src/lib.rs", "AccrualError"],
  marketplace: ["contracts/marketplace/src/lib.rs", "MarketplaceError"],
} as const;

describe("parseContractError", () => {
  it("maps a Soroban contract code and keeps the suggested action", () => {
    expect(
      parseContractError(
        new Error("Simulation failed: HostError: Error(Contract, #4)"),
        "token"
      )
    ).toEqual({
      title: "Not enough AMT",
      message: "Your AMT balance is too low for this transaction.",
      action: "Claim points",
    });
  });

  it("maps errors nested in submission details", () => {
    expect(
      parseContractError(
        { message: "Submission failed", details: "Error(Contract, #14)" },
        "marketplace"
      ).title
    ).toBe("Listing changed");
  });

  it("maps registry ImplausiblePoints (11) to actionable copy (#1391)", () => {
    expect(
      parseContractError("Simulation failed: Error(Contract, #11)", "registry")
    ).toEqual({
      title: "Points update rejected",
      message: "This points update exceeds the amount one call may add.",
      action: "Contact support.",
    });
  });

  it("maps accrual BotNftCallFailed (14) to actionable copy (#1392)", () => {
    expect(
      parseContractError("Simulation failed: Error(Contract, #14)", "accrual")
    ).toEqual({
      title: "Bot sync failed",
      message: "The bot contract could not complete the accrual sync.",
      action: "Try again later.",
    });
  });

  it("returns generic copy for unknown codes and non-contract failures", () => {
    expect(parseContractError("Error(Contract, #999)", "token").title).toBe(
      "Transaction failed"
    );
    expect(parseContractError(new Error("RPC unavailable"), "accrual")).toEqual({
      title: "Transaction failed",
      message: "The contract could not complete this request.",
      action: "Review the details and try again.",
    });
  });

  it("has a message for every explicitly numbered Rust contract error", () => {
    for (const [contract, [relativePath, enumName]] of Object.entries(rustEnums)) {
      const source = readFileSync(
        resolve(__dirname, "../../../../", relativePath),
        "utf8"
      );
      const enumBlock = source.match(
        new RegExp(`pub enum ${enumName}\\s*\\{([\\s\\S]*?)\\}`)
      );
      const enumBody = enumBlock?.[1];
      expect(enumBody).toBeDefined();
      if (enumBody === undefined) throw new Error(`${enumName} was not found`);
      const variants = [
        ...enumBody.matchAll(
          /^\s*([A-Z]\w*)\s*(?:=\s*(\d+))?\s*,\s*(?:\/\/.*)?$/gm
        ),
      ];
      const codes = variants.map((variant) => Number(variant[2]));
      expect(variants.length).toBeGreaterThan(0);
      expect(variants.every((variant) => variant[2] !== undefined)).toBe(true);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(CONTRACT_ERROR_MESSAGES[contract as keyof typeof CONTRACT_ERROR_MESSAGES][code])
          .toBeDefined();
      }
    }
  });
});
