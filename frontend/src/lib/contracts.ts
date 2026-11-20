import { Contract, rpc, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  CONTRACT_ADDRESSES,
  type ContractName,
  BASE_FEE,
  TX_TIMEOUT,
  STELLAR_NETWORK_PASSPHRASE,
  ANONYMOUS_READ_SOURCE,
} from "./constants";
import { rpcCall, simulateContractCall, addressToScVal, u64ToScVal, i128ToScVal } from "./stellar";
import { useWalletStore } from "@/store/walletStore";
import type {
  BotNFT,
  UserProfile,
  BotTier,
  MarketplaceListing,
  AccrualState,
  TierStats,
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

// Compile-time check: domain UserProfile must cover the contract's shape.
// Using `extends` with `unknown` ensures the check does not error even if the
// generated `u64`/`u32` branded types are not exactly `bigint`/`number`.
// Each check fails to compile if the generated binding drifts from the domain shape.
const _checkUserProfile: { address: string; username: string } = {} as ContractUserProfile;
const _checkBotTier: ContractBotTier = {} as ContractBotTier;
void _checkUserProfile;
void _checkBotTier;

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
      `toBigInt: field "${field}" must be a base-10 integer string, got ${JSON.stringify(v)}`,
    );
  }
  if (v === undefined || v === null) {
    throw new Error(`toBigInt: required field "${field}" is missing`);
  }
  throw new Error(`toBigInt: field "${field}" has unsupported type ${typeof v}: ${String(v)}`);
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
export function toBigIntOr(v: unknown, fallback: bigint, field = "value"): bigint {
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
      "Connect a wallet or set NEXT_PUBLIC_SIMULATION_SOURCE in .env.local.",
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
 *      transaction via `rpc.assembleTransaction(tx, sim).build()`
 *      and returns the resulting XDR — which now carries a non-empty
 *      `sorobanData` footprint and a fee reflecting the simulated cost.
 */
async function buildTxXdr(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
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

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${method}: ${sim.error}`);
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  return assembled.toXDR();
}

/**
 * Parse a raw scVal map from the registry contract into a typed UserProfile.
 *
 * The on-chain struct carries `address`, `username`, `display_name`,
 * `total_points`, `claimed_amt`, `registered_at`, `bot_count`. The numeric
 * fields are validated via {@link toBigInt}; an absent or garbage field
 * throws naming the field. `points` is retained as an alias for
 * `total_points` and `claimedAmt`/`registeredAt`/`botCount` as camelCase
 * aliases for their snake_case contract fields so existing UI code keeps
 * working while the leaderboard/profile pages can render the full struct.
 *
 * `display_name` (#373) preserves the casing the user registered with;
 * profiles recorded before #373 (and older mocks) omit it, so it falls back
 * to the normalized `username` rather than throwing.
 */
export function parseUserProfile(rawData: Record<string, unknown>): UserProfile {
  const address = String(rawData.address ?? "");
  const username = String(rawData.username ?? "");
  const display_name = String(rawData.display_name || username);
  const total_points = toBigInt(rawData.total_points, "total_points");
  // The three fields below are genuinely on-chain but older mocks / fixtures
  // may omit them; treat as optional with explicit 0 fallback so a missing
  // field is observable as 0 rather than a throw (the required `total_points`
  // still throws, and a present-but-garbage value still throws via toBigInt).
  const claimed_amt = toBigIntOr(rawData.claimed_amt, 0n, "claimed_amt");
  const registered_at = Number(toBigIntOr(rawData.registered_at, 0n, "registered_at"));
  const bot_count = Number(toBigIntOr(rawData.bot_count, 0n, "bot_count"));

  return {
    address,
    username,
    display_name,
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
const VALID_BOT_TIERS: readonly BotTier[] = ["Basic", "Bronze", "Silver", "Gold", "Diamond"];

/**
 * Shared by every parser that decodes a `BotTier` field (bots, marketplace
 * listings) — see the `parseBotNFT` doc comment above for why both the bare
 * string and one-element-array shapes are accepted, and why an unrecognized
 * shape throws instead of silently defaulting to `"Basic"`.
 */
function parseBotTier(rawTier: unknown, context: string): BotTier {
  if (typeof rawTier === "string") {
    if (!VALID_BOT_TIERS.includes(rawTier as BotTier)) {
      throw new Error(`${context}: unrecognized tier "${rawTier}"`);
    }
    return rawTier as BotTier;
  }
  if (Array.isArray(rawTier) && rawTier.length === 1 && typeof rawTier[0] === "string") {
    const candidate = rawTier[0] as string;
    if (!VALID_BOT_TIERS.includes(candidate as BotTier)) {
      throw new Error(`${context}: unrecognized tier "${candidate}"`);
    }
    return candidate as BotTier;
  }
  // Soroban encodes unit enum variants as u32 discriminants (Basic=0 … Diamond=4).
  // bot_nft test snapshots store `tier` as `{"u32": 0}`; scValToNative yields
  // the raw number for unrecognized enums when the client lacks the ABI.
  if (typeof rawTier === "number" && Number.isInteger(rawTier)) {
    const name = VALID_BOT_TIERS[rawTier];
    if (!name) {
      throw new Error(
        `${context}: u32 tier discriminant ${rawTier} out of range 0–${VALID_BOT_TIERS.length - 1}`,
      );
    }
    return name;
  }
  if (
    rawTier !== null &&
    typeof rawTier === "object" &&
    "u32" in (rawTier as object) &&
    typeof (rawTier as Record<string, unknown>).u32 === "number"
  ) {
    const idx = (rawTier as Record<string, unknown>).u32 as number;
    const name = VALID_BOT_TIERS[idx];
    if (!name) {
      throw new Error(
        `${context}: u32 tier discriminant ${idx} out of range 0–${VALID_BOT_TIERS.length - 1}`,
      );
    }
    return name;
  }
  throw new Error(
    `${context}: unexpected tier shape ${JSON.stringify(rawTier)}; expected "Gold", ["Gold"], 0–4, or {u32: 0–4}`,
  );
}

export function parseBotNFT(rawData: Record<string, unknown>): BotNFT {
  const tier = parseBotTier(rawData.tier, "parseBotNFT");

  return {
    id: toBigInt(rawData.id, "id"),
    nickname: rawData.nickname != null ? String(rawData.nickname) : undefined,
    owner: String(rawData.owner ?? ""),
    // The bot struct carries `minter` (the royalty recipient). Fall back to
    // the owner so legacy fixtures/mocks render without a phantom royalty.
    minter: rawData.minter != null ? String(rawData.minter) : String(rawData.owner ?? ""),
    tier,
    accrual_rate: toBigInt(rawData.accrual_rate, "accrual_rate"),
    minted_at: Number(toBigIntOr(rawData.minted_at, 0n, "minted_at")),
    last_claim_timestamp: toBigIntOr(rawData.last_claim_timestamp, 0n, "last_claim_timestamp"),
  };
}

/**
 * Parse a raw scVal map from the marketplace contract into a typed MarketplaceListing.
 */
export function parseListing(rawData: Record<string, unknown>): MarketplaceListing {
  return {
    id: toBigInt(rawData.id, "id"),
    seller: String(rawData.seller ?? ""),
    bot_id: toBigInt(rawData.bot_id, "bot_id"),
    bot_tier: parseBotTier(rawData.bot_tier, "parseListing"),
    price: toBigInt(rawData.price, "price"),
    currency: String(rawData.currency ?? ""),
    listed_at: toBigInt(rawData.listed_at, "listed_at"),
    active: Boolean(rawData.active),
  };
}

/**
 * Get the AMT token balance for a user.
 * Calls token contract's balance() function.
 */
export async function getAmtBalance(userAddress: string): Promise<bigint> {
  const balance = await simulateContractCall<bigint>(
    CONTRACT_ADDRESSES.token,
    "balance",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return toBigInt(balance, "balance");
}

/**
 * The AMT token's `decimals()` (#479). AMT amounts are converted with the
 * token's own precision via `fromBaseUnits`, never an assumed scale.
 */
export async function getAmtDecimals(sourceAddress?: string): Promise<number> {
  const raw = await simulateContractCall<number | bigint>(
    CONTRACT_ADDRESSES.token,
    "decimals",
    [],
    defaultSource(sourceAddress),
  );
  const decimals = Number(raw);
  if (raw === null || raw === undefined || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals returned unexpected value ${String(raw)}`);
  }
  return decimals;
}

/**
 * Query `decimals()` on an arbitrary SEP-41 token contract.
 * Use `getAmtDecimals` for the configured AMT token; use this when the
 * listing's `currency` field may point to a different contract.
 */
export async function getTokenDecimals(
  contractId: string,
  sourceAddress?: string,
): Promise<number> {
  const raw = await simulateContractCall<number | bigint>(
    contractId,
    "decimals",
    [],
    defaultSource(sourceAddress),
  );
  const decimals = Number(raw);
  if (raw === null || raw === undefined || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals returned unexpected value ${String(raw)}`);
  }
  return decimals;
}

/**
 * Query `symbol()` on an arbitrary SEP-41 token contract.
 * Falls back to a truncated contract address if the call fails (e.g. native
 * XLM asset wrapper contracts that may not expose `symbol`).
 */
export async function getTokenSymbol(contractId: string, sourceAddress?: string): Promise<string> {
  try {
    const raw = await simulateContractCall<string>(
      contractId,
      "symbol",
      [],
      defaultSource(sourceAddress),
    );
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch {
    // fall through to address-based fallback
  }
  // Truncated fallback: show first 6 + last 4 chars of the contract address.
  return `${contractId.slice(0, 6)}…${contractId.slice(-4)}`;
}

/** Default listing duration: 7 days in seconds. */
export const DEFAULT_LISTING_DURATION_SECS = BigInt(7 * 24 * 60 * 60);

/**
 * Build the argument list for the marketplace's
 * `list_bot(seller: Address, bot_id: u64, price: i128, currency: Address, duration_secs: u64)`.
 *
 * Order and ScVal types must match the Rust signature exactly — a wrong count
 * or type fails at simulation. `seller` is the address whose authorization the
 * contract requires, so it is the connected wallet; `currency` defaults to the
 * configured payment token; `durationSecs` defaults to 7 days.
 */
export function buildListBotArgs(
  seller: string,
  botId: bigint,
  price: bigint,
  currency: string = CONTRACT_ADDRESSES.token,
  durationSecs: bigint = DEFAULT_LISTING_DURATION_SECS,
): xdr.ScVal[] {
  return [
    addressToScVal(seller),
    u64ToScVal(botId),
    i128ToScVal(price),
    addressToScVal(currency),
    u64ToScVal(durationSecs),
  ];
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
  sourceAddress?: string,
): Promise<UserProfile[]> {
  const raw = await simulateContractCall<Record<string, unknown>[]>(
    CONTRACT_ADDRESSES.registry,
    "get_leaderboard",
    [nativeToScVal(limit, { type: "u32" })],
    defaultSource(sourceAddress),
  );
  // The contract always returns an array; a non-array means a schema mismatch
  // (e.g. wrong contract ID), not an empty leaderboard.
  if (!Array.isArray(raw)) {
    throw new Error(`get_leaderboard returned unexpected type ${typeof raw}; expected array`);
  }
  return raw.map((entry) => parseUserProfile(entry));
}

/**
 * The registry's current season number (#371). Season `0` is the default
 * before an admin has called `start_new_season`; each call rolls the number
 * forward and starts a fresh season board.
 */
export async function getSeason(sourceAddress?: string): Promise<number> {
  const raw = await simulateContractCall<number>(
    CONTRACT_ADDRESSES.registry,
    "get_season",
    [],
    defaultSource(sourceAddress),
  );
  return Number(raw);
}

/**
 * One season's leaderboard rows (#371), ranked by `season_points`.
 *
 * Mapped onto the `UserProfile` shape the table already renders: `points`
 * carries the season total (what the row is ranked by), `total_points`
 * keeps the lifetime total the contract sends alongside, and the
 * claim/registration fields are zeroed — they are not part of a season row.
 */
export async function getLeaderboardForSeason(
  season: number,
  limit: number = 50,
  sourceAddress?: string,
): Promise<UserProfile[]> {
  const raw = await simulateContractCall<Record<string, unknown>[]>(
    CONTRACT_ADDRESSES.registry,
    "get_leaderboard_for_season",
    [nativeToScVal(season, { type: "u32" }), nativeToScVal(limit, { type: "u32" })],
    defaultSource(sourceAddress),
  );
  if (!Array.isArray(raw)) {
    throw new Error(
      `get_leaderboard_for_season returned unexpected type ${typeof raw}; expected array`,
    );
  }
  return raw.map((entry) => {
    const address = String(entry.address ?? "");
    const display_name = String(entry.display_name ?? "");
    const season_points = toBigInt(entry.season_points, "season_points");
    const total_points = toBigInt(entry.total_points, "total_points");
    return {
      address,
      username: display_name,
      display_name,
      total_points,
      points: season_points,
      claimed_amt: 0n,
      claimedAmt: 0n,
      registered_at: 0,
      registeredAt: 0,
      bot_count: 0,
      botCount: 0,
    };
  });
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
 * Returns `null` for the unranked sentinel or when the deployed registry
 * predates `get_rank`; other simulation errors propagate to the caller.
 */
function isMissingGetRankMethod(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return (
    /(?:unknown|no such|missing|unsupported)\s+(?:contract\s+)?(?:function|method)\s+[`'"]?get_rank\b/i.test(
      message,
    ) ||
    /\bno\s+get_rank\b/i.test(message) ||
    // Soroban reports a call to an absent contract entry point as Contract #0.
    /Error\(Contract,\s*#0\b/.test(message)
  );
}

async function getRegistryRank(userAddress: string, sourceAddress: string): Promise<number | null> {
  try {
    const raw = await simulateContractCall<number | bigint>(
      CONTRACT_ADDRESSES.registry,
      "get_rank",
      [nativeToScVal(userAddress, { type: "address" })],
      sourceAddress,
    );
    const rank = Number(raw);
    if (!Number.isInteger(rank) || rank <= 0 || rank >= UNRANKED_SENTINEL) {
      return null;
    }
    return rank;
  } catch (error) {
    if (isMissingGetRankMethod(error)) return null;
    throw error;
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
  sourceAddress?: string,
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
    getUserProfile(userAddress),
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
 * Encode a tier as the on-chain `BotTier`. The Rust enum is
 * `#[contracttype] #[repr(u32)]` with explicit discriminants (Basic = 0 …
 * Diamond = 4), so Soroban encodes it as a plain `ScU32`, not the
 * `ScVec([ScSymbol])` shape used for unit enums without discriminants.
 */
export function tierToScVal(tier: BotTier): xdr.ScVal {
  const index = TIER_ORDER.indexOf(tier);
  if (index === -1) throw new Error(`Unknown tier: ${tier}`);
  return xdr.ScVal.scvU32(index);
}

/**
 * Argument list for bot_nft `mint_tier(owner: Address, tier: BotTier)`.
 * The contract charges the tier price in its configured payment token, so
 * no token argument is passed.
 */
export function buildMintTierArgs(owner: string, tier: BotTier): xdr.ScVal[] {
  return [addressToScVal(owner), tierToScVal(tier)];
}

/**
 * Mint a bot of a specific BotTier (AM-004/AM-013).
 *
 * Calls `mint_tier` (not `mint` — no such method exists). The contract uses
 * its configured payment token and applies the selected tier's price.
 */
export async function mintTierBot(address: string, tier: BotTier): Promise<string> {
  return buildTxXdr(
    CONTRACT_ADDRESSES.botNft,
    "mint_tier",
    buildMintTierArgs(address, tier),
    address,
  );
}

/** u64::MAX — what bot_nft `tier_remaining` returns for an uncapped tier. */
export const TIER_UNCAPPED = BigInt("18446744073709551615");

/**
 * Remaining mint slots for `tier` from bot_nft `tier_remaining`. Returns
 * {@link TIER_UNCAPPED} when the tier has no cap.
 */
export async function getTierRemaining(tier: BotTier, sourceAddress?: string): Promise<bigint> {
  const raw = await simulateContractCall<bigint>(
    CONTRACT_ADDRESSES.botNft,
    "tier_remaining",
    [tierToScVal(tier)],
    defaultSource(sourceAddress),
  );
  return toBigInt(raw, "tier_remaining");
}

/**
 * Argument list for bot_nft `transfer(bot_id: u64, from: Address, to: Address)`.
 * `from` must be the connected wallet — the contract requires its auth and
 * rejects with `NotOwner` otherwise.
 */
export function buildTransferBotArgs(botId: bigint, from: string, to: string): xdr.ScVal[] {
  return [u64ToScVal(botId), addressToScVal(from), addressToScVal(to)];
}

/** Marketplace `is_paused()`: list, buy, update_price and offers are rejected while true. */
export async function isMarketplacePaused(sourceAddress?: string): Promise<boolean> {
  const raw = await simulateContractCall<boolean>(
    CONTRACT_ADDRESSES.marketplace,
    "is_paused",
    [],
    defaultSource(sourceAddress),
  );
  return raw === true;
}

/**
 * Token `paused()`: transfers, mints and burns are rejected while true, which
 * blocks buying bots, paid tier mints and claiming AMT.
 */
export async function isTokenPaused(sourceAddress?: string): Promise<boolean> {
  const raw = await simulateContractCall<boolean>(
    CONTRACT_ADDRESSES.token,
    "paused",
    [],
    defaultSource(sourceAddress),
  );
  return raw === true;
}

/**
 * Marketplace `get_min_price(currency)` — the floor `list_bot` enforces with
 * `PriceTooLow`. Either the admin-set value or the default
 * `ceil(10_000 / fee_bps)` base units.
 */
export async function getMinListingPrice(
  currency: string,
  sourceAddress?: string,
): Promise<bigint> {
  const raw = await simulateContractCall<bigint>(
    CONTRACT_ADDRESSES.marketplace,
    "get_min_price",
    [addressToScVal(currency)],
    defaultSource(sourceAddress),
  );
  return toBigInt(raw, "min_price");
}

/**
 * Cancel a marketplace listing.
 * Returns the bot to the seller's wallet.
 */
export async function cancelListing(userAddress: string, listingId: bigint): Promise<string> {
  return buildTxXdr(
    CONTRACT_ADDRESSES.marketplace,
    "cancel_listing",
    [addressToScVal(userAddress), u64ToScVal(listingId)],
    userAddress,
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
  sourceAddress?: string,
): Promise<MarketplaceListing[]> {
  const listingsRaw = await simulateContractCall<Record<string, unknown>[]>(
    CONTRACT_ADDRESSES.marketplace,
    "get_active_listings",
    [nativeToScVal(start, { type: "u64" }), nativeToScVal(limit, { type: "u32" })],
    defaultSource(sourceAddress),
  );
  if (!Array.isArray(listingsRaw)) {
    throw new Error(
      `get_active_listings returned unexpected type ${typeof listingsRaw}; expected array`,
    );
  }
  return listingsRaw.map((listing) => parseListing(listing));
}

/**
 * Get sales statistics (volume, sale count, last sale price, floor) for every
 * tier from the marketplace (#432). The contract returns one entry per tier in
 * tier order, so the tier is taken from position.
 */
export async function getMarketStats(sourceAddress?: string): Promise<TierStats[]> {
  const raw = await simulateContractCall<Record<string, unknown>[]>(
    CONTRACT_ADDRESSES.marketplace,
    "market_stats",
    [],
    defaultSource(sourceAddress),
  );
  if (!Array.isArray(raw)) {
    throw new Error(`market_stats returned unexpected type ${typeof raw}; expected array`);
  }
  return raw.map((entry, index) => ({
    tier: TIER_ORDER[index] ?? "Basic",
    volume: toBigInt(entry.volume, "volume"),
    sale_count: toBigInt(entry.sale_count, "sale_count"),
    last_sale_price: toBigInt(entry.last_sale_price, "last_sale_price"),
    floor_price: toBigInt(entry.floor_price, "floor_price"),
  }));
}

/** The marketplace's on-chain fee configuration (basis points). */
export interface MarketplaceConfig {
  admin: string;
  botNft: string;
  /** Platform fee in basis points of the sale price. */
  feeBps: number;
  /** Creator royalty in basis points, paid unless the seller is the minter. */
  royaltyBps: number;
}

/**
 * Read the marketplace `config()` — the source of truth for `fee_bps` and
 * `royalty_bps`. Both are admin-configurable (`set_fee_bps`), so the UI must
 * never hardcode the 2.5% default: the seller's "you receive" figure has to
 * mirror `buy_bot`'s split exactly.
 */
export async function getMarketplaceConfig(sourceAddress?: string): Promise<MarketplaceConfig> {
  const raw = await simulateContractCall<Record<string, unknown>>(
    CONTRACT_ADDRESSES.marketplace,
    "config",
    [],
    defaultSource(sourceAddress),
  );
  return {
    admin: String(raw?.admin ?? ""),
    botNft: String(raw?.bot_nft ?? ""),
    feeBps: Number(toBigInt(raw?.fee_bps, "fee_bps")),
    royaltyBps: Number(toBigInt(raw?.royalty_bps, "royalty_bps")),
  };
}

/**
 * Get marketplace listings for a specific user.
 *
 * Errors propagate to the caller so React Query's `isError` path fires on an
 * RPC outage. A non-array return indicates a schema mismatch and is thrown
 * rather than silently collapsed to [].
 */
export async function getUserListings(userAddress: string): Promise<MarketplaceListing[]> {
  const listingsRaw = await simulateContractCall<Record<string, unknown>[]>(
    CONTRACT_ADDRESSES.marketplace,
    "get_user_listings",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  if (!Array.isArray(listingsRaw)) {
    throw new Error(
      `get_user_listings returned unexpected type ${typeof listingsRaw}; expected array`,
    );
  }
  return listingsRaw.map((listing) => parseListing(listing));
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
  const result = await simulateContractCall<boolean>(
    CONTRACT_ADDRESSES.registry,
    "is_registered",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return Boolean(result);
}

/**

/**
 * Bump storage TTL for all bots belonging to a user (permissionless, #397).
 * Extends both the user's bot list and each bot's persistent storage retention window.
 */
export async function bumpUserBots(userAddress: string, sourceAddress?: string): Promise<string> {
  const source = defaultSource(sourceAddress ?? userAddress);
  return buildTxXdr(
    CONTRACT_ADDRESSES.botNft,
    "bump_user_bots",
    [nativeToScVal(userAddress, { type: "address" })],
    source,
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
  let stateRaw: Record<string, unknown> | null | undefined;
  try {
    stateRaw = await simulateContractCall<Record<string, unknown> | null>(
      CONTRACT_ADDRESSES.accrual,
      "get_accrual_state",
      [nativeToScVal(userAddress, { type: "address" })],
      userAddress,
    );
  } catch (err) {
    if (isNotFoundError(err) || isNotRegisteredError(err)) return null;
    throw err;
  }

  if (!stateRaw) return null;

  return {
    last_claim_ts: toBigInt(stateRaw.last_claim_ts, "last_claim_ts"),
    carry_points: toBigInt(stateRaw.carry_points ?? stateRaw.total_claimed_points, "carry_points"),
    lifetime_points: toBigInt(stateRaw.lifetime_points ?? 0n, "lifetime_points"),
    rate: toBigIntOr(stateRaw.rate, 0n, "rate"),
    started_at: toBigIntOr(stateRaw.started_at, 0n, "started_at"),
  };
}

/** Most addresses `get_accrual_states` accepts in one call. */
export const MAX_ACCRUAL_BATCH = 50;

function parseAccrualState(raw: Record<string, unknown> | null | undefined): AccrualState | null {
  if (!raw) return null;
  return {
    last_claim_ts: toBigInt(raw.last_claim_ts, "last_claim_ts"),
    carry_points: toBigInt(raw.carry_points ?? 0n, "carry_points"),
    lifetime_points: toBigInt(raw.lifetime_points ?? 0n, "lifetime_points"),
    rate: toBigIntOr(raw.rate, 0n, "rate"),
    started_at: toBigIntOr(raw.started_at, 0n, "started_at"),
    leftover: toBigIntOr(raw.leftover, 0n, "leftover"),
  };
}

/**
 * Get accrual states for many users in a single simulation (#420). Results are
 * in the same order as `userAddresses`; an address with no accrual record maps
 * to `null`. Errors propagate so React Query's `isError` path fires.
 */
export async function getAccrualStates(userAddresses: string[]): Promise<(AccrualState | null)[]> {
  if (userAddresses.length === 0) return [];
  if (userAddresses.length > MAX_ACCRUAL_BATCH) {
    throw new Error(
      `getAccrualStates accepts at most ${MAX_ACCRUAL_BATCH} addresses, got ${userAddresses.length}`,
    );
  }
  const raw = await simulateContractCall<(Record<string, unknown> | null)[]>(
    CONTRACT_ADDRESSES.accrual,
    "get_accrual_states",
    [xdr.ScVal.scvVec(userAddresses.map((address) => nativeToScVal(address, { type: "address" })))],
    userAddresses[0] ?? defaultSource(),
  );
  if (!Array.isArray(raw)) {
    throw new Error(`get_accrual_states returned unexpected type ${typeof raw}; expected array`);
  }
  return raw.map((entry) => parseAccrualState(entry));
}

/**
 * Get the accrual contract's on-chain config — currently just
 * `points_per_amt`, the number of points that convert to 1 AMT.
 *
 * This is the source of truth for that conversion threshold (#477): it
 * used to be a hardcoded frontend env var (`NEXT_PUBLIC_POINTS_PER_AMT`,
 * defaulting to 1000) that disagreed with `scripts/deploy.sh`'s actual
 * `initialize(..., 100)` call, silently putting every client-side
 * "points to next AMT" figure off by 10x. Callers should fetch this once
 * via `useAccrualConfig()` (long `staleTime` — it only changes on
 * redeploy) rather than importing a constant.
 */
export async function getAccrualConfig(sourceAddress?: string): Promise<{ pointsPerAmt: number }> {
  const source = defaultSource(sourceAddress);
  const raw = await simulateContractCall<Record<string, unknown>>(
    CONTRACT_ADDRESSES.accrual,
    "config",
    [],
    source,
  );
  const pointsPerAmt = toBigInt(raw?.points_per_amt, "points_per_amt");
  return { pointsPerAmt: Number(pointsPerAmt) };
}

/**
 * Get pending (unclaimed) points accrued for a user since their last claim.
 * Calls the accrual contract's pending_points() function (#481).
 */
export async function getPendingPoints(userAddress: string): Promise<bigint> {
  const raw = await simulateContractCall<bigint | number>(
    CONTRACT_ADDRESSES.accrual,
    "pending_points",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return toBigInt(raw, "pending_points");
}

/**
 * Claim accrued points, converting them to AMT tokens where the points
 * threshold is met. Calls the accrual contract's claim() function.
 */
export async function claimPoints(userAddress: string): Promise<string> {
  return buildTxXdr(
    CONTRACT_ADDRESSES.accrual,
    "claim",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(CONTRACT_ADDRESSES.token, { type: "address" }),
      nativeToScVal(CONTRACT_ADDRESSES.registry, { type: "address" }),
    ],
    userAddress,
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
  return msg.includes("NotRegistered") || /Error\(Contract,\s*#1\b/.test(msg);
}

/**
 * Return true when the simulation error represents the contract-defined
 * "NotFound" variant (error code #2 in the accrual contract).
 */
function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes("NotFound") || /Error\(Contract,\s*#2\b/.test(msg);
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
  let profileRaw: Record<string, unknown> | null | undefined;
  try {
    profileRaw = await simulateContractCall<Record<string, unknown> | null>(
      CONTRACT_ADDRESSES.registry,
      "get_user",
      [nativeToScVal(userAddress, { type: "address" })],
      userAddress,
    );
  } catch (err) {
    if (isNotRegisteredError(err)) return null;
    throw err;
  }

  if (!profileRaw) return null;
  return parseUserProfile(profileRaw);
}

/** Read only the user's points scalar, without decoding their profile string. */
export async function getUserPoints(userAddress: string): Promise<bigint> {
  const raw = await simulateContractCall<unknown>(
    CONTRACT_ADDRESSES.registry,
    "get_points",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return toBigInt(raw, "points");
}

/** Read only the user's bot count scalar. */
export async function getUserBotCount(userAddress: string): Promise<number> {
  const raw = await simulateContractCall<unknown>(
    CONTRACT_ADDRESSES.registry,
    "get_bot_count",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return Number(toBigInt(raw, "bot_count"));
}

/** Read only the user's claimed AMT scalar. */
export async function getUserClaimedAmt(userAddress: string): Promise<bigint> {
  const raw = await simulateContractCall<unknown>(
    CONTRACT_ADDRESSES.registry,
    "get_claimed_amt",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return toBigInt(raw, "claimed_amt");
}

/** Most addresses `get_users_batch` accepts in one call. */
export const MAX_USERS_BATCH = 50;

/**
 * Get user profiles for up to {@link MAX_USERS_BATCH} addresses in a single
 * registry simulation.
 *
 * Results are returned in the same order as `addresses`; unregistered
 * addresses map to `null`. Passing more than {@link MAX_USERS_BATCH}
 * addresses throws an error (matching the contract's `BatchTooLarge` error).
 * Every RPC or contract error propagates so React Query's `isError` path fires.
 */
export async function getUsersBatch(
  addresses: string[],
  sourceAddress?: string,
): Promise<(UserProfile | null)[]> {
  if (addresses.length === 0) return [];
  if (addresses.length > MAX_USERS_BATCH) {
    throw new Error(
      `getUsersBatch accepts at most ${MAX_USERS_BATCH} addresses, got ${addresses.length}`,
    );
  }
  const raw = await simulateContractCall<(Record<string, unknown> | null)[]>(
    CONTRACT_ADDRESSES.registry,
    "get_users_batch",
    [xdr.ScVal.scvVec(addresses.map((address) => nativeToScVal(address, { type: "address" })))],
    sourceAddress ?? addresses[0] ?? defaultSource(),
  );
  if (!Array.isArray(raw)) {
    throw new Error(`get_users_batch returned unexpected type ${typeof raw}; expected array`);
  }
  return raw.map((entry) => (entry ? parseUserProfile(entry) : null));
}

export const getUserProfiles = getUsersBatch;

/**
 * Get the list of bot IDs owned by a user from the bot_nft contract (#481).
 */
export async function getUserBots(userAddress: string): Promise<bigint[]> {
  const raw = await simulateContractCall<unknown[]>(
    CONTRACT_ADDRESSES.botNft,
    "get_user_bots",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  if (!Array.isArray(raw))
    throw new Error(`get_user_bots returned unexpected type ${typeof raw}; expected array`);
  return raw.map((id) => toBigInt(id, "bot_id"));
}

/**
 * Fetch a user's bots with full records in a single contract round trip
 * (#483). The contract caps the result at its `MAX_DETAILED_BOTS`; callers
 * needing more fall back to {@link getUserBots} + {@link getBotById} for
 * the remainder.
 */
export async function getUserBotsDetailed(userAddress: string): Promise<BotNFT[]> {
  const raw = await simulateContractCall<Record<string, unknown>[]>(
    CONTRACT_ADDRESSES.botNft,
    "get_user_bots_detailed",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  if (!Array.isArray(raw))
    throw new Error(
      `get_user_bots_detailed returned unexpected type ${typeof raw}; expected array`,
    );
  return raw.map((entry) => parseBotNFT(entry));
}

/**
 * Get a single bot's full record by ID from the bot_nft contract (#481).
 * Errors propagate: a simulation failure is never swallowed as `null`.
 */
export async function getBotById(userAddress: string, botId: bigint): Promise<BotNFT | null> {
  const raw = await simulateContractCall<Record<string, unknown> | null>(
    CONTRACT_ADDRESSES.botNft,
    "get_bot",
    [nativeToScVal(botId, { type: "u64" })],
    userAddress,
  );
  return raw ? parseBotNFT(raw) : null;
}

/**
 * Get a user's combined accrual rate across all owned bots from the
 * bot_nft contract (#481).
 */
export async function getUserTotalRate(userAddress: string): Promise<bigint> {
  const raw = await simulateContractCall<bigint | number>(
    CONTRACT_ADDRESSES.botNft,
    "get_user_total_rate",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress,
  );
  return toBigInt(raw, "get_user_total_rate");
}

/**
 * Return up to `limit` bots (max 100) with IDs in `[startId, startId + limit)`,
 * skipping any gaps. Throws if `limit` exceeds 100 (#391).
 */
export async function getBotsRange(
  startId: bigint,
  limit: number,
  sourceAddress?: string,
): Promise<BotNFT[]> {
  const source = defaultSource(sourceAddress);
  const raw = await simulateContractCall(
    CONTRACT_ADDRESSES.botNft,
    "get_bots_range",
    [nativeToScVal(startId, { type: "u64" }), nativeToScVal(limit, { type: "u32" })],
    source,
  );
  if (!Array.isArray(raw)) {
    throw new Error(`get_bots_range returned unexpected type ${typeof raw}; expected array`);
  }
  return raw.map((item) => parseBotNFT(item as Record<string, unknown>));
}

/**
 * Every tier's name, rate and price from the bot_nft contract (#478, AM-072).
 *
 * The contract is the single source of truth for tier economics; the
 * frontend keeps only presentational fields (`TIER_META`). One `all_tiers`
 * call returns all five entries in tier order.
 */
export async function getAllTiers(sourceAddress?: string): Promise<Record<BotTier, TierInfo>> {
  const source = defaultSource(sourceAddress);
  const raw = await simulateContractCall<Array<{ name: unknown; rate: unknown; price: unknown }>>(
    CONTRACT_ADDRESSES.botNft,
    "all_tiers",
    [],
    source,
  );
  if (!Array.isArray(raw) || raw.length !== 5) {
    throw new Error(`all_tiers returned unexpected shape; expected array of 5 TierInfo structs`);
  }
  const entries = TIER_ORDER.map((tier, index): [BotTier, TierInfo] => {
    const item = raw[index];
    if (!item || typeof item !== "object") {
      throw new Error(`all_tiers entry ${index} has unexpected shape`);
    }
    return [
      tier,
      {
        tier,
        name: String(item.name),
        rate: toBigInt(item.rate, "rate"),
        price: toBigInt(item.price, "price"),
      },
    ];
  });
  return Object.fromEntries(entries) as Record<BotTier, TierInfo>;
}

// -- Contract preflight (#464) ------------------------------------------------

/** Reachability of a single configured contract. */
export type PreflightKind = "ok" | "unreachable-rpc" | "contract-not-found";

export interface ContractPreflightResult {
  name: ContractName;
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
 * `admin`, marketplace `next_listing_id`, token `decimals`.
 *
 * Pass `{ force: true }` to discard the cached report and re-run the checks.
 */
export function preflight(
  sourceAddress?: string,
  options: { force?: boolean } = {},
): Promise<PreflightReport> {
  if (_preflightCache && !options.force) return _preflightCache;

  _preflightCache = (async (): Promise<PreflightReport> => {
    let source: string;
    try {
      source = defaultSource(sourceAddress);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const all: ContractPreflightResult[] = (
        Object.entries(CONTRACT_ADDRESSES) as Array<[ContractName, string]>
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
      name: ContractName;
      contractId: string;
      method: string;
      args: xdr.ScVal[];
    }> = [
      {
        name: "registry",
        contractId: CONTRACT_ADDRESSES.registry,
        method: "total_users",
        args: [],
      },
      { name: "botNft", contractId: CONTRACT_ADDRESSES.botNft, method: "admin", args: [] },
      { name: "accrual", contractId: CONTRACT_ADDRESSES.accrual, method: "admin", args: [] },
      {
        name: "marketplace",
        contractId: CONTRACT_ADDRESSES.marketplace,
        method: "next_listing_id",
        args: [],
      },
      { name: "token", contractId: CONTRACT_ADDRESSES.token, method: "decimals", args: [] },
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
      }),
    );

    return { ok: results.every((r) => r.ok), results };
  })();

  // A rejected preflight must not poison the cache — the next caller retries.
  _preflightCache.catch(() => {
    _preflightCache = null;
  });

  return _preflightCache;
}
