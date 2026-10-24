// @ts-nocheck
import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';
export * from '@stellar/stellar-sdk'
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  }
} as const

export type DataKey = {tag: "UserProfile", values: readonly [string]} | {tag: "UserPoints", values: readonly [string]} | {tag: "UserBotCount", values: readonly [string]} | {tag: "UserClaimedAmt", values: readonly [string]} | {tag: "Username", values: readonly [string]} | {tag: "UserTombstone", values: readonly [string]} | {tag: "UserPage", values: readonly [u32]} | {tag: "SeasonPoints", values: readonly [u32, string]} | {tag: "TopUsers", values: void} | {tag: "PageCount", values: void} | {tag: "SeasonTop", values: readonly [u32]} | {tag: "Season", values: void} | {tag: "TotalUsers", values: void} | {tag: "Admin", values: void} | {tag: "PendingAdmin", values: void} | {tag: "Initialized", values: void} | {tag: "Writers", values: void};


export interface Writers {
  accrual: string;
  bot_nft: string;
}


/**
 * One row of a season leaderboard (#371). `season_points` is what the row is
 * ranked by; `total_points` is the user's lifetime total, carried alongside
 * so a UI can show both without a second call.
 */
export interface SeasonEntry {
  address: string;
  /**
 * Display username, original casing preserved (`display_name`).
 */
display_name: string;
  season_points: u64;
  total_points: u64;
}


/**
 * Per-user profile stored in persistent storage.
 * 
 * # Numeric type rationale (`total_points: u64` vs `claimed_amt: i128`)
 * - `total_points` is `u64`: points are a non-negative internal accounting
 * counter accrued from bot rates (`u64` points/sec × elapsed `u64` seconds)
 * and never participate in SEP-41 token arithmetic.
 * - `claimed_amt` stays `i128`: across Soroban and SEP-41 (`soroban_sdk::token`),
 * token balances and transfer/mint amounts are canonically `i128` (scaled by
 * `10^decimals`). Keeping `claimed_amt` as `i128` matches the AMT token
 * contract's `mint`/`balance` signature without narrowing casts, while
 * [`RegistryContract::add_claimed_amt`] rejects negative values with
 * [`RegistryError::NegativeAmount`] so the cumulative claimed total is
 * provably monotonic.
 */
export interface UserProfile {
  address: string;
  bot_count: u32;
  claimed_amt: i128;
  /**
 * The username exactly as the user registered it, casing preserved
 * (#373). Never used for uniqueness comparisons.
 */
display_name: string;
  registered_at: u64;
  total_points: u64;
  /**
 * Normalized (ASCII-lowercased) username — the canonical identity used
 * for uniqueness (#373). Display the original casing via
 * [`UserProfile::display_name`].
 */
username: string;
}

export const Errors = {
  1: {message:"AlreadyInitialized"},

  2: {message:"AlreadyRegistered"},

  3: {message:"UsernameTaken"},

  4: {message:"NotRegistered"},

  5: {message:"Unauthorized"},

  6: {message:"NotInitialized"},

  /**
   * The registered-user counter has reached `u32::MAX`, or a points update
   * would overflow `u64`.
   */
  7: {message:"Overflow"},

  /**
   * More than `MAX_USERS_BATCH` addresses were passed to `get_users_batch`.
   */
  8: {message:"BatchTooLarge"},

  /**
   * Negative amount passed to `add_claimed_amt`.
   */
  9: {message:"NegativeAmount"},

  /**
   * `accept_admin` or `cancel_admin_transfer` called with no pending transfer.
   */
  10: {message:"NoPendingAdmin"},

  /**
   * A single `add_points` update exceeded `MAX_POINTS_PER_CALL` (#363).
   */
  11: {message:"ImplausiblePoints"},

  /**
   * The username is empty or longer than 32 bytes. Distinct from
   * `UsernameTaken`, which means a valid name is already in use.
   */
  12: {message:"InvalidUsername"}
}

export interface UserTombstone {
  address: string;
  claimed_amt: i128;
  total_points: u64;
  unregistered_at: u64;
  username: string;
}


export interface Client {
  /**
   * Construct and simulate a get_rank transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the 1-based leaderboard rank of `user` from the bounded top-N
   * structure (`TopUsers`), or `u32::MAX` ([`UNRANKED`], documented as
   * "unranked") when `user` is registered but sits below the
   * top-`LEADERBOARD_SIZE` cutoff. Returns [`RegistryError::NotRegistered`]
   * if `user` has not registered.
   */
  get_rank: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a get_user transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * #372: reads the profile from persistent storage. Archival-sensitive —
   * see [`Self::is_registered`], which performs this exact read.
   */
  get_user: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<UserProfile>>>

  /**
   * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register: ({user, username}: {user: string, username: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_users transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_users: ({page}: {page: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step one of a two-step admin transfer (AM-031): the current admin
   * nominates `new_admin` as the pending admin. The active admin does not
   * change until `new_admin` calls [`Self::accept_admin`]. Proposing again
   * replaces the pending nomination; self-nomination is rejected with
   * [`RegistryError::Unauthorized`].
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a add_points transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_points: ({user, points}: {user: string, points: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_points transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_points: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_season transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current season counter (#371). Season 0 is in effect until
   * [`Self::start_new_season`] is first called.
   */
  get_season: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin}: {admin: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_points transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_points: ({user, value}: {user: string, value: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unregister transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unregister: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_writers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_writers: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<Writers>>>

  /**
   * Construct and simulate a set_writers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_writers: ({accrual, bot_nft}: {accrual: string, bot_nft: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a total_users transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_users: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step two of a two-step admin transfer (AM-031): the nominated pending
   * admin accepts and becomes the active admin. Fails with
   * [`RegistryError::NoPendingAdmin`] if no transfer is pending.
   */
  accept_admin: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a bump_profile transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  bump_profile: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_bot_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bot_count: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a is_registered transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * #372: registration check performs the *same* read `get_user` performs
   * (a persistent `.get()`), so the two can never disagree about an
   * address — both see the profile, or both see it as absent/archived.
   * 
   * Both functions are **archival-sensitive**: if a profile's TTL lapses,
   * the persistent entry is archived and both reads fail identically
   * (on mainnet the transaction never reaches the contract). Keep any
   * future registration probe based on this same read.
   */
  is_registered: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the address nominated by [`Self::set_admin`], if a transfer is
   * currently pending.
   */
  pending_admin: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a add_claimed_amt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add newly claimed AMT (in token base units, `i128` per SEP-41 convention)
   * to `user`'s cumulative `claimed_amt`. Rejects negative amounts with
   * [`RegistryError::NegativeAmount`] so `claimed_amt` is monotonically
   * non-decreasing.
   */
  add_claimed_amt: ({user, amount}: {user: string, amount: i128}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_claimed_amt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_claimed_amt: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_leaderboard transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Top users by points, highest first. Reads the maintained `TopUsers`
   * list and hydrates at most `min(limit, LEADERBOARD_SIZE)` profiles, so the
   * cost does not depend on the total number of users. Equal totals are
   * ordered by who reached the total first (earlier wins), deterministically.
   */
  get_leaderboard: ({limit}: {limit: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Array<UserProfile>>>

  /**
   * Construct and simulate a get_users_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fetch profiles for up to `MAX_USERS_BATCH` addresses in a single call,
   * in the same order as `addresses`. Unregistered addresses map to `None`.
   */
  get_users_batch: ({addresses}: {addresses: Array<string>}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<Array<Option<UserProfile>>>>>

  /**
   * Construct and simulate a start_new_season transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Roll the registry over to the next season (#371). Admin-only.
   * 
   * Increments the season counter and starts the new season's leaderboard
   * empty: season points are stored under `DataKey::SeasonPoints(season,
   * user)`, so a fresh season number means every user starts from zero
   * while lifetime `total_points` and every past season's board
   * (`SeasonTop`/`SeasonPoints` keyed by the old number) remain intact and
   * queryable. Returns the new season number and emits `newseason`.
   */
  start_new_season: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a decrement_bot_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decrement_bot_count: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a increment_bot_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  increment_bot_count: ({user}: {user: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_admin_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel an in-flight admin transfer (AM-031). Only the current admin may
   * cancel; fails with [`RegistryError::NoPendingAdmin`] if no transfer is
   * pending.
   */
  cancel_admin_transfer: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_leaderboard_for_season transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Top users by **season** points, highest first (#371). Reads the
   * maintained `SeasonTop(season)` list — same bounded, O(LEADERBOARD_SIZE)
   * hydration as [`Self::get_leaderboard`] — so the cost does not depend on
   * the total number of users, and historical seasons stay queryable.
   * Equal season totals are ordered by who reached the total first.
   */
  get_leaderboard_for_season: ({season, limit}: {season: u32, limit: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Array<SeasonEntry>>>

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAASZSZXR1cm4gdGhlIDEtYmFzZWQgbGVhZGVyYm9hcmQgcmFuayBvZiBgdXNlcmAgZnJvbSB0aGUgYm91bmRlZCB0b3AtTgpzdHJ1Y3R1cmUgKGBUb3BVc2Vyc2ApLCBvciBgdTMyOjpNQVhgIChbYFVOUkFOS0VEYF0sIGRvY3VtZW50ZWQgYXMKInVucmFua2VkIikgd2hlbiBgdXNlcmAgaXMgcmVnaXN0ZXJlZCBidXQgc2l0cyBiZWxvdyB0aGUKdG9wLWBMRUFERVJCT0FSRF9TSVpFYCBjdXRvZmYuIFJldHVybnMgW2BSZWdpc3RyeUVycm9yOjpOb3RSZWdpc3RlcmVkYF0KaWYgYHVzZXJgIGhhcyBub3QgcmVnaXN0ZXJlZC4AAAAAAAhnZXRfcmFuawAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+kAAAAEAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAIQjMzcyOiByZWFkcyB0aGUgcHJvZmlsZSBmcm9tIHBlcnNpc3RlbnQgc3RvcmFnZS4gQXJjaGl2YWwtc2Vuc2l0aXZlIOKAlApzZWUgW2BTZWxmOjppc19yZWdpc3RlcmVkYF0sIHdoaWNoIHBlcmZvcm1zIHRoaXMgZXhhY3QgcmVhZC4AAAAIZ2V0X3VzZXIAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAH0AAAAAtVc2VyUHJvZmlsZQAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAIdXNlcm5hbWUAAAAQAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAJZ2V0X3VzZXJzAAAAAAAAAQAAAAAAAAAEcGFnZQAAAAQAAAABAAAD6gAAABM=",
        "AAAAAAAAATFTdGVwIG9uZSBvZiBhIHR3by1zdGVwIGFkbWluIHRyYW5zZmVyIChBTS0wMzEpOiB0aGUgY3VycmVudCBhZG1pbgpub21pbmF0ZXMgYG5ld19hZG1pbmAgYXMgdGhlIHBlbmRpbmcgYWRtaW4uIFRoZSBhY3RpdmUgYWRtaW4gZG9lcyBub3QKY2hhbmdlIHVudGlsIGBuZXdfYWRtaW5gIGNhbGxzIFtgU2VsZjo6YWNjZXB0X2FkbWluYF0uIFByb3Bvc2luZyBhZ2FpbgpyZXBsYWNlcyB0aGUgcGVuZGluZyBub21pbmF0aW9uOyBzZWxmLW5vbWluYXRpb24gaXMgcmVqZWN0ZWQgd2l0aApbYFJlZ2lzdHJ5RXJyb3I6OlVuYXV0aG9yaXplZGBdLgAAAAAAAAlzZXRfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAEQAAAAEAAAAAAAAAC1VzZXJQcm9maWxlAAAAAAEAAAATAAAAAQAAAMlVc2VybmFtZSB1bmlxdWVuZXNzIG1hcHBpbmcsIGtleWVkIG9uIHRoZSAqKkFTQ0lJLWxvd2VyY2FzZWQqKiBmb3JtCigjMzczKSBzbyBgQWxpY2VgIGFuZCBgYWxpY2VgIGNhbm5vdCBib3RoIHJlZ2lzdGVyLiBUaGUgb3JpZ2luYWwKY2FzaW5nIHRoZSB1c2VyIHR5cGVkIGlzIHByZXNlcnZlZCBpbiBbYFVzZXJQcm9maWxlOjpkaXNwbGF5X25hbWVgXS4AAAAAAAAKVXNlclBvaW50cwAAAAAAAQAAABMAAAABAAAAAAAAAAxVc2VyQm90Q291bnQAAAABAAAAEwAAAAEAAAAAAAAADlVzZXJDbGFpbWVkQW10AAAAAAABAAAAEwAAAAEAAAAAAAAACFVzZXJuYW1lAAAAAQAAABAAAAABAAAAAAAAAA1Vc2VyVG9tYnN0b25lAAAAAAAAAQAAABMAAAABAAAAAAAAAAhVc2VyUGFnZQAAAAEAAAAEAAAAAQAAAEdQb2ludHMgZWFybmVkIGJ5IGEgdXNlciBpbiBhIGdpdmVuIHNlYXNvbiAoIzM3MSkuIFBlcnNpc3RlbnQsIHBlci11c2VyLgAAAAAMU2Vhc29uUG9pbnRzAAAAAgAAAAQAAAATAAAAAAAAAK9Cb3VuZGVkIGxlYWRlcmJvYXJkICgjMzMyKTogYFZlYzwoQWRkcmVzcywgdTY0KT5gIG9mIGF0IG1vc3QKYExFQURFUkJPQVJEX1NJWkVgIGVudHJpZXMsIHNvcnRlZCBieSBwb2ludHMgZGVzY2VuZGluZy4gVGllczogdGhlIHVzZXIKd2hvIHJlYWNoZWQgdGhhdCB0b3RhbCBmaXJzdCByYW5rcyBoaWdoZXIuAAAAAAhUb3BVc2VycwAAAAAAAACkTnVtYmVyIG9mIGFsbG9jYXRlZCBgVXNlclBhZ2VgIGJ1Y2tldHMgKCMzNTgpLCBzbyBgZ2V0X3VzZXJzYCBjYW4gYm91bmQKaXRzIHNjYW4gdG8gbGl2ZSBwYWdlcyB3aGlsZSB0aGUgdXNlciBsaXN0aW5nIHN0YXlzIG91dCBvZiB0aGUKZXZlci1ncm93aW5nIGluc3RhbmNlIHZlY3Rvci4AAAAJUGFnZUNvdW50AAAAAAAAAQAAAQpQZXItc2Vhc29uIGJvdW5kZWQgbGVhZGVyYm9hcmQgKCMzNzEpOiBzYW1lIGBWZWM8KEFkZHJlc3MsIHU2NCk+YApzaGFwZSBhcyBbYERhdGFLZXk6OlRvcFVzZXJzYF0sIGtleWVkIGJ5IHNlYXNvbiwgc28gaGlzdG9yaWNhbCBzZWFzb25zCnN0YXkgcXVlcnlhYmxlIGFmdGVyIGEgbmV3IHNlYXNvbiBzdGFydHMuIEluc3RhbmNlIHN0b3JhZ2UsIGxpa2UKYFRvcFVzZXJzYCwgc28gdGhlIGJvYXJkcyBsaXZlIGFzIGxvbmcgYXMgdGhlIGNvbnRyYWN0IGluc3RhbmNlLgAAAAAACVNlYXNvblRvcAAAAAAAAAEAAAAEAAAAAAAAAENDdXJyZW50IHNlYXNvbiBjb3VudGVyICgjMzcxKS4gSW5zdGFuY2Ugc3RvcmFnZTsgYWJzZW50ID0gc2Vhc29uIDAuAAAAAAZTZWFzb24AAAAAAAAAAAAAAAAAClRvdGFsVXNlcnMAAAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAMUGVuZGluZ0FkbWluAAAAAAAAAAAAAAALSW5pdGlhbGl6ZWQAAAAAAAAAAAAAAAAHV3JpdGVycwA=",
        "AAAAAQAAAAAAAAAAAAAAB1dyaXRlcnMAAAAAAgAAAAAAAAAHYWNjcnVhbAAAAAATAAAAAAAAAAdib3RfbmZ0AAAAABM=",
        "AAAAAAAAAAAAAAAKYWRkX3BvaW50cwAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAABnBvaW50cwAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X3BvaW50cwAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAAAYAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAGZDdXJyZW50IHNlYXNvbiBjb3VudGVyICgjMzcxKS4gU2Vhc29uIDAgaXMgaW4gZWZmZWN0IHVudGlsCltgU2VsZjo6c3RhcnRfbmV3X3NlYXNvbmBdIGlzIGZpcnN0IGNhbGxlZC4AAAAAAApnZXRfc2Vhc29uAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAKc2V0X3BvaW50cwAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAABXZhbHVlAAAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKdW5yZWdpc3RlcgAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAAAAAAALZ2V0X3dyaXRlcnMAAAAAAAAAAAEAAAPoAAAH0AAAAAdXcml0ZXJzAA==",
        "AAAAAAAAAAAAAAALc2V0X3dyaXRlcnMAAAAAAgAAAAAAAAAHYWNjcnVhbAAAAAATAAAAAAAAAAdib3RfbmZ0AAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAAAAAAALdG90YWxfdXNlcnMAAAAAAAAAAAEAAAAE",
        "AAAAAAAAALlTdGVwIHR3byBvZiBhIHR3by1zdGVwIGFkbWluIHRyYW5zZmVyIChBTS0wMzEpOiB0aGUgbm9taW5hdGVkIHBlbmRpbmcKYWRtaW4gYWNjZXB0cyBhbmQgYmVjb21lcyB0aGUgYWN0aXZlIGFkbWluLiBGYWlscyB3aXRoCltgUmVnaXN0cnlFcnJvcjo6Tm9QZW5kaW5nQWRtaW5gXSBpZiBubyB0cmFuc2ZlciBpcyBwZW5kaW5nLgAAAAAAAAxhY2NlcHRfYWRtaW4AAAAAAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAMYnVtcF9wcm9maWxlAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAAAAAAANZ2V0X2JvdF9jb3VudAAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+kAAAAEAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAccjMzcyOiByZWdpc3RyYXRpb24gY2hlY2sgcGVyZm9ybXMgdGhlICpzYW1lKiByZWFkIGBnZXRfdXNlcmAgcGVyZm9ybXMKKGEgcGVyc2lzdGVudCBgLmdldCgpYCksIHNvIHRoZSB0d28gY2FuIG5ldmVyIGRpc2FncmVlIGFib3V0IGFuCmFkZHJlc3Mg4oCUIGJvdGggc2VlIHRoZSBwcm9maWxlLCBvciBib3RoIHNlZSBpdCBhcyBhYnNlbnQvYXJjaGl2ZWQuCgpCb3RoIGZ1bmN0aW9ucyBhcmUgKiphcmNoaXZhbC1zZW5zaXRpdmUqKjogaWYgYSBwcm9maWxlJ3MgVFRMIGxhcHNlcywKdGhlIHBlcnNpc3RlbnQgZW50cnkgaXMgYXJjaGl2ZWQgYW5kIGJvdGggcmVhZHMgZmFpbCBpZGVudGljYWxseQoob24gbWFpbm5ldCB0aGUgdHJhbnNhY3Rpb24gbmV2ZXIgcmVhY2hlcyB0aGUgY29udHJhY3QpLiBLZWVwIGFueQpmdXR1cmUgcmVnaXN0cmF0aW9uIHByb2JlIGJhc2VkIG9uIHRoaXMgc2FtZSByZWFkLgAAAAANaXNfcmVnaXN0ZXJlZAAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAE=",
        "AAAAAAAAAFlSZXR1cm5zIHRoZSBhZGRyZXNzIG5vbWluYXRlZCBieSBbYFNlbGY6OnNldF9hZG1pbmBdLCBpZiBhIHRyYW5zZmVyIGlzCmN1cnJlbnRseSBwZW5kaW5nLgAAAAAAAA1wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAQAAAMFPbmUgcm93IG9mIGEgc2Vhc29uIGxlYWRlcmJvYXJkICgjMzcxKS4gYHNlYXNvbl9wb2ludHNgIGlzIHdoYXQgdGhlIHJvdyBpcwpyYW5rZWQgYnk7IGB0b3RhbF9wb2ludHNgIGlzIHRoZSB1c2VyJ3MgbGlmZXRpbWUgdG90YWwsIGNhcnJpZWQgYWxvbmdzaWRlCnNvIGEgVUkgY2FuIHNob3cgYm90aCB3aXRob3V0IGEgc2Vjb25kIGNhbGwuAAAAAAAAAAAAAAtTZWFzb25FbnRyeQAAAAAEAAAAAAAAAAdhZGRyZXNzAAAAABMAAAA9RGlzcGxheSB1c2VybmFtZSwgb3JpZ2luYWwgY2FzaW5nIHByZXNlcnZlZCAoYGRpc3BsYXlfbmFtZWApLgAAAAAAAAxkaXNwbGF5X25hbWUAAAAQAAAAAAAAAA1zZWFzb25fcG9pbnRzAAAAAAAABgAAAAAAAAAMdG90YWxfcG9pbnRzAAAABg==",
        "AAAAAQAAAv1QZXItdXNlciBwcm9maWxlIHN0b3JlZCBpbiBwZXJzaXN0ZW50IHN0b3JhZ2UuCgojIE51bWVyaWMgdHlwZSByYXRpb25hbGUgKGB0b3RhbF9wb2ludHM6IHU2NGAgdnMgYGNsYWltZWRfYW10OiBpMTI4YCkKLSBgdG90YWxfcG9pbnRzYCBpcyBgdTY0YDogcG9pbnRzIGFyZSBhIG5vbi1uZWdhdGl2ZSBpbnRlcm5hbCBhY2NvdW50aW5nCmNvdW50ZXIgYWNjcnVlZCBmcm9tIGJvdCByYXRlcyAoYHU2NGAgcG9pbnRzL3NlYyDDlyBlbGFwc2VkIGB1NjRgIHNlY29uZHMpCmFuZCBuZXZlciBwYXJ0aWNpcGF0ZSBpbiBTRVAtNDEgdG9rZW4gYXJpdGhtZXRpYy4KLSBgY2xhaW1lZF9hbXRgIHN0YXlzIGBpMTI4YDogYWNyb3NzIFNvcm9iYW4gYW5kIFNFUC00MSAoYHNvcm9iYW5fc2RrOjp0b2tlbmApLAp0b2tlbiBiYWxhbmNlcyBhbmQgdHJhbnNmZXIvbWludCBhbW91bnRzIGFyZSBjYW5vbmljYWxseSBgaTEyOGAgKHNjYWxlZCBieQpgMTBeZGVjaW1hbHNgKS4gS2VlcGluZyBgY2xhaW1lZF9hbXRgIGFzIGBpMTI4YCBtYXRjaGVzIHRoZSBBTVQgdG9rZW4KY29udHJhY3QncyBgbWludGAvYGJhbGFuY2VgIHNpZ25hdHVyZSB3aXRob3V0IG5hcnJvd2luZyBjYXN0cywgd2hpbGUKW2BSZWdpc3RyeUNvbnRyYWN0OjphZGRfY2xhaW1lZF9hbXRgXSByZWplY3RzIG5lZ2F0aXZlIHZhbHVlcyB3aXRoCltgUmVnaXN0cnlFcnJvcjo6TmVnYXRpdmVBbW91bnRgXSBzbyB0aGUgY3VtdWxhdGl2ZSBjbGFpbWVkIHRvdGFsIGlzCnByb3ZhYmx5IG1vbm90b25pYy4AAAAAAAAAAAAAC1VzZXJQcm9maWxlAAAAAAcAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAJYm90X2NvdW50AAAAAAAABAAAAAAAAAALY2xhaW1lZF9hbXQAAAAACwAAAG9UaGUgdXNlcm5hbWUgZXhhY3RseSBhcyB0aGUgdXNlciByZWdpc3RlcmVkIGl0LCBjYXNpbmcgcHJlc2VydmVkCigjMzczKS4gTmV2ZXIgdXNlZCBmb3IgdW5pcXVlbmVzcyBjb21wYXJpc29ucy4AAAAADGRpc3BsYXlfbmFtZQAAABAAAAAAAAAADXJlZ2lzdGVyZWRfYXQAAAAAAAAGAAAAAAAAAAx0b3RhbF9wb2ludHMAAAAGAAAAnE5vcm1hbGl6ZWQgKEFTQ0lJLWxvd2VyY2FzZWQpIHVzZXJuYW1lIOKAlCB0aGUgY2Fub25pY2FsIGlkZW50aXR5IHVzZWQKZm9yIHVuaXF1ZW5lc3MgKCMzNzMpLiBEaXNwbGF5IHRoZSBvcmlnaW5hbCBjYXNpbmcgdmlhCltgVXNlclByb2ZpbGU6OmRpc3BsYXlfbmFtZWBdLgAAAAh1c2VybmFtZQAAABA=",
        "AAAAAAAAAOFBZGQgbmV3bHkgY2xhaW1lZCBBTVQgKGluIHRva2VuIGJhc2UgdW5pdHMsIGBpMTI4YCBwZXIgU0VQLTQxIGNvbnZlbnRpb24pCnRvIGB1c2VyYCdzIGN1bXVsYXRpdmUgYGNsYWltZWRfYW10YC4gUmVqZWN0cyBuZWdhdGl2ZSBhbW91bnRzIHdpdGgKW2BSZWdpc3RyeUVycm9yOjpOZWdhdGl2ZUFtb3VudGBdIHNvIGBjbGFpbWVkX2FtdGAgaXMgbW9ub3RvbmljYWxseQpub24tZGVjcmVhc2luZy4AAAAAAAAPYWRkX2NsYWltZWRfYW10AAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAAAAAAAPZ2V0X2NsYWltZWRfYW10AAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+kAAAALAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAARtUb3AgdXNlcnMgYnkgcG9pbnRzLCBoaWdoZXN0IGZpcnN0LiBSZWFkcyB0aGUgbWFpbnRhaW5lZCBgVG9wVXNlcnNgCmxpc3QgYW5kIGh5ZHJhdGVzIGF0IG1vc3QgYG1pbihsaW1pdCwgTEVBREVSQk9BUkRfU0laRSlgIHByb2ZpbGVzLCBzbyB0aGUKY29zdCBkb2VzIG5vdCBkZXBlbmQgb24gdGhlIHRvdGFsIG51bWJlciBvZiB1c2Vycy4gRXF1YWwgdG90YWxzIGFyZQpvcmRlcmVkIGJ5IHdobyByZWFjaGVkIHRoZSB0b3RhbCBmaXJzdCAoZWFybGllciB3aW5zKSwgZGV0ZXJtaW5pc3RpY2FsbHkuAAAAAA9nZXRfbGVhZGVyYm9hcmQAAAAAAQAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAfQAAAAC1VzZXJQcm9maWxlAA==",
        "AAAAAAAAAI5GZXRjaCBwcm9maWxlcyBmb3IgdXAgdG8gYE1BWF9VU0VSU19CQVRDSGAgYWRkcmVzc2VzIGluIGEgc2luZ2xlIGNhbGwsCmluIHRoZSBzYW1lIG9yZGVyIGFzIGBhZGRyZXNzZXNgLiBVbnJlZ2lzdGVyZWQgYWRkcmVzc2VzIG1hcCB0byBgTm9uZWAuAAAAAAAPZ2V0X3VzZXJzX2JhdGNoAAAAAAEAAAAAAAAACWFkZHJlc3NlcwAAAAAAA+oAAAATAAAAAQAAA+kAAAPqAAAD6AAAB9AAAAALVXNlclByb2ZpbGUAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAABAAAAAAAAAAAAAAADVJlZ2lzdHJ5RXJyb3IAAAAAAAALAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEUFscmVhZHlSZWdpc3RlcmVkAAAAAAAAAgAAAAAAAAANVXNlcm5hbWVUYWtlbgAAAAAAAAMAAAAAAAAADU5vdFJlZ2lzdGVyZWQAAAAAAAAEAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAAFAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAABgAAAFxUaGUgcmVnaXN0ZXJlZC11c2VyIGNvdW50ZXIgaGFzIHJlYWNoZWQgYHUzMjo6TUFYYCwgb3IgYSBwb2ludHMgdXBkYXRlCndvdWxkIG92ZXJmbG93IGB1NjRgLgAAAAhPdmVyZmxvdwAAAAcAAABHTW9yZSB0aGFuIGBNQVhfVVNFUlNfQkFUQ0hgIGFkZHJlc3NlcyB3ZXJlIHBhc3NlZCB0byBgZ2V0X3VzZXJzX2JhdGNoYC4AAAAADUJhdGNoVG9vTGFyZ2UAAAAAAAAIAAAALE5lZ2F0aXZlIGFtb3VudCBwYXNzZWQgdG8gYGFkZF9jbGFpbWVkX2FtdGAuAAAADk5lZ2F0aXZlQW1vdW50AAAAAAAJAAAASmBhY2NlcHRfYWRtaW5gIG9yIGBjYW5jZWxfYWRtaW5fdHJhbnNmZXJgIGNhbGxlZCB3aXRoIG5vIHBlbmRpbmcgdHJhbnNmZXIuAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAAAoAAABDQSBzaW5nbGUgYGFkZF9wb2ludHNgIHVwZGF0ZSBleGNlZWRlZCBgTUFYX1BPSU5UU19QRVJfQ0FMTGAgKCMzNjMpLgAAAAARSW1wbGF1c2libGVQb2ludHMAAAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADVVzZXJUb21ic3RvbmUAAAAAAAAFAAAAAAAAAAdhZGRyZXNzAAAAABMAAAAAAAAAC2NsYWltZWRfYW10AAAAAAsAAAAAAAAADHRvdGFsX3BvaW50cwAAAAYAAAAAAAAAD3VucmVnaXN0ZXJlZF9hdAAAAAAGAAAAAAAAAAh1c2VybmFtZQAAABA=",
        "AAAAAAAAAc9Sb2xsIHRoZSByZWdpc3RyeSBvdmVyIHRvIHRoZSBuZXh0IHNlYXNvbiAoIzM3MSkuIEFkbWluLW9ubHkuCgpJbmNyZW1lbnRzIHRoZSBzZWFzb24gY291bnRlciBhbmQgc3RhcnRzIHRoZSBuZXcgc2Vhc29uJ3MgbGVhZGVyYm9hcmQKZW1wdHk6IHNlYXNvbiBwb2ludHMgYXJlIHN0b3JlZCB1bmRlciBgRGF0YUtleTo6U2Vhc29uUG9pbnRzKHNlYXNvbiwKdXNlcilgLCBzbyBhIGZyZXNoIHNlYXNvbiBudW1iZXIgbWVhbnMgZXZlcnkgdXNlciBzdGFydHMgZnJvbSB6ZXJvCndoaWxlIGxpZmV0aW1lIGB0b3RhbF9wb2ludHNgIGFuZCBldmVyeSBwYXN0IHNlYXNvbidzIGJvYXJkCihgU2Vhc29uVG9wYC9gU2Vhc29uUG9pbnRzYCBrZXllZCBieSB0aGUgb2xkIG51bWJlcikgcmVtYWluIGludGFjdCBhbmQKcXVlcnlhYmxlLiBSZXR1cm5zIHRoZSBuZXcgc2Vhc29uIG51bWJlciBhbmQgZW1pdHMgYG5ld3NlYXNvbmAuAAAAABBzdGFydF9uZXdfc2Vhc29uAAAAAAAAAAEAAAPpAAAABAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAATZGVjcmVtZW50X2JvdF9jb3VudAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAATaW5jcmVtZW50X2JvdF9jb3VudAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAJdDYW5jZWwgYW4gaW4tZmxpZ2h0IGFkbWluIHRyYW5zZmVyIChBTS0wMzEpLiBPbmx5IHRoZSBjdXJyZW50IGFkbWluIG1heQpjYW5jZWw7IGZhaWxzIHdpdGggW2BSZWdpc3RyeUVycm9yOjpOb1BlbmRpbmdBZG1pbmBdIGlmIG5vIHRyYW5zZmVyIGlzCnBlbmRpbmcuAAAAABVjYW5jZWxfYWRtaW5fdHJhbnNmZXIAAAAAAAAAAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAVVUb3AgdXNlcnMgYnkgKipzZWFzb24qKiBwb2ludHMsIGhpZ2hlc3QgZmlyc3QgKCMzNzEpLiBSZWFkcyB0aGUKbWFpbnRhaW5lZCBgU2Vhc29uVG9wKHNlYXNvbilgIGxpc3Qg4oCUIHNhbWUgYm91bmRlZCwgTyhMRUFERVJCT0FSRF9TSVpFKQpoeWRyYXRpb24gYXMgW2BTZWxmOjpnZXRfbGVhZGVyYm9hcmRgXSDigJQgc28gdGhlIGNvc3QgZG9lcyBub3QgZGVwZW5kIG9uCnRoZSB0b3RhbCBudW1iZXIgb2YgdXNlcnMsIGFuZCBoaXN0b3JpY2FsIHNlYXNvbnMgc3RheSBxdWVyeWFibGUuCkVxdWFsIHNlYXNvbiB0b3RhbHMgYXJlIG9yZGVyZWQgYnkgd2hvIHJlYWNoZWQgdGhlIHRvdGFsIGZpcnN0LgAAAAAAABpnZXRfbGVhZGVyYm9hcmRfZm9yX3NlYXNvbgAAAAAAAgAAAAAAAAAGc2Vhc29uAAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAB9AAAAALU2Vhc29uRW50cnkA" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_rank: this.txFromJSON<Result<u32>>,
        get_user: this.txFromJSON<Result<UserProfile>>,
        register: this.txFromJSON<Result<void>>,
        admin: this.txFromJSON<Result<string>>,
        get_users: this.txFromJSON<Array<string>>,
        set_admin: this.txFromJSON<Result<void>>,
        add_points: this.txFromJSON<Result<void>>,
        get_points: this.txFromJSON<Result<u64>>,
        get_season: this.txFromJSON<u32>,
        initialize: this.txFromJSON<Result<void>>,
        set_points: this.txFromJSON<Result<void>>,
        unregister: this.txFromJSON<Result<void>>,
        get_writers: this.txFromJSON<Option<Writers>>,
        set_writers: this.txFromJSON<Result<void>>,
        total_users: this.txFromJSON<u32>,
        accept_admin: this.txFromJSON<Result<void>>,
        bump_profile: this.txFromJSON<Result<void>>,
        get_bot_count: this.txFromJSON<Result<u32>>,
        is_registered: this.txFromJSON<boolean>,
        pending_admin: this.txFromJSON<Option<string>>,
        add_claimed_amt: this.txFromJSON<Result<void>>,
        get_claimed_amt: this.txFromJSON<Result<i128>>,
        get_leaderboard: this.txFromJSON<Array<UserProfile>>,
        get_users_batch: this.txFromJSON<Result<Array<Option<UserProfile>>>>,
        start_new_season: this.txFromJSON<Result<u32>>,
        decrement_bot_count: this.txFromJSON<Result<void>>,
        increment_bot_count: this.txFromJSON<Result<void>>,
        cancel_admin_transfer: this.txFromJSON<Result<void>>,
        get_leaderboard_for_season: this.txFromJSON<Array<SeasonEntry>>
  }
}