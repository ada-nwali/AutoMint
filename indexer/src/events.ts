/**
 * Soroban event decoding for the AutoMint contracts.
 *
 * Each contract publishes events with `env.events().publish(topics, data)`.
 * Soroban RPC returns each event's `topic` and `value` as base64-encoded XDR
 * `ScVal`s. This module converts them into native JS values and normalizes the
 * result into a `DecodedEvent` that the indexer can persist.
 *
 * i128/u128 ScVals decode to JS `bigint`. JSON.stringify would throw on those,
 * so every bigint is converted to a decimal string during normalization — this
 * also keeps full precision across the JSON/SQLite boundary.
 *
 * The full, per-contract event schema this module depends on is documented in
 * `docs/EVENTS.md`. That file is the contract between the indexer and the
 * on-chain code; if a contract's event shape changes, EVENTS.md and the tests
 * in `src/__tests__/decode.test.ts` must change together.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ContractConfig, ContractName, DecodedEvent, RawEvent } from "./types.js";
import { CONTRACT_NAMES } from "./types.js";

/** Decode an `xdr.ScVal` (or a base64 XDR string) into a native JS value. */
export function decodeScVal(value: unknown): unknown {
  let scval: xdr.ScVal;
  if (value instanceof xdr.ScVal) {
    scval = value;
  } else if (typeof value === "string") {
    scval = xdr.ScVal.fromXDR(Buffer.from(value, "base64"));
  } else {
    throw new DecodeError(`unsupported ScVal representation: ${typeof value}`);
  }
  return scValToNative(scval);
}

/** JSON.stringify helper: bigint → decimal string, everything else native. */
export function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    typeof val === "bigint" ? val.toString() : val,
  );
}

/** JSON.parse paired with jsonStringify (decoded values may hold bigint). */
export function jsonParse(text: string): unknown {
  return JSON.parse(text);
}

/** Normalize a scalar that may be number | bigint | string into a decimal string. */
export function toDecimal(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(0);
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value ?? "0");
}

/** Normalize to a non-negative safe integer (for u32/u64 counts/ids). */
export function toNum(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0);
}

/** Does a decoded first topic look like a symbol/string event name? */
function isEventName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Decode a raw RPC event into a normalized AutoMint event.
 *
 * Throws `DecodeError` when the topics don't start with a symbol (i.e. it is
 * not one of the contract's own `publish` events) or when the XDR is
 * malformed — the caller decides whether to skip or dead-letter.
 */
export class DecodeError extends Error {}

/** Build a stable unique event id from ledger + tx hash + index within tx. */
export function eventId(
  ledger: number,
  txHash: string,
  eventIndex: number,
): string {
  return `${ledger}-${txHash}-${eventIndex}`;
}

export function decodeRawEvent(
  raw: RawEvent,
): DecodedEvent {
  let topics: unknown[];
  let data: unknown;
  try {
    topics = raw.topic.map((t) => decodeScVal(t));
    data = decodeScVal(raw.value);
  } catch (error) {
    throw new DecodeError(
      `failed to decode XDR for ${raw.id}: ${(error as Error).message}`,
    );
  }

  const [head, ...rest] = topics;
  if (!isEventName(head)) {
    throw new DecodeError(
      `event ${raw.id} has no symbol first topic (got ${typeof head})`,
    );
  }

  return {
    id: raw.id,
    contractId: raw.contractId,
    contract: raw.contract,
    event: head,
    topics: rest,
    data,
    ledger: raw.ledger,
    txHash: raw.txHash,
    eventIndex: raw.eventIndex,
    ledgerClosedAt: raw.ledgerClosedAt,
    inSuccessfulContractCall: raw.inSuccessfulContractCall,
  };
}

/** Map a contract address to its AutoMint name, else "unknown". */
export function contractNameFor(
  contractId: string,
  contractIds: Record<ContractName, string>,
): ContractName | "unknown" {
  const upper = contractId.toUpperCase();
  for (const name of CONTRACT_NAMES) {
    if (contractIds[name].toUpperCase() === upper) return name;
  }
  return "unknown";
}

export function makeDecoder(config: ContractConfig) {
  return {
    decode(raw: RawEvent): DecodedEvent {
      const contract = contractNameFor(raw.contractId, config.contracts);
      if (contract === "unknown") {
        throw new DecodeError(
          `event ${raw.id} from unknown contract ${raw.contractId} (not in config)`,
        );
      }
      return decodeRawEvent({ ...raw, contract });
    },
  };
}
