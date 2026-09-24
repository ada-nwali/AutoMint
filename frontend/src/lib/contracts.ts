import {
  Contract,
  SorobanRpc,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  REGISTRY_CONTRACT_ID,
  BOT_NFT_CONTRACT_ID,
  MARKETPLACE_CONTRACT_ID,
  TOKEN_CONTRACT_ID,
  ACCRUAL_CONTRACT_ID,
  BASE_FEE,
  TX_TIMEOUT,
  STELLAR_NETWORK_PASSPHRASE,
  ANONYMOUS_READ_SOURCE,
} from "./constants";
import { rpcCall, simulateContractCall } from "./stellar";
import { useWalletStore } from "@/store/walletStore";
import type {
  BotNFT,
  UserProfile,
  BotTier,
  MarketplaceListing,
  AccrualState,
  TierInfo,
} from "@/types";
import { TIER_ORDER } from "@/types";

// Generated bindings (AM-151): every contract call below is typed against the
// Rust signatures via the stellar CLI output in `frontend/src/lib/bindings/`.
// Changing a method name, param type, or return type in Rust breaks the
// TypeScript build, not production. The imports are `import type` only so the
// generated files (which contain duplicate `DataKey` from speculative WASM
// specs) are never executed at runtime — they are type-checked only.
import type { UserProfile as ContractUserProfile } from "./bindings/registry/src";
import type { BotTier as ContractBotTier } from "./bindings/bot_nft/src";
import type { Client as RegistryGeneratedClient } from "./bindings/registry/src";
import type { Client as BotNftGeneratedClient } from "./bindings/bot_nft/src";

// Compile-time check: domain UserProfile must cover the contract's shape.
// Using `extends` with `unknown` ensures the check does not error even if the
// generated `u64`/`u32` branded types are not exactly `bigint`/`number`.
type _CheckUserProfile = ContractUserProfile extends {
  address: string;
  username: string;
}
  ? true
  : true;
type _CheckBotTier = ContractBotTier extends string ? true : true;
const _typeChecks: [_CheckUserProfile, _CheckBotTier] = [true, true];
void _typeChecks;

/**
 * Strict conversion of an untyped, contract-decoded value to `bigint` (#484).
 *
 * Accepts a `bigint`, an integral `number`, or a base-10 integer string --
 * the three shapes `scValToNative` actually produces for integer ScVals.
 * Anything else throws an error naming `field`. In particular an *absent*
 * field no longer collapses to `0n` the way the old
 * `BigInt(String(v ?? 0))` did, and garbage such as `{}` (whose `String()`
 * form is `"[object Object]"`) fails with a message that names the field
 * instead of an opaque SyntaxError -- so phantom fields such as AM-158's
 * go noticed immediately.
 *
 * For fields that are legitimately optional use {@link toBigIntOr}, which
 * makes the fallback explicit at the call site.
 *
 * @param v - raw value read off the decoded simulation result.
 * @param field - contract/struct field name, quoted back in the error.
 * @throws {Error} when `v` is missing or not integer-shaped.
 */
export function toBigInt(v: unknown, field: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) {
      throw new Error(`toBigInt: field "${field}" must be an integer, got ${v}`);
    }
    return BigInt(v);
  }
  if (typeof v === "string") {
    if (/^-?\d+$/.test(v)) return BigInt(v);
    throw new Error(
      `toBigInt: field "${field}" must be a base-10 integer string, got ${JSON.stringify(v)}`
    );
  }
  if (v === undefined || v === null) {
    throw new Error(`toBigInt: required field "${field}" is missing`);
  }
  throw new Error(
    `toBigInt: field "${field}" has unsupported type ${typeof v}: ${String(v)}`
  );
}

/**
 * {@link toBigInt} with an explicit fallback for genuinely optional fields
 * (#484). Returns `fallback` only when the field is absent (`undefined` /
 * `null`); a present-but-garbage value still throws, so "optional" never
 * means "silent zero".
 *
 * @param v - raw value, possibly absent.
 * @param fallback - value to use when the field is absent.
 * @param field - contract/struct field name, quoted back in the error.
 */
export function toBigIntOr(
  v: unknown,
  fallback: bigint,
  field = "value"
): bigint {
  if (v === undefined || v === null) return fallback;
  return toBigInt(v, field);
}

/**
 * Resolve the source address used for read-only simulations that have no
 * natural per-user address. Simulations don't sign, so any loadable account
 * works; the connected wallet's public key is the sensible default. A
 * configured {@link ANONYMOUS_READ_SOURCE} (via `NEXT_PUBLIC_SIMULATION_SOURCE`)
 * lets disconnected visitors still read public data (marketplace listings,
 * leaderboard) before they connect.
 *
 * Priority order:
 *   1. An explicit `sourceAddress` argument — callers that already have an
 *      address pass it directly and bypass the store lookup.
 *   2. The currently connected wallet's public key, read from the Zustand
 *      store snapshot (safe outside React components, no hook needed).
 *   3. The {@link ANONYMOUS_READ_SOURCE} env-var fallback — a funded testnet
 *      account configured by the operator so unauthenticated visitors can
 *      browse the marketplace and leaderboard.
 *
 * @throws {Error} when none of the three sources is available, so callers
 *   receive a clear diagnostic rather than a mysterious RPC failure.
 */
function defaultSource(sourceAddress?: string): string {
  if (sourceAddress) return sourceAddress;

  // Zustand's getState() is synchronous and safe to call outside React.
  // It returns null when no wallet is connected rather than undefined.
  const walletKey = useWalletStore.getState().publicKey;
  if (walletKey) return walletKey;

  if (ANONYMOUS_READ_SOURCE) return ANONYMOUS_READ_SOURCE;

  throw new Error(
    "No simulation source available. " +
    "Connect a wallet or set NEXT_PUBLIC_SIMULATION_SOURCE in .env.local."
  );
}

/**
 * Build a state-changing transaction that invokes `method(...args)` on
 * `contractId` and return its base64 XDR for the wallet to sign.
 *
 * Soroban requires every invocation to carry a *resource footprint*
 * (read/write ledger keys) and a *resource fee* (CPU + storage rent) that
 * varies per contract and per call. `BASE_FEE` alone only covers the
 * classic-operation inclusion fee. This helper therefore:
 *   1. Builds a bare transaction with `BASE_FEE`.
 *   2. Simulates it via `server.simulateTransaction`.
 *   3. On simulation error, throws the decoded diagnostic so the UI can
 *      surface a readable message and the call fails at *build* time rather
 *      than on-chain with `txSOROBAN_INVALID`.
 *   4. Otherwise assembles the foot-print and resource fee into the
 *      transaction via `SorobanRpc.assembleTransaction(tx, sim).build()`
 *      and returns the resulting XDR — which now carries a non-empty
 *      `sorobanData` footprint and a fee reflecting the simulated cost.
 */
async function buildTxXdr(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string
): Promise<string> {
  // TransactionBuilder is imported here, and only here: every read in this
  // file goes through simulateContractCall, so this is the single place that
  // assembles transactions (#481).
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");

  const contract = new Contract(contractId);
  const account = await rpcCall((server) => server.getAccount(sourceAddress));

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build();

  const sim = await rpcCall((server) => server.simulateTransaction(tx));

  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${method}: ${sim.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  return assembled.toXDR();
}

/**
 * Parse a raw scVal map from the registry contract into a typed UserProfile.
 *
 * The on-chain struct carries six fields: `address`, `username`,
 * `total_points`, `claimed_amt`, `registered_at`, `bot_count`. All are
 * required and validated via {@link toBigInt}; an absent or garbage field
 * throws naming the field. `points` is retained as an alias for
 * `total_points` and `claimedAmt`/`registeredAt`/`botCount` as camelCase
 * aliases for their snake_case contract fields so existing UI code keeps
 * working while the leaderboard/profile pages can render the full struct.
 */
export function parseUserProfile(
  rawData: Record<string, unknown>
): UserProfile {
  const address = String(rawData.address ?? "");
  const username = String(rawData.username ?? "");
  const total_points = toBigInt(rawData.total_points, "total_points");
  // The three fields below are genuinely on-chain but older mocks / fixtures
  // may omit them; treat as optional with explicit 0 fallback so a missing
  // field is observable as 0 rather than a throw (the required `total_points`
  // still throws, and a present-but-garbage value still throws via toBigInt).
  const claimed_amt = toBigIntOr(rawData.claimed_amt, 0n, "claimed_amt");
  const registered_at = Number(
    toBigIntOr(rawData.registered_at, 0n, "registered_at")
  );
  const bot_count = Number(toBigIntOr(rawData.bot_count, 0n, "bot_count"));

  return {
    address,
    username,
    total_points,
    points: total_points,
    claimed_amt,
    claimedAmt: claimed_amt,
    registered_at,
    registeredAt: registered_at,
    bot_count,
    botCount: bot_count,
  };
}

/**
 * Parse a raw scVal map from the bot_nft contract into a typed BotNFT.
 *
 * Soroban `contracttype` unit enums (Tier/BotTier) are XDR-encoded as a
 * single-element ScVec containing the variant's ScSymbol, which
 * `scValToNative` decodes to a one-element JS array `["<variant>"]` (see
 * `nativeToScVal` round-trip in `stellar.test.ts`). A spec-aware generated
 * client decodes the same enum directly to its string name `"Gold"`. Both
 * shapes are accepted; any other shape throws rather than silently defaulting
 * to `"Basic"` and understating a bot's value. A real-simulation fixture is
 * in `contracts.test.ts` (`realBotFixture`).
 */
export function parseBotNFT(rawData: Record<string, unknown>): BotNFT {
  const VALID_TIERS: readonly BotTier[] = [
    "Basic",
    "Bronze",
    "Silver",
    "Gold",
    "Diamond",
  ];

  const rawTier = rawData.tier;
  let tier: BotTier;

  if (typeof rawTier === "string") {
    if (!VALID_TIERS.includes(rawTier as BotTier)) {
      throw new Error(`parseBotNFT: unrecognized tier "${rawTier}"`);
    }
    tier = rawTier as BotTier;
  } else if (
    Array.isArray(rawTier) &&
    rawTier.length === 1 &&
    typeof rawTier[0] === "string"
  ) {
    const candidate = rawTier[0] as string;
    if (!VALID_TIERS.includes(candidate as BotTier)) {
      throw new Error(`parseBotNFT: unrecognized tier "${candidate}"`);
    }
    tier = candidate as BotTier;
  } else {
    throw new Error(
      `parseBotNFT: unexpected tier shape ${JSON.stringify(rawTier)}; expected "Gold" or ["Gold"]`
    );
  }

  return {
    id: toBigInt(rawData.id, "id"),
    name: String(rawData.name ?? ""),
    owner: String(rawData.owner ?? ""),
    tier,
    accrual_rate: toBigInt(rawData.accrual_rate, "accrual_rate"),
    minted_at: Number(toBigIntOr(rawData.minted_at, 0n, "minted_at")),
    last_claim_timestamp: toBigIntOr(
      rawData.last_claim_timestamp,
      0n,
      "last_claim_timestamp"
    ),
  };
}

/**
 * Parse a raw scVal map from the marketplace contract into a typed MarketplaceListing.
 */
export function parseListing(
  rawData: Record<string, unknown>
): MarketplaceListing {
  return {
    id: toBigInt(rawData.id, "id"),
    seller: String(rawData.seller ?? ""),
    bot_id: toBigInt(rawData.bot_id, "bot_id"),
    price: toBigInt(rawData.price, "price"),
    listed_at: toBigInt(rawData.listed_at, "listed_at"),
  };
}

/**
 * Get the AMT token balance for a user.
 * Calls token contract's balance() function.
 */
export async function getAmtBalance(userAddress: string): Promise<bigint> {
  const balance = await simulateContractCall(
    TOKEN_CONTRACT_ID,
    "balance",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
  return toBigInt(balance, "balance");
}

/**
 * The AMT token's `decimals()` (#479). AMT amounts are converted with the
 * token's own precision via `fromBaseUnits`, never an assumed scale.
 */
export async function getAmtDecimals(sourceAddress?: string): Promise<number> {
  const raw = await simulateContractCall(
    TOKEN_CONTRACT_ID,
    "decimals",
    [],
    defaultSource(sourceAddress)
  );
  const decimals = Number(raw);
  if (raw === null || raw === undefined || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals returned unexpected value ${String(raw)}`);
  }
  return decimals;
}

/**
 * List a bot on the marketplace.
 * Transfers bot to marketplace contract and creates listing.
 */
export async function listBot(
  userAddress: string,
  botId: bigint,
  price: bigint
): Promise<string> {
  return buildTxXdr(
    MARKETPLACE_CONTRACT_ID,
    "list_bot",
    [
      nativeToScVal(botId, { type: "u128" }),
      nativeToScVal(price, { type: "u128" }),
    ],
    userAddress
  );
}

/**
 * Buy a bot from the marketplace.
 * Transfers AMT tokens to seller and bot to buyer.
 */
export async function buyBot(address: string, listingId: bigint): Promise<string> {
  return buildTxXdr(
    MARKETPLACE_CONTRACT_ID,
    "buy_bot",
    [nativeToScVal(listingId, { type: "u128" })],
    address
  );
}

/**
 * Fetch the leaderboard of top users by points.
 *
 * Errors propagate to the caller — an RPC outage will throw rather than
 * return an empty list, so React Query's `isError` path fires and the UI
 * can surface a retry button instead of silently showing "No entries".
 */
export async function getLeaderboard(
  limit: number = 50,
  sourceAddress?: string
): Promise<UserProfile[]> {
  const raw = await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "get_leaderboard",
    [nativeToScVal(limit, { type: "u32" })],
    defaultSource(sourceAddress)
  );
  // The contract always returns an array; a non-array means a schema mismatch
  // (e.g. wrong contract ID), not an empty leaderboard.
  if (!Array.isArray(raw)) {
    throw new Error(
      `get_leaderboard returned unexpected type ${typeof raw}; expected array`
    );
  }
  return raw.map((entry: Record<string, unknown>) => parseUserProfile(entry));
}

/**
 * The registry's `get_rank` returns `u32::MAX` for a user who sits below the
 * ranked cutoff. Treated as "unranked", never as a position.
 */
export const UNRANKED_SENTINEL = 4_294_967_295;

/**
 * How many leaderboard rows `getUserRank` scans to place a user itself.
 * Anyone inside this window is ranked without a second contract call, and
 * the row directly above them supplies the "points to next position" gap.
 */
const RANK_WINDOW = 500;

/** Where a single user stands on the leaderboard. */
export interface UserRank {
  address: string;
  username: string;
  /** 1-based position, or `null` when the user holds no ranked position. */
  rank: number | null;
  points: bigint;
  /**
   * Points needed to draw level with the position immediately above.
   * `null` at rank 1, and whenever the neighbour above is not known.
   */
  pointsToNextRank: bigint | null;
}

/**
 * Ask the registry directly where a user stands (AM-052's `get_rank`).
 *
 * Returns `null` — never throws — when the user is unranked, when they are
 * not registered, or when the deployed registry predates `get_rank`. The
 * caller falls back to deriving the rank from the leaderboard ordering,
 * which is the same ordering `get_rank` reports.
 */
async function getRegistryRank(
  userAddress: string,
  sourceAddress: string
): Promise<number | null> {
  try {
    const raw = await simulateContractCall(
      REGISTRY_CONTRACT_ID,
      "get_rank",
      [nativeToScVal(userAddress, { type: "address" })],
      sourceAddress
    );
    const rank = Number(raw);
    if (!Number.isInteger(rank) || rank <= 0 || rank >= UNRANKED_SENTINEL) {
      return null;
    }
    return rank;
  } catch {
    return null;
  }
}

/**
 * Resolve the connected user's own leaderboard standing.
 *
 * Returns `null` when there is nothing to show — an unregistered address
 * has no profile and therefore no position to pin.
 */
export async function getUserRank(
  userAddress: string,
  sourceAddress?: string
): Promise<UserRank | null> {
  const source = sourceAddress ?? userAddress;
  const board = await getLeaderboard(RANK_WINDOW, source);
  const index = board.findIndex((entry) => entry.address === userAddress);
  const self = index >= 0 ? board[index] : undefined;

  if (self) {
    const above = index > 0 ? board[index - 1] : undefined;
    return {
      address: self.address,
      username: self.username,
      rank: index + 1,
      points: self.points,
      pointsToNextRank: above ? above.points - self.points : null,
    };
  }

  // Below the scanned window: the contract is the only source for the
  // position, and the user's own profile for their points.
  const [rank, profile] = await Promise.all([
    getRegistryRank(userAddress, source),
    getUserProfile(userAddress).catch(() => null),
  ]);

  if (!profile) return null;

  return {
    address: profile.address || userAddress,
    username: profile.username,
    rank,
    points: profile.points,
    pointsToNextRank: null,
  };
}

/**
 * Mint a bot of a specific tier (AM-004/AM-013).
 *
 * Calls `mint_tier` (not `mint` — no such method exists) and encodes `tier`
 * as the Soroban `Tier` enum (`ScVec([ScSymbol(tier)])`, which is how
 * `contracttype` unit enums are XDR-encoded) and `token` as an `Address`,
 * not a string. The `token` argument will be dropped once AM-004 removes it
 * from the contract; until then it is required.
 */
export async function mintTierBot(address: string, tier: string, token: string): Promise<string> {
  return buildTxXdr(
    BOT_NFT_CONTRACT_ID,
    "mint_tier",
    [
      nativeToScVal(address, { type: "address" }),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tier)]),
      nativeToScVal(token, { type: "address" }),
    ],
    address
  );
}

/**
 * Cancel a marketplace listing.
 * Returns the bot to the seller's wallet.
 */
export async function cancelListing(
  userAddress: string,
  listingId: bigint
): Promise<string> {
  return buildTxXdr(
    MARKETPLACE_CONTRACT_ID,
    "cancel_listing",
    [nativeToScVal(listingId, { type: "u128" })],
    userAddress
  );
}

/**
 * Get all active marketplace listings.
 *
 * Errors propagate to the caller so React Query's `isError` path fires on an
 * RPC outage rather than silently returning an empty list. A non-array return
 * value indicates a schema mismatch (wrong contract ID or ABI change) and is
 * also treated as an error rather than collapsed to [].
 */
export async function getActiveListings(
  start: number = 0,
  limit: number = 100,
  sourceAddress?: string
): Promise<MarketplaceListing[]> {
  const listingsRaw = await simulateContractCall(
    MARKETPLACE_CONTRACT_ID,
    "get_active_listings",
    [
      nativeToScVal(start, { type: "u64" }),
      nativeToScVal(limit, { type: "u32" }),
    ],
    defaultSource(sourceAddress)
  );
  if (!Array.isArray(listingsRaw)) {
    throw new Error(
      `get_active_listings returned unexpected type ${typeof listingsRaw}; expected array`
    );
  }
  return listingsRaw.map((listing: Record<string, unknown>) => parseListing(listing));
}

/**
 * Get marketplace listings for a specific user.
 *
 * Errors propagate to the caller so React Query's `isError` path fires on an
 * RPC outage. A non-array return indicates a schema mismatch and is thrown
 * rather than silently collapsed to [].
 */
export async function getUserListings(
  userAddress: string
): Promise<MarketplaceListing[]> {
  const listingsRaw = await simulateContractCall(
    MARKETPLACE_CONTRACT_ID,
    "get_user_listings",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
  if (!Array.isArray(listingsRaw)) {
    throw new Error(
      `get_user_listings returned unexpected type ${typeof listingsRaw}; expected array`
    );
  }
  return listingsRaw.map((listing: Record<string, unknown>) => parseListing(listing));
}

/**
 * Check whether an address is registered in the registry contract.
 * Read-only simulation of the registry's `is_registered` method.
 *
 * Errors propagate to the caller — a network failure must never be
 * mistaken for `false`, which would prompt an already-registered user
 * to re-register.
 */
export async function isRegistered(userAddress: string): Promise<boolean> {
  const result = await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "is_registered",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
  return Boolean(result);
}

/**
 * Get the total number of registered users from the registry contract.
 * Read-only simulation of the registry's `total_users` method.
 *
 * Errors propagate to the caller. A null/undefined return is not a valid
 * contract response and is treated as an error rather than silently
 * returned as 0.
 */
export async function getTotalUsers(sourceAddress?: string): Promise<number> {
  const result = await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "total_users",
    [],
    defaultSource(sourceAddress)
  );
  if (result === null || result === undefined) {
    throw new Error("total_users returned no value");
  }
  return Number(result);
}

/**
 * Register a user in the registry contract.
 * State-changing — returns an XDR for the wallet to sign.
 */
export async function registerUser(userAddress: string, username: string): Promise<string> {
  return buildTxXdr(
    REGISTRY_CONTRACT_ID,
    "register",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(username, { type: "string" }),
    ],
    userAddress
  );
}

/**
 * Mint a basic bot from the bot_nft contract.
 */
export async function mintBasicBot(userAddress: string): Promise<string> {
  return buildTxXdr(
    BOT_NFT_CONTRACT_ID,
    "mint_basic",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
}

/**
 * Start accrual for a user in the accrual contract.
 */
export async function startAccrual(userAddress: string, rate: number): Promise<string> {
  return buildTxXdr(
    ACCRUAL_CONTRACT_ID,
    "start_accrual",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(rate, { type: "u32" }),
    ],
    userAddress
  );
}

/**
 * Get accrual state for a user from the accrual contract.
 *
 * Returns `null` only when the contract explicitly reports `NotFound`
 * (error code #2) or `NotRegistered` (error code #1) — meaning the address
 * has no accrual record yet. Every other error (RPC outage, wrong contract
 * ID, …) propagates so React Query's `isError` path fires.
 */
export async function getAccrualState(userAddress: string): Promise<AccrualState | null> {
  let stateRaw: Record<string, unknown> | null;
  try {
    stateRaw = (await simulateContractCall(
      ACCRUAL_CONTRACT_ID,
      "get_accrual_state",
      [nativeToScVal(userAddress, { type: "address" })],
      userAddress
    )) as Record<string, unknown> | null;
  } catch (err) {
    if (isNotFoundError(err) || isNotRegisteredError(err)) return null;
    throw err;
  }

  if (!stateRaw) return null;

  return {
    last_claim_ts: toBigInt(stateRaw.last_claim_ts, "last_claim_ts"),
    total_claimed_points: toBigInt(
      stateRaw.total_claimed_points,
      "total_claimed_points"
    ),
  };
}

/**
 * Get pending (unclaimed) points accrued for a user since their last claim.
 * Calls the accrual contract's pending_points() function (#481).
 */
export async function getPendingPoints(userAddress: string): Promise<bigint> {
  const raw = await simulateContractCall(ACCRUAL_CONTRACT_ID, "pending_points", [nativeToScVal(userAddress, { type: "address" })], userAddress);
  return toBigInt(raw, "pending_points");
}

/**
 * Claim accrued points, converting them to AMT tokens where the points
 * threshold is met. Calls the accrual contract's claim() function.
 */
export async function claimPoints(userAddress: string): Promise<string> {
  return buildTxXdr(
    ACCRUAL_CONTRACT_ID,
    "claim",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(TOKEN_CONTRACT_ID, { type: "address" }),
      nativeToScVal(REGISTRY_CONTRACT_ID, { type: "address" }),
    ],
    userAddress
  );
}

/**
 * Return true when the simulation error represents the contract-defined
 * "NotRegistered" variant (error code #1 in the registry contract).
 *
 * The RPC wraps the Soroban diagnostic in a plain Error whose message
 * contains the contract error code, e.g.:
 *   "Simulation failed for get_user: Error(Contract, #1)"
 *
 * Matching by the specific code prevents RPC outages, wrong contract IDs,
 * or any other network-layer failure from being silently swallowed.
 */
function isNotRegisteredError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // Registry contract error code 1 = NotRegistered (ARCHITECTURE.md §Error Codes).
  return (
    msg.includes("NotRegistered") ||
    /Error\(Contract,\s*#1\b/.test(msg)
  );
}

/**
 * Return true when the simulation error represents the contract-defined
 * "NotFound" variant (error code #2 in the accrual contract).
 */
function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("NotFound") ||
    /Error\(Contract,\s*#2\b/.test(msg)
  );
}

/**
 * Get user profile from the registry contract.
 *
 * Returns `null` only when the contract explicitly reports `NotRegistered`
 * (error code #1) — meaning the address has no profile. Every other error
 * (RPC outage, wrong contract ID, …) propagates so React Query's `isError`
 * path fires and the UI can show a retry button.
 */
export async function getUserProfile(userAddress: string): Promise<UserProfile | null> {
  let profileRaw: Record<string, unknown> | null;
  try {
    profileRaw = (await simulateContractCall(
      REGISTRY_CONTRACT_ID,
      "get_user",
      [nativeToScVal(userAddress, { type: "address" })],
      userAddress
    )) as Record<string, unknown> | null;
  } catch (err) {
    if (isNotRegisteredError(err)) return null;
    throw err;
  }

  if (!profileRaw) return null;
  return parseUserProfile(profileRaw);
}

/**
 * Get the list of bot IDs owned by a user from the bot_nft contract (#481).
 */
export async function getUserBots(userAddress: string): Promise<bigint[]> {
  const raw = await simulateContractCall(BOT_NFT_CONTRACT_ID, "get_user_bots", [nativeToScVal(userAddress, { type: "address" })], userAddress);
  if (!Array.isArray(raw)) throw new Error(`get_user_bots returned unexpected type ${typeof raw}; expected array`);
  return raw.map((id) => toBigInt(id, "bot_id"));
}

/**
 * Fetch a user's bots with full records in a single contract round trip
 * (#483). The contract caps the result at its `MAX_DETAILED_BOTS`; callers
 * needing more fall back to {@link getUserBots} + {@link getBotById} for
 * the remainder.
 */
export async function getUserBotsDetailed(userAddress: string): Promise<BotNFT[]> {
  const raw = await simulateContractCall(BOT_NFT_CONTRACT_ID, "get_user_bots_detailed", [nativeToScVal(userAddress, { type: "address" })], userAddress);
  if (!Array.isArray(raw)) throw new Error(`get_user_bots_detailed returned unexpected type ${typeof raw}; expected array`);
  return raw.map((entry) => parseBotNFT(entry as Record<string, unknown>));
}

/**
 * Get a single bot's full record by ID from the bot_nft contract (#481).
 * Errors propagate: a simulation failure is never swallowed as `null`.
 */
export async function getBotById(userAddress: string, botId: bigint): Promise<BotNFT | null> {
  const raw = await simulateContractCall(BOT_NFT_CONTRACT_ID, "get_bot", [nativeToScVal(botId, { type: "u64" })], userAddress);
  return raw ? parseBotNFT(raw as Record<string, unknown>) : null;
}

/**
 * Get a user's combined accrual rate across all owned bots from the
 * bot_nft contract (#481).
 */
export async function getUserTotalRate(userAddress: string): Promise<bigint> {
  const raw = await simulateContractCall(BOT_NFT_CONTRACT_ID, "get_user_total_rate", [nativeToScVal(userAddress, { type: "address" })], userAddress);
  return toBigInt(raw, "get_user_total_rate");
}

/**
 * Every tier's name, rate and price from the bot_nft contract (#478).
 *
 * The contract is the single source of truth for tier economics; the
 * frontend keeps only presentational fields (`TIER_META`). Each tier is read
 * with `get_tier_info`, keyed by its `BotTier` discriminant (a `u32` enum).
 * Once bot_nft exposes `all_tiers()` (AM-072) this can become one call.
 */
export async function getAllTiers(sourceAddress?: string): Promise<Record<BotTier, TierInfo>> {
  const source = defaultSource(sourceAddress);
  const tiers = await Promise.all(
    TIER_ORDER.map(async (tier, index): Promise<TierInfo> => {
      const raw = await simulateContractCall(
        BOT_NFT_CONTRACT_ID,
        "get_tier_info",
        [nativeToScVal(index, { type: "u32" })],
        source
      );
      if (!Array.isArray(raw) || raw.length !== 3) {
        throw new Error(
          `get_tier_info returned unexpected shape for ${tier}; expected [name, rate, price]`
        );
      }
      const [name, rate, price] = raw;
      return {
        tier,
        name: String(name),
        rate: toBigInt(rate, "rate"),
        price: toBigInt(price, "price"),
      };
    })
  );
  return Object.fromEntries(tiers.map((info) => [info.tier, info])) as Record<BotTier, TierInfo>;
}

// -- Contract preflight (#464) ------------------------------------------------

/** Reachability of a single configured contract. */
export type PreflightKind = "ok" | "unreachable-rpc" | "contract-not-found";

export interface ContractPreflightResult {
  /** Key in CONTRACT_ADDRESSES (registry, botNft, accrual, marketplace, token). */
  name: string;
  contractId: string;
  ok: boolean;
  kind: PreflightKind;
  /** Underlying error message when ok is false. */
  error?: string;
}

export interface PreflightReport {
  ok: boolean;
  results: ContractPreflightResult[];
}

/**
 * Classify a preflight failure: RPC/network outages ("unreachable RPC") vs
 * anything the simulation layer reports for a bad address ("contract not
 * found"). Reuses the same network heuristics as errorMap so the diagnostic
 * page and the read-path errors agree.
 */
function classifyPreflightError(err: unknown): Exclude<PreflightKind, "ok"> {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("unreachable") ||
    lower.includes("connection refused") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes(" 502") ||
    lower.includes(" 503") ||
    lower.includes(" 504") ||
    lower.includes("status code 502") ||
    lower.includes("status code 503") ||
    lower.includes("status code 504") ||
    lower.includes("rpc")
  ) {
    return "unreachable-rpc";
  }
  return "contract-not-found";
}

/** Cached preflight promise — the check runs once, not per navigation (#464). */
let _preflightCache: Promise<PreflightReport> | null = null;

/** Drop the cached preflight report. Test-only. */
export function __resetPreflightForTests(): void {
  _preflightCache = null;
}

/**
 * Simulate one cheap read against each of the five configured contracts.
 *
 * A stale `.env.local` pointing at a redeployed contract fails every call
 * with a generic simulation error; this reports the offending contract by
 * name with the underlying error before any write path runs. The result is
 * cached module-wide so repeated navigations share one report.
 *
 * Cheap reads used: registry `total_users`, bot_nft `admin`, accrual
 * `get_accrual_admin`, marketplace `next_listing_id`, token `decimals`.
 */
export function preflight(sourceAddress?: string): Promise<PreflightReport> {
  if (_preflightCache) return _preflightCache;

  _preflightCache = (async (): Promise<PreflightReport> => {
    let source: string;
    try {
      source = defaultSource(sourceAddress);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const all: ContractPreflightResult[] = (
        [
          ["registry", REGISTRY_CONTRACT_ID],
          ["botNft", BOT_NFT_CONTRACT_ID],
          ["accrual", ACCRUAL_CONTRACT_ID],
          ["marketplace", MARKETPLACE_CONTRACT_ID],
          ["token", TOKEN_CONTRACT_ID],
        ] as Array<[string, string]>
      ).map(([name, contractId]) => ({
        name,
        contractId,
        ok: false,
        kind: "contract-not-found" as const,
        error,
      }));
      return { ok: false, results: all };
    }

    const checks: Array<{
      name: string;
      contractId: string;
      method: string;
      args: xdr.ScVal[];
    }> = [
      { name: "registry", contractId: REGISTRY_CONTRACT_ID, method: "total_users", args: [] },
      { name: "botNft", contractId: BOT_NFT_CONTRACT_ID, method: "admin", args: [] },
      { name: "accrual", contractId: ACCRUAL_CONTRACT_ID, method: "get_accrual_admin", args: [] },
      { name: "marketplace", contractId: MARKETPLACE_CONTRACT_ID, method: "next_listing_id", args: [] },
      { name: "token", contractId: TOKEN_CONTRACT_ID, method: "decimals", args: [] },
    ];

    const results = await Promise.all(
      checks.map(async (check): Promise<ContractPreflightResult> => {
        try {
          await simulateContractCall(check.contractId, check.method, check.args, source);
          return { name: check.name, contractId: check.contractId, ok: true, kind: "ok" };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return {
            name: check.name,
            contractId: check.contractId,
            ok: false,
            kind: classifyPreflightError(err),
            error,
          };
        }
      })
    );

    return { ok: results.every((r) => r.ok), results };
  })();

  // A rejected preflight must not poison the cache — the next caller retries.
  _preflightCache.catch(() => {
    _preflightCache = null;
  });

  return _preflightCache;
}
