/**
 * Shared test helpers: valid strkey generators, ScVal builders that mirror the
 * EXACT XDR shapes the AutoMint contracts emit (see docs/EVENTS.md), and a
 * fake RPC client for exercising the poller without a live node.
 */
import { nativeToScVal, StrKey, xdr } from "@stellar/stellar-sdk";
import type { ContractConfig, RawEvent } from "../types.js";
import type { GetEventsResult, RawRpcEvent, RpcClient } from "../rpc.js";

// Deterministic, checksum-valid strkeys.
export const G1 = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
export const G2 = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
export const G3 = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
export const CREG = StrKey.encodeContract(Buffer.alloc(32, 11));
export const CBOT = StrKey.encodeContract(Buffer.alloc(32, 12));
export const CACC = StrKey.encodeContract(Buffer.alloc(32, 13));
export const CMAR = StrKey.encodeContract(Buffer.alloc(32, 14));
export const CTOK = StrKey.encodeContract(Buffer.alloc(32, 15));

export function testConfig(): ContractConfig {
  return {
    network: "testnet",
    contracts: {
      registry: CREG,
      bot_nft: CBOT,
      accrual: CACC,
      marketplace: CMAR,
      token: CTOK,
    },
  };
}

// ── ScVal builders ──────────────────────────────────────────────────────────

export function addr(strkey: string): xdr.ScVal {
  return nativeToScVal(strkey, { type: "address" }) as xdr.ScVal;
}

export function u64(n: bigint | number): xdr.ScVal {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
}

export function u32(n: number): xdr.ScVal {
  return xdr.ScVal.scvU32(n);
}

export function i128(n: bigint | number): xdr.ScVal {
  const v = BigInt(n);
  const lo = v & 0xffffffffffffffffn;
  const hi = v >> 64n; // arithmetic shift keeps the sign for negative values
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Uint64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    }),
  );
}

export function sym(s: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(s);
}

export function vec(vals: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(vals);
}

// ── Raw event construction ──────────────────────────────────────────────────

export interface MakeRawOpts {
  contractId: string;
  /** Full topic list INCLUDING the event-name symbol as the first element. */
  topics: xdr.ScVal[];
  value: xdr.ScVal;
  ledger?: number;
  seq?: number;
  closedAt?: string | null;
  inSuccessful?: boolean;
}

export function makeRawEvent(opts: MakeRawOpts): RawEvent {
  const ledger = opts.ledger ?? 1000;
  const seq = opts.seq ?? 0;
  return {
    id: `${String(ledger).padStart(16, "0")}-0000000000-${String(seq).padStart(10, "0")}`,
    contractId: opts.contractId,
    contract: "registry",
    ledger,
    txHash: `tx-${ledger}-${seq}`,
    eventIndex: seq,
    ledgerClosedAt: opts.closedAt ?? null,
    topic: opts.topics,
    value: opts.value,
    inSuccessfulContractCall: opts.inSuccessful ?? true,
  };
}

// ── Fake RPC ────────────────────────────────────────────────────────────────

export interface FakeRpcScriptPage {
  events: RawRpcEvent[];
  latestLedger: number;
  cursor: string | null;
}

/** A scripted RPC client: each call returns the next page. */
export class FakeRpcClient implements RpcClient {
  public calls: Array<{ startLedger: number; cursor?: string }> = [];
  constructor(
    private readonly pages: FakeRpcScriptPage[],
    private readonly options: { rewindAfter?: number } = {},
  ) {}

  async getEvents(opts: {
    startLedger: number;
    contractIds: string[];
    cursor?: string;
    limit?: number;
  }): Promise<GetEventsResult> {
    this.calls.push({ startLedger: opts.startLedger, cursor: opts.cursor });
    const page = this.pages.shift();
    if (!page) {
      throw new Error("FakeRpcClient: no more scripted pages");
    }
    return { events: page.events, latestLedger: page.latestLedger };
  }
}

export function toRawRpcEvent(ev: RawEvent): RawRpcEvent {
  return {
    id: ev.id,
    contractId: ev.contractId,
    ledger: ev.ledger,
    ledgerClosedAt: ev.ledgerClosedAt,
    txHash: ev.txHash,
    eventIndex: ev.eventIndex,
    topic: ev.topic as xdr.ScVal[],
    value: ev.value as xdr.ScVal,
    inSuccessfulContractCall: ev.inSuccessfulContractCall,
  };
}
