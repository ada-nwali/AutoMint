/**
 * Polling loop for the AutoMint indexer.
 *
 * Each iteration:
 *   1. reads the persisted checkpoint (last fully-processed ledger),
 *   2. fetches events from `checkpoint + 1` (or, on a cold start, the
 *      configured start ledger itself or the RPC's oldest retained ledger)
 *      via the RPC client, with cursor-based pagination,
 *   3. decodes each event and inserts it with an idempotent upsert keyed by
 *      the stable event id — so overlapping fetches after a restart can never
 *      double-count,
 *   4. saves the latest ledger as the new checkpoint.
 *
 * A restart therefore resumes from the last checkpoint; any events from the
 * overlapping window are re-fetched and ignored by the idempotent insert.
 */
import type { ContractConfig, DecodedEvent, RawEvent } from "./types.js";
import type { RpcClient, RawRpcEvent } from "./rpc.js";
import { makeDecoder, DecodeError } from "./events.js";
import type { IndexerDb } from "./db.js";

export interface PollerOptions {
  rpc: RpcClient;
  db: IndexerDb;
  config: ContractConfig;
  /**
   * Ledger to start from (inclusive) when there is no checkpoint yet; 0 or
   * unset means the oldest ledger the RPC node still retains.
   */
  defaultStartLedger?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface PollResult {
  fetched: number;
  inserted: number;
  skipped: number;
  latestLedger: number;
}

export interface PollHealth {
  liveness: { ok: true };
  readiness: {
    ok: boolean;
    stale: boolean;
    last_successful_poll_at: string | null;
    last_failure_at: string | null;
    last_error: string | null;
  };
  ok: boolean;
}

export class Poller {
  private readonly rpc: RpcClient;
  private readonly db: IndexerDb;
  private readonly config: ContractConfig;
  private readonly defaultStartLedger: number;
  private readonly log: (
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
  private lastSuccessfulPollAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: string | null = null;

  constructor(opts: PollerOptions) {
    this.rpc = opts.rpc;
    this.db = opts.db;
    this.config = opts.config;
    this.defaultStartLedger = opts.defaultStartLedger ?? 0;
    this.log = opts.log ?? ((message) => console.log(`[poller] ${message}`));
  }

  /** Last fully-processed ledger, or `null` before the first checkpoint. */
  async currentCheckpoint(): Promise<number | null> {
    return this.db.getCheckpoint();
  }

  /**
   * First ledger to fetch (inclusive): the one after the checkpoint, or on a
   * cold start the configured start ledger itself (#1228). Ledger 0 does not
   * exist, so an unset start ledger begins at the oldest ledger the RPC node
   * retains — `getEvents` rejects anything outside its retention window.
   */
  private async resolveStartLedger(
    checkpoint: number | null,
    signal?: AbortSignal,
  ): Promise<number> {
    if (checkpoint !== null) return checkpoint + 1;
    if (this.defaultStartLedger > 0) return this.defaultStartLedger;
    return this.rpc.getOldestLedger(signal);
  }

  /**
   * Run one poll cycle. Throws on RPC failure (caller decides whether to
   * retry/sleep); returns counts for observability.
   */
  private async pollOnceInternal(signal?: AbortSignal): Promise<PollResult> {
    const checkpoint = await this.currentCheckpoint();
    const startLedger = await this.resolveStartLedger(checkpoint, signal);

    const contractIds = Object.values(this.config.contracts);
    this.log("polling", {
      startLedger,
      latestCheckpoint: checkpoint,
      contracts: contractIds.length,
    });

    const decoder = makeDecoder(this.config);
    let totalInserted = 0;
    let totalSkipped = 0;

    const { events, latestLedger } = await this.rpc.getEvents({
      startLedger,
      contractIds,
      signal,
      onPage: async (page) => {
        if (signal?.aborted) throw new Error("poll aborted by shutdown");
        const decoded: DecodedEvent[] = [];
        for (const raw of toRawEvents(page.events)) {
          if (raw.inSuccessfulContractCall === false) {
            totalSkipped += 1;
            continue;
          }
          try {
            decoded.push(decoder.decode(raw));
          } catch (error) {
            if (error instanceof DecodeError) {
              totalSkipped += 1;
              this.log(`skipping undecodable event ${raw.id}`, {
                error: error.message,
              });
            } else {
              throw error;
            }
          }
        }
        const inserted = this.db.insertEvents(decoded);
        totalInserted += inserted;
        if (page.events.length > 0) {
          const maxLedger = Math.max(...page.events.map((e) => e.ledger));
          this.db.saveCheckpoint(maxLedger);
        }
      },
    });

    const inserted = totalInserted;
    const skipped = totalSkipped;
    if (latestLedger > 0) {
      this.db.saveCheckpoint(latestLedger);
    }

    this.log("poll complete", {
      fetched: events.length,
      inserted,
      skipped,
      latestLedger,
    });

    return { fetched: events.length, inserted, skipped, latestLedger };
  }

  async pollOnce(signal?: AbortSignal): Promise<PollResult> {
    try {
      const result = await this.pollOnceInternal(signal);
      this.lastSuccessfulPollAt = Date.now();
      return result;
    } catch (error) {
      // An abort is a shutdown, not an RPC failure: don't mark readiness red.
      if (signal?.aborted) throw error;
      this.lastFailureAt = Date.now();
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  health(staleAfterMs: number, now = Date.now()): PollHealth {
    const stale =
      this.lastSuccessfulPollAt === null ||
      now - this.lastSuccessfulPollAt > staleAfterMs;
    const failedSinceSuccess =
      this.lastFailureAt !== null &&
      (this.lastSuccessfulPollAt === null ||
        this.lastFailureAt > this.lastSuccessfulPollAt);
    const ready = !stale && !failedSinceSuccess;

    return {
      liveness: { ok: true },
      readiness: {
        ok: ready,
        stale,
        last_successful_poll_at:
          this.lastSuccessfulPollAt === null
            ? null
            : new Date(this.lastSuccessfulPollAt).toISOString(),
        last_failure_at:
          this.lastFailureAt === null
            ? null
            : new Date(this.lastFailureAt).toISOString(),
        last_error: this.lastError,
      },
      ok: ready,
    };
  }

  /**
   * Run the polling loop until `signal` is aborted. Sleeps `intervalMs`
   * between iterations; a failed iteration is logged and the loop continues
   * (the retry wrapper inside the RPC client already absorbs transient RPC
   * errors).
   *
   * Abort is cooperative: an in-flight cycle is abandoned before it writes,
   * and the returned promise settles only once no poll is still running, so
   * the caller may close the database as soon as `run` resolves (#662, #1240).
   */
  async run(intervalMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.pollOnce(signal);
      } catch (error) {
        if (signal.aborted) break;
        this.log("poll iteration failed", { error: (error as Error).message });
      }
      if (signal.aborted) break;
      await abortableSleep(intervalMs, signal);
    }
    this.log("poller stopped");
  }
}

/** Map RPC raw events to the internal RawEvent shape. */
export function toRawEvents(events: RawRpcEvent[]): RawEvent[] {
  return events.map((ev) => ({
    id: ev.id,
    contractId: ev.contractId,
    contract: "registry", // overwritten by the decoder via contract-name map
    ledger: ev.ledger,
    txHash: ev.txHash,
    eventIndex: ev.eventIndex,
    ledgerClosedAt: ev.ledgerClosedAt,
    topic: ev.topic,
    value: ev.value,
    inSuccessfulContractCall: ev.inSuccessfulContractCall,
  }));
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
