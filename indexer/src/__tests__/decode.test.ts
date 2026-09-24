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

  it("marketplace.listed: topics=[seller, listing_id], data=[bot_id, price(i128)]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("listed"), addr(G1), u64(9)],
        value: vec([u64(3), i128(5000000000)]),
      }),
    );
    expect(ev.event).toBe("listed");
    expect(ev.topics[0]).toBe(G1);
    expect(toNum(ev.topics[1])).toBe(9);
    const data = ev.data as unknown[];
    expect(toNum(data[0])).toBe(3);
    expect(toDecimal(data[1])).toBe("5000000000");
  });

  it("marketplace.cancelled: data=bot_id(u64)", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("cancelled"), addr(G1), u64(9)],
        value: u64(3),
      }),
    );
    expect(ev.event).toBe("cancelled");
    expect(toNum(ev.data)).toBe(3);
  });

  it("marketplace.bought: data=[bot_id, price(i128)]", () => {
    const ev = decodeRawEvent(
      makeRawEvent({
        contractId: CMAR,
        topics: [sym("bought"), addr(G2), u64(9)],
        value: vec([u64(3), i128(5000000000)]),
      }),
    );
    expect(ev.event).toBe("bought");
    expect(ev.topics[0]).toBe(G2);
    expect(toDecimal((ev.data as unknown[])[1])).toBe("5000000000");
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
        topics: [sym("bought"), addr(G2), u64(1)],
        value: vec([u64(1), i128(5)]),
      }),
    );
    expect(ev.contract).toBe("marketplace");
    expect(ev.contractId).toBe(CMAR);
  });
});

