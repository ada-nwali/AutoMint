/**
 * Polling loop for the AutoMint indexer.
 *
 * Each iteration:
 *   1. reads the persisted checkpoint (last fully-processed ledger),
 *   2. fetches events from `checkpoint + 1` (or the configured start ledger on
 *      a cold start) via the RPC client, with cursor-based pagination,
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
  /** Ledger to start from when there is no checkpoint yet. */
  defaultStartLedger?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface PollResult {
  fetched: number;
  inserted: number;
  skipped: number;
  latestLedger: number;
}

export class Poller {
  private readonly rpc: RpcClient;
  private readonly db: IndexerDb;
  private readonly config: ContractConfig;
  private readonly defaultStartLedger: number;
  private readonly log: (message: string, meta?: Record<string, unknown>) => void;

  constructor(opts: PollerOptions) {
    this.rpc = opts.rpc;
    this.db = opts.db;
    this.config = opts.config;
    this.defaultStartLedger = opts.defaultStartLedger ?? 0;
    this.log = opts.log ?? ((message) => console.log(`[poller] ${message}`));
  }

  /** How far behind the chain head we are (best-effort; 0 when idle). */
  async currentCheckpoint(): Promise<number> {
    return this.db.getCheckpoint() ?? this.defaultStartLedger;
  }

  /**
   * Run one poll cycle. Throws on RPC failure (caller decides whether to
   * retry/sleep); returns counts for observability.
   */
  async pollOnce(): Promise<PollResult> {
    const checkpoint = await this.currentCheckpoint();
    const startLedger = checkpoint === 0 ? this.defaultStartLedger : checkpoint + 1;

    const contractIds = Object.values(this.config.contracts);
    this.log("polling", {
      startLedger,
      latestCheckpoint: checkpoint,
      contracts: contractIds.length,
    });

    const { events, latestLedger } = await this.rpc.getEvents({
      startLedger,
      contractIds,
    });

    const decoder = makeDecoder(this.config);
    const decoded: DecodedEvent[] = [];
    let skipped = 0;

    for (const raw of toRawEvents(events)) {
      if (raw.inSuccessfulContractCall === false) {
        skipped += 1; // events from reverted/failed calls must not be counted
        continue;
      }
      try {
        decoded.push(decoder.decode(raw));
      } catch (error) {
        if (error instanceof DecodeError) {
          skipped += 1;
          this.log(`skipping undecodable event ${raw.id}`, {
            error: error.message,
          });
        } else {
          throw error;
        }
      }
    }

    const inserted = this.db.insertEvents(decoded);
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

  /**
   * Run the polling loop until `signal` is aborted. Sleeps `intervalMs`
   * between iterations; a failed iteration is logged and the loop continues
   * (the retry wrapper inside the RPC client already absorbs transient RPC
   * errors).
   */
  async run(intervalMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.pollOnce();
      } catch (error) {
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
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
