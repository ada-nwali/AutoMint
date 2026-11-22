import { describe, it, expect } from "vitest";
import {
  decodeRawEvent,
  DecodeError,
  toDecimal,
  toNum,
  contractNameFor,
  makeDecoder,
} from "../events.js";
import {
  G1,
  G2,
  G3,
  CREG,
  CBOT,
  CACC,
  CMAR,
  CTOK,
  addr,
  i128,
  makeRawEvent,
  sym,
  u32,
  u64,
  vec,
  testConfig,
} from "./helpers.js";

const config = testConfig();

describe("numeric normalization", () => {
  it("rejects bigint values that cannot be represented safely as numbers", () => {
    expect(() => toNum(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });

  it("preserves full-width identifiers as decimal strings", () => {
    const listingId = 18_446_744_073_709_551_615n;
    expect(toDecimal(listingId)).toBe("18446744073709551615");
  });
});

describe("decodeRawEvent", () => {
  it("registry.register: topics=[user], data=timestamp(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("register"), addr(G1)],
        value: u64(1700000000),
      }),
    );
    expect(ev.event).toBe("register");
    expect(ev.topics).toEqual([G1]);
    expect(toNum(ev.data)).toBe(1700000000);
  });

  it("registry.addpoints: data=points(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("addpoints"), addr(G1)],
        value: u64(12345),
      }),
    );
    expect(ev.event).toBe("addpoints");
    expect(toNum(ev.data)).toBe(12345);
  });

  it("registry.dec_bot: data=bot_count(u32)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("dec_bot"), addr(G1)],
        value: u32(4),
      }),
    );
    expect(ev.event).toBe("dec_bot");
    expect(toNum(ev.data)).toBe(4);
  });

  it("registry.init: topics=[admin], data=timestamp(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("init"), addr(G1)],
        value: u64(1700000001),
      }),
    );
    expect(ev.event).toBe("init");
    expect(ev.topics).toEqual([G1]);
    expect(toNum(ev.data)).toBe(1700000001);
  });

  it("registry.writers: topics=[name only], data=[accrual, bot_nft]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("writers")],
        value: vec([addr(G2), addr(G3)]),
      }),
    );
    expect(ev.event).toBe("writers");
    expect(ev.topics).toEqual([]);
    expect(ev.data).toEqual([G2, G3]);
  });

  it("registry.inc_bot: data=bot_count(u32)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("inc_bot"), addr(G1)],
        value: u32(2),
      }),
    );
    expect(ev.event).toBe("inc_bot");
    expect(toNum(ev.data)).toBe(2);
  });

  it("registry.claimed: data=amount(i128), serialized as a decimal string (#370)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("claimed"), addr(G1)],
        value: i128(25000000n),
      }),
    );
    expect(ev.event).toBe("claimed");
    expect(ev.topics).toEqual([G1]);
    expect(toDecimal(ev.data)).toBe("25000000");
  });

  it("registry.newseason: topics=[name only], data=season(u32) (#371)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("newseason")],
        value: u32(3),
      }),
    );
    expect(ev.event).toBe("newseason");
    expect(ev.topics).toEqual([]);
    expect(toNum(ev.data)).toBe(3);
  });

  it("registry.set_admin: data=[current, pending] two-address tuple (#372)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("set_admin")],
        value: vec([addr(G1), addr(G2)]),
      }),
    );
    expect(ev.event).toBe("set_admin");
    expect(ev.topics).toEqual([]);
    expect(ev.data).toEqual([G1, G2]);
  });

  it("registry.adm_acpt: data=[current, pending] (#372)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("adm_acpt")],
        value: vec([addr(G1), addr(G2)]),
      }),
    );
    expect(ev.event).toBe("adm_acpt");
    expect(ev.data).toEqual([G1, G2]);
  });

  it("registry.adm_cncl: data=[current, pending] (#372)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CREG,
        topics: [sym("adm_cncl")],
        value: vec([addr(G1), addr(G2)]),
      }),
    );
    expect(ev.event).toBe("adm_cncl");
    expect(ev.data).toEqual([G1, G2]);
  });

  it("bot_nft.mint (mint_tier): data=[bot_id(u64), tier(symbol)]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CBOT,
        topics: [sym("mint"), addr(G1)],
        value: vec([u64(7), sym("Premium")]),
      }),
    );
    expect(ev.event).toBe("mint");
    expect(ev.topics).toEqual([G1]);
    const data = ev.data as unknown[];
    expect(toNum(data[0])).toBe(7);
    expect(data[1]).toBe("Premium");
  });

  it("bot_nft.transfer: topics=[from,to], data=bot_id(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CBOT,
        topics: [sym("transfer"), addr(G1), addr(G2)],
        value: u64(42),
      }),
    );
    expect(ev.event).toBe("transfer");
    expect(ev.topics).toEqual([G1, G2]);
    expect(toNum(ev.data)).toBe(42);
  });

  it("accrual.start: data=timestamp(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CACC,
        topics: [sym("start"), addr(G1)],
        value: u64(1700000000),
      }),
    );
    expect(ev.event).toBe("start");
    expect(toNum(ev.data)).toBe(1700000000);
  });

  it("accrual.mint: data=amt_to_mint(i128)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CACC,
        topics: [sym("mint"), addr(G1)],
        value: i128(1234567890123456789n),
      }),
    );
    expect(ev.event).toBe("mint");
    expect(toDecimal(ev.data)).toBe("1234567890123456789");
  });

  it("accrual.claim: data=[pending(u64), remaining(u64)]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CACC,
        topics: [sym("claim"), addr(G1)],
        value: vec([u64(1500), u64(200)]),
      }),
    );
    expect(ev.event).toBe("claim");
    const data = ev.data as unknown[];
    expect(toNum(data[0])).toBe(1500);
    expect(toNum(data[1])).toBe(200);
  });

  it("marketplace.listed: topics=[seller, listing_id], data=[bot_id, price(i128), currency]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("listed"), addr(G1), u64(9)],
        value: vec([u64(3), i128(5000000000), addr(CTOK)]),
      }),
    );
    expect(ev.event).toBe("listed");
    expect(ev.topics[0]).toBe(G1);
    expect(toNum(ev.topics[1])).toBe(9);
    const data = ev.data as unknown[];
    expect(toNum(data[0])).toBe(3);
    expect(toDecimal(data[1])).toBe("5000000000");
    expect(data[2]).toBe(CTOK);
  });

  it("marketplace.cancel: topics=[seller, listing_id], data=bot_id(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("cancel"), addr(G1), u64(9)],
        value: u64(3),
      }),
    );
    expect(ev.event).toBe("cancel");
    expect(toNum(ev.data)).toBe(3);
  });

  it("marketplace.sold: topics=[seller, buyer], data=[listing_id, bot_id, price(i128), currency]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("sold"), addr(G1), addr(G2)],
        value: vec([u64(9), u64(3), i128(5000000000), addr(CTOK)]),
      }),
    );
    expect(ev.event).toBe("sold");
    expect(ev.topics[0]).toBe(G1);
    expect(ev.topics[1]).toBe(G2);
    const data = ev.data as unknown[];
    expect(toNum(data[0])).toBe(9);
    expect(toDecimal(data[2])).toBe("5000000000");
    expect(data[3]).toBe(CTOK);
  });

  it("marketplace.price_upd: topics=[seller, listing_id], data=[old_price, new_price]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("price_upd"), addr(G1), u64(9)],
        value: vec([i128(100), i128(120)]),
      }),
    );
    expect(ev.event).toBe("price_upd");
    expect(toDecimal((ev.data as unknown[])[1])).toBe("120");
  });

  it("token.approve: data=[amount(i128), expiration_ledger(u32)]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CTOK,
        topics: [sym("approve"), addr(G1), addr(G2)],
        value: vec([i128(2500000000), u32(500000)]),
      }),
    );
    expect(ev.event).toBe("approve");
    expect(ev.topics).toEqual([G1, G2]);
    const data = ev.data as unknown[];
    expect(toDecimal(data[0])).toBe("2500000000");
    expect(toNum(data[1])).toBe(500000);
  });

  it("token.burn: data=amount(i128)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CTOK,
        topics: [sym("burn"), addr(G1)],
        value: i128(100),
      }),
    );
    expect(ev.event).toBe("burn");
    expect(toDecimal(ev.data)).toBe("100");
  });

  it("token.mint: data=amount(i128)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CTOK,
        topics: [sym("mint"), addr(G1)],
        value: i128(1000000000),
      }),
    );
    expect(ev.event).toBe("mint");
    expect(toDecimal(ev.data)).toBe("1000000000");
  });

  it("token.set_admin: topics=[name only], data=new_admin(address)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CTOK,
        topics: [sym("set_admin")],
        value: addr(G1),
      }),
    );
    expect(ev.event).toBe("set_admin");
    expect(ev.topics).toEqual([]);
    expect(ev.data).toBe(G1);
  });

  it("token.transfer: topics=[from,to], data=amount(i128)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CTOK,
        topics: [sym("transfer"), addr(G1), addr(G2)],
        value: i128(777),
      }),
    );
    expect(ev.event).toBe("transfer");
    expect(ev.topics).toEqual([G1, G2]);
    expect(toDecimal(ev.data)).toBe("777");
  });

  it("rejects an event whose first topic is not a symbol", () => {
    expect(() =>
      decodeRawEvent(
        makeRawEvent({
          contractId: CTOK,
          topics: [u64(1), addr(G1)],
          value: i128(1),
        }),
      ),
    ).toThrow(DecodeError);
  });
});

describe("contractNameFor / makeDecoder", () => {
  it("maps each contract id to its AutoMint name", () => {
    expect(contractNameFor(CREG, config.contracts)).toBe("registry");
    expect(contractNameFor(CBOT, config.contracts)).toBe("bot_nft");
    expect(contractNameFor(CACC, config.contracts)).toBe("accrual");
    expect(contractNameFor(CMAR, config.contracts)).toBe("marketplace");
    expect(contractNameFor(CTOK, config.contracts)).toBe("token");
    expect(
      contractNameFor(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUNKN",
        config.contracts,
      ),
    ).toBe("unknown");
  });

  it("makeDecoder stamps the contract name on decoded events", () => {
    const decoder = makeDecoder(config);
    const ev = decoder.decode(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("sold"), addr(G1), addr(G2)],
        value: vec([u64(1), u64(1), i128(5), addr(CTOK)]),
      }),
    );
    expect(ev.contract).toBe("marketplace");
    expect(ev.contractId).toBe(CMAR);
  });
});
