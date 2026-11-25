import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import {
  buildUpdatePriceArgs,
  buildReclaimExpiredArgs,
  buildAcceptOfferArgs,
  buildDismissOfferArgs,
  parseOffer,
} from "../contracts";

const SELLER = Keypair.random().publicKey();
const BUYER = Keypair.random().publicKey();
const TOKEN_ID = Keypair.random().publicKey();

describe("marketplace action argument builders", () => {
  describe("buildUpdatePriceArgs (#1406)", () => {
    it("encodes seller, listing_id, and new_price with matching ScVal types", () => {
      const args = buildUpdatePriceArgs(SELLER, 10n, 50_000_000n);
      expect(args).toHaveLength(3);
      expect(args.map((a) => a.switch().name)).toEqual([
        "scvAddress",
        "scvU64",
        "scvI128",
      ]);
      expect(scValToNative(args[0])).toBe(SELLER);
      expect(scValToNative(args[1])).toBe(10n);
      expect(scValToNative(args[2])).toBe(50_000_000n);
    });
  });

  describe("buildReclaimExpiredArgs (#1407)", () => {
    it("encodes listing_id as a single u64 ScVal", () => {
      const args = buildReclaimExpiredArgs(42n);
      expect(args).toHaveLength(1);
      expect(args[0].switch().name).toBe("scvU64");
      expect(scValToNative(args[0])).toBe(42n);
    });
  });

  describe("buildAcceptOfferArgs (#1409)", () => {
    it("encodes seller Address and offer_id u64", () => {
      const args = buildAcceptOfferArgs(SELLER, 88n);
      expect(args).toHaveLength(2);
      expect(args.map((a) => a.switch().name)).toEqual([
        "scvAddress",
        "scvU64",
      ]);
      expect(scValToNative(args[0])).toBe(SELLER);
      expect(scValToNative(args[1])).toBe(88n);
    });
  });

  describe("buildDismissOfferArgs (#1409)", () => {
    it("encodes caller Address and offer_id u64", () => {
      const args = buildDismissOfferArgs(SELLER, 99n);
      expect(args).toHaveLength(2);
      expect(args.map((a) => a.switch().name)).toEqual([
        "scvAddress",
        "scvU64",
      ]);
      expect(scValToNative(args[0])).toBe(SELLER);
      expect(scValToNative(args[1])).toBe(99n);
    });
  });

  describe("parseOffer (#1409)", () => {
    it("correctly parses raw record into BotOffer structure", () => {
      const raw = {
        id: "12",
        buyer: BUYER,
        bot_id: "5",
        amount: "100000000",
        currency: TOKEN_ID,
        created_at: "1700000000",
        expires_at: "1700086400",
        status: "Active",
      };

      const offer = parseOffer(raw);
      expect(offer).toEqual({
        id: 12n,
        buyer: BUYER,
        bot_id: 5n,
        amount: 100_000_000n,
        currency: TOKEN_ID,
        created_at: 1700000000n,
        expires_at: 1700086400n,
        status: "Active",
      });
    });

    it("parses single-element array status or number status", () => {
      const base = {
        id: "1",
        bot_id: "10",
        amount: "500",
        currency: TOKEN_ID,
        created_at: "1000",
        expires_at: "2000",
      };
      expect(parseOffer({ ...base, id: "1", status: ["Accepted"] }).status).toBe("Accepted");
      expect(parseOffer({ ...base, id: "2", status: 2 }).status).toBe("Cancelled");
      expect(parseOffer({ ...base, id: "3", status: "Unknown" }).status).toBe("Active");
    });
  });
});
