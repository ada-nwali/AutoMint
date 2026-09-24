/**
 * Soroban RPC client wrapper for the indexer.
 *
 * Polls the `getEvents` endpoint with cursor-based pagination, filtering for
 * the five AutoMint contracts, and returns raw events plus the latest ledger.
 * The stellar-sdk (v14) already parses each event's `topic`/`value` from base64
 * into `xdr.ScVal` objects, so no manual XDR decoding is needed here.
 * Transient failures (network errors, 5xx, 429) are retried with exponential
 * backoff + jitter so a rate-limited public RPC node does not stall the
 * indexer permanently.
 */
import { rpc, xdr } from "@stellar/stellar-sdk";

export interface RawRpcEvent {
  /** Unique, stable RPC event id (paging token) — the idempotency key. */
  id: string;
  contractId: string;
  ledger: number;
  ledgerClosedAt: string | null;
  txHash: string;
  eventIndex: number;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  inSuccessfulContractCall: boolean;
}

export interface GetEventsResult {
  events: RawRpcEvent[];
  latestLedger: number;
}

export interface RpcClient {
  getEvents(opts: {
    startLedger: number;
    contractIds: string[];
    cursor?: string;
    limit?: number;
  }): Promise<GetEventsResult>;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 15_000;

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|timeout|429|5\d\d|rate limit/i.test(
    msg,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    sleepImpl?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    sleepImpl = sleep,
  } = opts;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientError(error)) throw error;
      const jitter = Math.random() * 0.5 + 0.75; // ±25%
      const delay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1) * jitter,
      );
      await sleepImpl(delay);
    }
  }
}

export class SorobanRpcClient implements RpcClient {
  private readonly server: rpc.Server;

  constructor(rpcUrl: string, private readonly maxPage = 100) {
    this.server = new rpc.Server(rpcUrl);
  }

  async getEvents(opts: {
    startLedger: number;
    contractIds: string[];
    cursor?: string;
    limit?: number;
  }): Promise<GetEventsResult> {
    const { startLedger, contractIds, cursor: initialCursor } = opts;
    const limit = opts.limit ?? this.maxPage;

    const filters = [
      {
        type: "contract" as const,
        contractIds: contractIds as string[],
      },
    ];

    return withRetry(async () => {
      const allEvents: RawRpcEvent[] = [];
      let latestLedger = 0;
      let cursor: string | undefined = initialCursor;

      do {
        const request = cursor
          ? { filters, cursor, limit }
          : { filters, startLedger, limit };

        const response = await this.server.getEvents(
          request as rpc.Api.GetEventsRequest,
        );

        latestLedger = Math.max(latestLedger, Number(response.latestLedger ?? 0));

        for (const ev of response.events) {
          allEvents.push({
            id: ev.id,
            contractId: ev.contractId?.toString() ?? "",
            ledger: Number(ev.ledger),
            ledgerClosedAt: ev.ledgerClosedAt ?? null,
            txHash: ev.txHash,
            eventIndex: parseEventIndex(ev.id),
            topic: ev.topic,
            value: ev.value,
            inSuccessfulContractCall: ev.inSuccessfulContractCall,
          });
        }
        cursor = response.cursor || undefined;
      } while (cursor);

      return { events: allEvents, latestLedger };
    });
  }
}

/** Extract the trailing event index from an RPC event paging token. */
export function parseEventIndex(id: string): number {
  const parts = id.split("-");
  const last = parts[parts.length - 1];
  const n = Number(last);
  return Number.isFinite(n) ? n : 0;
}

export function makeRpcClient(rpcUrl: string): RpcClient {
  return new SorobanRpcClient(rpcUrl);
}
