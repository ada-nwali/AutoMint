/**
 * Application-wide constants derived from environment variables.
 *
 * All NEXT_PUBLIC_* vars are inlined at build time by Next.js.
 * Non-public vars are only accessible server-side.
 */
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Soroban RPC endpoints used for transaction simulation and submission.
 *
 * `NEXT_PUBLIC_SOROBAN_RPC_URL` accepts a comma-separated list so the app
 * can fail over between endpoints (#454):
 *
 *   NEXT_PUBLIC_SOROBAN_RPC_URL="https://soroban-testnet.stellar.org,https://backup.example.com"
 *
 * Whitespace around each entry is trimmed and empty entries are dropped;
 * when nothing usable remains the public testnet default is used.
 */
const DEFAULT_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const parsedRpcUrls = (
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? DEFAULT_SOROBAN_RPC_URL
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

export const SOROBAN_RPC_URLS: string[] =
  parsedRpcUrls.length > 0 ? parsedRpcUrls : [DEFAULT_SOROBAN_RPC_URL];

/** Primary Soroban RPC endpoint — the first entry of {@link SOROBAN_RPC_URLS}. */
export const SOROBAN_RPC_URL: string =
  SOROBAN_RPC_URLS[0] ?? DEFAULT_SOROBAN_RPC_URL;

/**
 * Number of consecutive retryable failures against the active endpoint
 * before the client fails over to the next entry in
 * {@link SOROBAN_RPC_URLS} (#454). Defaults to 3; configure via
 * `NEXT_PUBLIC_RPC_FAILOVER_AFTER`.
 */
export const RPC_FAILOVER_AFTER =
  Number(process.env.NEXT_PUBLIC_RPC_FAILOVER_AFTER) || 3;

/** Stellar network passphrase used when signing transactions. */
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

/** Alias kept for backward compatibility. */
export const STELLAR_NETWORK_PASSPHRASE = NETWORK_PASSPHRASE;

/** Human-readable network label, e.g. "TESTNET". */
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? "TESTNET";

/**
 * Public key used as the simulation source for read-only contract calls when
 * no wallet is connected — an anonymous visitor browsing the marketplace or
 * leaderboard still sees active listings and rankings. Must be a real, funded
 * account on the configured network; it is never used to sign or submit a
 * transaction.
 *
 * Configured via {@link NEXT_PUBLIC_SIMULATION_SOURCE} in `.env.local`.
 */
export const ANONYMOUS_READ_SOURCE =
  process.env.NEXT_PUBLIC_SIMULATION_SOURCE ?? "";

/** Horizon URL for account/transaction queries. */
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

/** Contract IDs */
export const REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX01";

export const BOT_NFT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX02";

export const ACCRUAL_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX03";

export const MARKETPLACE_CONTRACT_ID =
  process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX04";

export const TOKEN_CONTRACT_ID =
  process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX05";

export const CONTRACT_ADDRESSES = {
  registry: REGISTRY_CONTRACT_ID,
  botNft: BOT_NFT_CONTRACT_ID,
  accrual: ACCRUAL_CONTRACT_ID,
  marketplace: MARKETPLACE_CONTRACT_ID,
  token: TOKEN_CONTRACT_ID,
} as const;

/** Transaction tunables */
export const TX_TIMEOUT = Number(process.env.NEXT_PUBLIC_TX_TIMEOUT) || 30;
export const BASE_FEE = process.env.NEXT_PUBLIC_BASE_FEE ?? "100";

/** Points-to-AMT conversion threshold. */
export const POINTS_PER_AMT = Number(process.env.NEXT_PUBLIC_POINTS_PER_AMT) || 1000;

/** Leaderboard pagination limit. */
export const LEADERBOARD_LIMIT = Number(process.env.NEXT_PUBLIC_LEADERBOARD_LIMIT) || 50;

/** Polling interval when waiting for a transaction to complete (ms). */
export const POLL_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS) || 1000;

/** Tick interval used by the accrual counter (ms). */
export const COUNTER_TICK_MS = Number(process.env.NEXT_PUBLIC_COUNTER_TICK_MS) || 1000;

/**
 * Validate required environment at boot (#463).
 *
 * Every contract ID must be 56 characters starting with `C` and pass the
 * StrKey checksum; the RPC URL must parse; the passphrase must be non-empty.
 * Returns the list of problems (empty when valid) so the module can throw a
 * single aggregated, human-readable error naming every missing or malformed
 * variable. Runs in both server and client bundles because this module is
 * imported by both.
 *
 * @param env - env source to validate (defaults to `process.env`).
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];

  const ids: Array<[string, string | undefined]> = [
    ["NEXT_PUBLIC_REGISTRY_CONTRACT_ID", env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ?? REGISTRY_CONTRACT_ID],
    ["NEXT_PUBLIC_BOT_NFT_CONTRACT_ID", env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID ?? BOT_NFT_CONTRACT_ID],
    ["NEXT_PUBLIC_ACCRUAL_CONTRACT_ID", env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID ?? ACCRUAL_CONTRACT_ID],
    ["NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID", env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID ?? MARKETPLACE_CONTRACT_ID],
    ["NEXT_PUBLIC_TOKEN_CONTRACT_ID", env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? TOKEN_CONTRACT_ID],
  ];

  for (const [name, value] of ids) {
    if (!value || !value.trim()) {
      problems.push(`${name} is missing or empty — set it in .env.local`);
      continue;
    }
    const id = value.trim();
    if (id.length !== 56 || !id.startsWith("C")) {
      problems.push(
        `${name} is malformed (expected 56 characters starting with "C", got ${id.length} characters) — set a real contract ID in .env.local`
      );
      continue;
    }
    try {
      if (!StrKey.isValidContract(id)) {
        problems.push(`${name} failed StrKey checksum validation — check for a typo in .env.local`);
      }
    } catch {
      problems.push(`${name} failed StrKey checksum validation — check for a typo in .env.local`);
    }
  }

  const rawRpc = env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? SOROBAN_RPC_URL;
  const rpcUrls = rawRpc
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (rpcUrls.length === 0) {
    problems.push("NEXT_PUBLIC_SOROBAN_RPC_URL is missing or empty — set it in .env.local");
  } else {
    for (const url of rpcUrls) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          problems.push(
            `NEXT_PUBLIC_SOROBAN_RPC_URL entry "${url}" must use http(s) — got protocol "${parsed.protocol}"`
          );
        }
      } catch {
        problems.push(
          `NEXT_PUBLIC_SOROBAN_RPC_URL entry "${url}" is not a valid URL — set it in .env.local`
        );
      }
    }
  }

  const passphrase = env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? NETWORK_PASSPHRASE;
  if (!passphrase || !passphrase.trim()) {
    problems.push("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE is missing or empty — set it in .env.local");
  }

  return problems;
}

const _envProblems = validateEnv();
// Unit tests load this module with placeholder IDs (see constants.test.ts);
// never throw inside Jest — tests exercise validateEnv() directly instead.
const _skipEnvThrow =
  typeof process !== "undefined" &&
  (!!process.env.JEST_WORKER_ID || process.env.NODE_ENV === "test");
if (_envProblems.length > 0 && !_skipEnvThrow) {
  throw new Error(
    `Invalid environment configuration:\n${_envProblems.map((p) => `- ${p}`).join("\n")}`
  );
}
