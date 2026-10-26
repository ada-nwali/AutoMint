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
    /** Aborted on shutdown: pagination and retry backoff stop early. */
    signal?: AbortSignal;
  }): Promise<GetEventsResult>;
  /** Oldest ledger the node still retains (`getHealth`); `getEvents` rejects older start ledgers. */
  getOldestLedger(signal?: AbortSignal): Promise<number>;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 15_000;

/** HTTP status of a failed request (axios sets `response.status`), if any. */
function httpStatus(error: Error): number | undefined {
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Decide retryability from the HTTP status on the error object, never from
 * digits in the message: an RPC message such as "startLedger must be between
 * 51234 and 61234" is permanent, not a 5xx (#1229). JSON-RPC errors arrive as
 * plain `{ code, message }` objects over HTTP 200 and are never retried.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = httpStatus(error);
  if (status !== undefined) return status === 429 || (status >= 500 && status <= 599);
  return /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|timeout|rate limit/i.test(
    error.message,
  );
}

/** Resolves after `ms`, or early as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("RPC request aborted by shutdown");
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    signal?: AbortSignal;
    sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    signal,
    sleepImpl = sleep,
  } = opts;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientError(error) || signal?.aborted) {
        throw error;
      }
      const jitter = Math.random() * 0.5 + 0.75; // ±25%
      const delay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1) * jitter,
      );
      await sleepImpl(delay, signal);
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
    signal?: AbortSignal;
    onPage?: (page: { events: RawRpcEvent[]; latestLedger: number; cursor?: string }) => Promise<void> | void;
  }): Promise<GetEventsResult> {
    const { startLedger, contractIds, cursor: initialCursor, signal, onPage } = opts;
    const limit = opts.limit ?? this.maxPage;

    const filters = [
      {
        type: "contract" as const,
        contractIds: contractIds as string[],
      },
    ];

    const allEvents: RawRpcEvent[] = [];
    let latestLedger = 0;
    let cursor: string | undefined = initialCursor;

    // Retry each page on its own (#1231): a transient failure on page N
    // re-requests page N with the same cursor, keeping pages 1..N-1.
    do {
      throwIfAborted(signal);
      const request = cursor
        ? { filters, cursor, limit }
        : { filters, startLedger, limit };

      const response = await withRetry(
        () => this.server.getEvents(request as rpc.Api.GetEventsRequest),
        { signal },
      );

      latestLedger = Math.max(latestLedger, Number(response.latestLedger ?? 0));

      const pageEvents: RawRpcEvent[] = [];
      for (const ev of response.events) {
        pageEvents.push({
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

      if (onPage) {
        await onPage({ events: pageEvents, latestLedger, cursor: response.cursor || undefined });
      } else {
        allEvents.push(...pageEvents);
      }

      cursor = response.cursor || undefined;
    } while (cursor);

    return { events: allEvents, latestLedger };
  }

  async getOldestLedger(signal?: AbortSignal): Promise<number> {
    const health = await withRetry(() => this.server.getHealth(), { signal });
    return health.oldestLedger;
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
