/**
 * Shared types for the AutoMint indexer.
 *
 * The indexer streams Soroban contract events for the five AutoMint contracts
 * (registry, bot_nft, accrual, marketplace, token) and stores them in SQLite.
 * Event schemas are documented in `docs/EVENTS.md`.
 */

export const CONTRACT_NAMES = [
  "registry",
  "bot_nft",
  "accrual",
  "marketplace",
  "token",
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

/** Canonical AutoMint event names per contract — the ground-truth inventory
 * taken from the actual `env.events().publish(...)` calls in the contract
 * source (see docs/EVENTS.md for the full schema). */
export const EVENT_NAMES = [
  "register",
  "addpoints",
  "dec_bot",
  "mint",
  "transfer",
  "start",
  "claim",
  "listed",
  "cancelled",
  "bought",
  "approve",
  "burn",
  "set_admin",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Contract ID + display-name resolution. Loaded from the deployment manifest
 * (`deployments/<network>.json`, #557/#559) or from explicit env vars. */
export interface ContractConfig {
  network: string;
  contracts: Record<ContractName, string>;
  /** git SHA the deployment was recorded against (manifest only). */
  gitSha?: string;
}

/** A raw event as returned by the Soroban RPC `getEvents` endpoint. */
export interface RawEvent {
  /** Stable, unique event id (RPC paging token): "<ledger>-<idx>-<idx>". */
  id: string;
  contractId: string;
  contract: ContractName;
  ledger: number;
  txHash: string;
  eventIndex: number;
  /** ISO-8601 ledger close time, e.g. "2024-01-01T00:00:00Z". */
  ledgerClosedAt: string | null;
  /** Decoded topics: `xdr.ScVal[]` from the SDK (base64 strings in tests). */
  topic: unknown[];
  /** Decoded payload: `xdr.ScVal` from the SDK (base64 string in tests). */
  value: unknown;
  inSuccessfulContractCall: boolean;
}

/** A decoded, normalized AutoMint event ready to persist. */
export interface DecodedEvent {
  id: string;
  contractId: string;
  contract: ContractName;
  /** Event name (first topic symbol), e.g. "register". */
  event: EventName | string;
  /** Remaining topics after the event name, converted to native JS values. */
  topics: unknown[];
  /** Decoded event payload. i128/u128 values are represented as decimal
   * strings so no precision is lost across JSON/SQLite boundaries. */
  data: unknown;
  ledger: number;
  txHash: string;
  eventIndex: number;
  ledgerClosedAt: string | null;
  inSuccessfulContractCall: boolean;
}

/** Row shape stored in the `events` table. */
export interface EventRow {
  id: string;
  contract_id: string;
  contract: string;
  event: string;
  ledger: number;
  tx_hash: string;
  event_index: number;
  ledger_closed_at: string | null;
  topics_json: string;
  data_json: string;
  recorded_at: string;
}

/** Shape returned by the aggregate API. */
export interface Summary {
  users: number;
  total_claims: number;
  total_mints: number;
  amt_minted: string;
  volume: string;
  floor_price: string | null;
  active_listings: number;
  latest_ledger: number;
  last_indexed_at: string | null;
}

export interface DailyRow {
  day: string;
  claims: number;
  amt_minted: string;
  volume: string;
}
