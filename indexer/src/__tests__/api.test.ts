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
let extraHealth: (() => Record<string, unknown>) | undefined;

beforeEach(async () => {
  db = new IndexerDb(":memory:");
  const app = createApiServer({ db, config, extraHealth });
  const srv = app.listen(0);
  await new Promise<void>((resolve) => srv.once("listening", resolve));
  const port = (srv.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  listen = srv;
});

afterEach(() => {
  listen.close();
  db.close();
  extraHealth = undefined;
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
      [CMAR, [sym("listed"), addr(G1), u64(1)], vec([u64(10), i128(999), addr(CTOK)])],
      [
        CMAR,
        [sym("sold"), addr(G1), addr(G2)],
        vec([u64(1), u64(10), i128(999), addr(CTOK)]),
      ],
      [CMAR, [sym("listed"), addr(G1), u64(2)], vec([u64(11), i128(777), addr(CTOK)])],
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
    expect(body.markets).toEqual([
      { currency: CTOK, volume: "999", floor_price: "777", active_listings: 1 },
    ]);
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
    expect(last.volume_by_currency).toEqual({ [CTOK]: "999" });
  });

  it("GET /api/events returns seeded events newest-first", async () => {
    seed();
    const res = await fetch(`${base}/api/events?limit=5`);
    const body = await res.json();
    expect(body.events.length).toBe(5);
    expect(body.events[0].ledger).toBe(5008); // newest first
  });

  it("GET /api/events reports the full event count as total, not the page size (#1244)", async () => {
    seed();
    const body = await fetch(`${base}/api/events?limit=2&offset=4`).then((res) => res.json());
    expect(body.total).toBe(9);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].ledger).toBe(5004);
  });

  it("GET /api/events preserves full-width listing IDs as decimal strings", async () => {
    const listingId = 18_446_744_073_709_551_615n;
    const raw = makeRawEvent({
      contractId: CMAR,
      topics: [sym("listed"), addr(G1), u64(listingId)],
      value: vec([u64(1), i128(999)]),
      ledger: 6000,
    });
    db.insertEvents([decoder.decode(raw)]);

    const res = await fetch(`${base}/api/events`);
    const body = await res.json();
    expect(JSON.parse(body.events[0].topics_json)).toEqual([
      G1,
      listingId.toString(),
    ]);
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

  it("GET /api/health distinguishes process liveness from stale readiness", async () => {
    extraHealth = () => ({
      ok: false,
      liveness: { ok: true },
      readiness: {
        ok: false,
        stale: true,
        last_successful_poll_at: null,
        last_failure_at: "2026-10-20T10:00:00.000Z",
        last_error: "RPC unavailable",
      },
    });

    // Recreate the server with the health callback configured.
    listen.close();
    const app = createApiServer({ db, config, extraHealth });
    const srv = app.listen(0);
    await new Promise<void>((resolve) => srv.once("listening", resolve));
    listen = srv;
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.liveness.ok).toBe(true);
    expect(body.readiness).toMatchObject({
      ok: false,
      stale: true,
      last_error: "RPC unavailable",
    });
  });

  it("rejects non-integer days/limit/offset with 400 instead of a server error (#660)", async () => {
    const invalid = [
      "/api/claims/daily?days=abc",
      "/api/claims/daily?days=1.5",
      "/api/claims/daily?days=NaN",
      "/api/claims/daily?days=1e3",
      "/api/claims/daily?days=",
      "/api/events?limit=abc",
      "/api/events?limit=2.5",
      "/api/events?offset=Infinity",
      "/api/events?offset=-1.5",
    ];
    for (const path of invalid) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(400);
      expect((await res.json()).error, path).toMatch(/must be an integer/);
    }
  });

  it("still accepts whole-number pagination parameters and clamps their range (#660)", async () => {
    seed();
    const daily = await fetch(`${base}/api/claims/daily?days=7`).then((res) => res.json());
    expect(daily.days).toBe(7);

    const clamped = await fetch(`${base}/api/claims/daily?days=-5`).then((res) => res.json());
    expect(clamped.days).toBe(1);

    const events = await fetch(`${base}/api/events?limit=2&offset=-3`);
    expect(events.status).toBe(200);
    expect((await events.json()).events).toHaveLength(2);
  });
});
