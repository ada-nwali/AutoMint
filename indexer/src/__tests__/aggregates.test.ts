import { describe, it, expect, beforeEach } from "vitest";
import { IndexerDb } from "../db.js";
import { decodeRawEvent, makeDecoder } from "../events.js";
import type { DecodedEvent } from "../types.js";
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
  u64,
  vec,
  testConfig,
} from "./helpers.js";

const config = testConfig();
const decoder = makeDecoder(config);

function today(): string {
  return new Date().toISOString();
}

let db: IndexerDb;

beforeEach(() => {
  db = new IndexerDb(":memory:");
});

function insert(contractId: string, topics: unknown[], value: unknown, seq: number): void {
  const raw = makeRawEvent({
    contractId,
    topics: topics as never,
    value: value as never,
    ledger: 1000 + seq,
    seq,
    closedAt: today(),
  });
  db.insertEvents([decoder.decode(raw)]);
}

describe("IndexerDb aggregates", () => {
  it("counts users, claims, mints; sums AMT + volume; tracks listings/floor price", () => {
    // Two users register (G1 twice — must count once).
    insert(CREG, [sym("register"), addr(G1)], u64(1), 1);
    insert(CREG, [sym("register"), addr(G1)], u64(2), 2);
    insert(CREG, [sym("register"), addr(G2)], u64(3), 3);

    // Two claims by G1.
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(1500), u64(200)]), 4);
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(900), u64(50)]), 5);

    // Token mints: 1000 + 250.
    insert(CTOK, [sym("mint"), addr(G1)], i128(1000), 6);
    insert(CTOK, [sym("mint"), addr(G2)], i128(250), 7);

    // Two listings: 500 and 1000.
    insert(CMAR, [sym("listed"), addr(G1), u64(1)], vec([u64(10), i128(500)]), 8);
    insert(CMAR, [sym("listed"), addr(G1), u64(2)], vec([u64(11), i128(1000)]), 9);

    // Buy listing 1 (price 500).
    insert(CMAR, [sym("bought"), addr(G2), u64(1)], vec([u64(10), i128(500)]), 10);

    const s = db.summary();
    expect(s.users).toBe(2);
    expect(s.total_claims).toBe(2);
    expect(s.total_mints).toBe(2);
    expect(s.amt_minted).toBe("1250");
    expect(s.volume).toBe("500");
    expect(s.floor_price).toBe("1000");
    expect(s.active_listings).toBe(1);
    expect(s.latest_ledger).toBe(0); // no checkpoint saved yet
  });

  it("handles large i128 amounts without precision loss", () => {
    const big = 170141183460469231731687303715884105727n; // i128::MAX
    insert(CTOK, [sym("mint"), addr(G1)], i128(big), 1);
    insert(CTOK, [sym("mint"), addr(G1)], i128(big), 2);
    expect(db.sumAmtMinted()).toBe((big + big).toString());
  });

  it("derives daily claims / amt / volume rows", () => {
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(1500), u64(0)]), 1);
    insert(CACC, [sym("claim"), addr(G1)], vec([u64(900), u64(0)]), 2);
    insert(CTOK, [sym("mint"), addr(G1)], i128(1000), 3);
    insert(CMAR, [sym("bought"), addr(G2), u64(5)], vec([u64(10), i128(777)]), 4);

    const rows = db.daily(7);
    const todayRow = rows[rows.length - 1];
    expect(todayRow.claims).toBe(2);
    expect(todayRow.amt_minted).toBe("1000");
    expect(todayRow.volume).toBe("777");
  });

  it("tracks listing lifecycle through cancel", () => {
    insert(CMAR, [sym("listed"), addr(G1), u64(7)], vec([u64(20), i128(600)]), 1);
    insert(CMAR, [sym("listed"), addr(G1), u64(8)], vec([u64(21), i128(900)]), 2);
    insert(CMAR, [sym("cancelled"), addr(G1), u64(8)], u64(21), 3);

    expect(db.countActiveListings()).toBe(1);
    expect(db.floorPrice()).toBe("600");
  });

  it("rejects events from failed contract calls at the DB layer is not needed — poller filters", () => {
    // The poller filters inSuccessfulContractCall; here we just confirm the
    // insert path accepts events regardless and counts them.
    insert(CTOK, [sym("mint"), addr(G1)], i128(5), 1);
    expect(db.sumAmtMinted()).toBe("5");
  });
});
