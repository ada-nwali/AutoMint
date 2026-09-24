import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { IndexerDb } from "../db.js";
import { makeDecoder } from "../events.js";
import { createApiServer } from "../api.js";
import {
  G1,
  G2,
  CACC,
  CTOK,
  CMAR,
  CREG,
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

let db: IndexerDb;
let listen: Server;
let base: string;

beforeEach(async () => {
  db = new IndexerDb(":memory:");
  const app = createApiServer({ db, config });
  const srv = app.listen(0);
  await new Promise<void>((resolve) => srv.once("listening", resolve));
  const port = (srv.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  listen = srv;
});

afterEach(() => {
  listen.close();
  db.close();
});

function seed(): void {
  const raw = (seq: number) => {
    const cases: Array<[string, unknown[], unknown]> = [
      [CREG, [sym("register"), addr(G1)], u64(1)],
      [CREG, [sym("register"), addr(G2)], u64(2)],
      [CACC, [sym("claim"), addr(G1)], vec([u64(100), u64(0)])],
      [CACC, [sym("claim"), addr(G1)], vec([u64(200), u64(0)])],
      [CTOK, [sym("mint"), addr(G1)], i128(500)],
      [CTOK, [sym("mint"), addr(G2)], i128(250)],
      [CMAR, [sym("listed"), addr(G1), u64(1)], vec([u64(10), i128(999)])],
      [CMAR, [sym("bought"), addr(G2), u64(1)], vec([u64(10), i128(999)])],
      [CMAR, [sym("listed"), addr(G1), u64(2)], vec([u64(11), i128(777)])],
    ];
    const [cid, topics, value] = cases[seq];
    return makeRawEvent({
      contractId: cid,
      topics: topics as never,
      value: value as never,
      ledger: 5000 + seq,
      seq,
      closedAt: new Date().toISOString(),
    });
  };
  for (let i = 0; i < 9; i += 1) {
    db.insertEvents([decoder.decode(raw(i))]);
  }
  db.saveCheckpoint(5008);
}

describe("aggregate API", () => {
  it("GET /api/summary returns correct figures", async () => {
    seed();
    const res = await fetch(`${base}/api/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(2);
    expect(body.total_claims).toBe(2);
    expect(body.amt_minted).toBe("750");
    expect(body.volume).toBe("999");
    expect(body.floor_price).toBe("777");
    expect(body.active_listings).toBe(1);
    expect(body.latest_ledger).toBe(5008);
  });

  it("GET /api/claims/daily returns the last 30 days incl. today's figures", async () => {
    seed();
    const res = await fetch(`${base}/api/claims/daily?days=30`);
    const body = await res.json();
    expect(body.rows.length).toBe(30);
    const last = body.rows[body.rows.length - 1];
    expect(last.claims).toBe(2);
    expect(last.amt_minted).toBe("750");
    expect(last.volume).toBe("999");
  });

  it("GET /api/events returns seeded events newest-first", async () => {
    seed();
    const res = await fetch(`${base}/api/events?limit=5`);
    const body = await res.json();
    expect(body.events.length).toBe(5);
    expect(body.events[0].ledger).toBe(5008); // newest first
  });

  it("GET / serves the ops dashboard HTML", async () => {
    seed();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("AutoMint Ops Dashboard");
    expect(html).toContain('id="cards"');
  });

  it("GET /api/health reports checkpoint and contract ids", async () => {
    seed();
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checkpoint_ledger).toBe(5008);
    expect(body.contracts.token).toBe(config.contracts.token);
  });
});
