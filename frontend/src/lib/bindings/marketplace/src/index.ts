// @ts-nocheck
import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
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
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





export interface Config {
  admin: string;
  bot_nft: string;
  fee_bps: u32;
}

export type DataKey = {tag: "Listing", values: readonly [u64]} | {tag: "ActiveListings", values: void} | {tag: "UserListings", values: readonly [string]} | {tag: "UserPurchases", values: readonly [string]} | {tag: "NextListingId", values: void} | {tag: "Config", values: void} | {tag: "Initialized", values: void} | {tag: "MinPrice", values: readonly [string]};


export interface Listing {
  active: boolean;
  bot_id: u64;
  bot_tier: BotTier;
  currency: string;
  id: u64;
  listed_at: u64;
  price: i128;
  seller: string;
}


export interface Purchase {
  bot_id: u64;
  currency: string;
  listing_id: u64;
  price: i128;
  purchased_at: u64;
  seller: string;
}

export const MarketplaceError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidPrice"},
  4: {message:"BotTransferFailed"},
  5: {message:"ListingNotFound"},
  6: {message:"NotSeller"},
  7: {message:"ListingInactive"},
  8: {message:"InsufficientFunds"},
  9: {message:"ListingNotActive"},
  10: {message:"Unauthorized"},
  11: {message:"PaymentFailed"},
  12: {message:"Overflow"},
  13: {message:"PriceTooLow"},
  14: {message:"ListingStale"},
  15: {message:"SelfPurchase"}
}

export enum Tier {
  Basic = 0,
  Advanced = 1,
  Premium = 2,
}


export interface BotNFT {
  accrual_rate: u64;
  /**
 * Deterministic bonus bps (0..500) on top of the tier base accrual rate.
 */
bonus_bps: u32;
  id: u64;
  minted_at: u64;
  name: string;
  owner: string;
  tier: BotTier;
  /**
 * Deterministic variant (0..=7) assigned at mint, used for rarity.
 */
variant: u32;
}

export enum BotTier {
  Basic = 0,
  Bronze = 1,
  Silver = 2,
  Gold = 3,
  Diamond = 4,
}

export type DataKey = {tag: "NextId", values: void} | {tag: "Bot", values: readonly [u64]} | {tag: "UserBots", values: readonly [string]} | {tag: "Admin", values: void} | {tag: "Initialized", values: void} | {tag: "Registry", values: void} | {tag: "TierSupply", values: readonly [BotTier]};

export const BotNFTError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotFound"},
  3: {message:"Unauthorized"},
  4: {message:"InvalidTier"},
  5: {message:"BotNotFound"},
  6: {message:"NotOwner"},
  7: {message:"InsufficientFunds"},
  8: {message:"NotInitialized"},
  9: {message:"SupplyCapExceeded"},
  10: {message:"BatchTooLarge"}
}

export type DataKey = {tag: "UserProfile", values: readonly [string]} | {tag: "Username", values: readonly [string]} | {tag: "UserList", values: void} | {tag: "TotalUsers", values: void} | {tag: "Admin", values: void} | {tag: "Initialized", values: void} | {tag: "Writers", values: void};


export interface Writers {
  accrual: string;
  bot_nft: string;
}


export interface UserProfile {
  address: string;
  bot_count: u32;
  claimed_amt: i128;
  registered_at: u64;
  total_points: u64;
  username: string;
}

export const RegistryError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"AlreadyRegistered"},
  3: {message:"UsernameTaken"},
  4: {message:"NotRegistered"},
  5: {message:"Unauthorized"},
  6: {message:"NotInitialized"}
}

export interface Client {
  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Config>>

  /**
   * Construct and simulate a buy_bot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  buy_bot: ({buyer, listing_id}: {buyer: string, listing_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a list_bot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Escrow `bot_id` from `seller` into the marketplace contract, record a
   * `Listing` at `price` in `currency`, and return the new listing ID.
   */
  list_bot: ({seller, bot_id, price, currency}: {seller: string, bot_id: u64, price: i128, currency: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the admin and bot_nft addresses. Fails with `AlreadyInitialized` if
   * called twice.
   */
  initialize: ({admin, bot_nft, fee_bps}: {admin: string, bot_nft: string, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_listing transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieve a listing by ID. Historical listings (bought/cancelled/stale)
   * remain readable with `active == false`; only an ID that was never
   * assigned returns `ListingNotFound`. This is intentional (see module
   * docs): auditability over hiding.
   */
  get_listing: ({listing_id}: {listing_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Listing>>>

  /**
   * Construct and simulate a set_bot_nft transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_bot_nft: ({new_bot_nft}: {new_bot_nft: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_bps: ({new_fee_bps}: {new_fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_min_price transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the configured minimum price for `currency`. If the admin has not
   * set an explicit floor, the default `ceil(10_000/fee_bps)` (or `1` when
   * `fee_bps == 0`) is returned. Every accepted price guarantees
   * `price * fee_bps / 10_000 >= 1` when `fee_bps > 0`.
   */
  get_min_price: ({currency}: {currency: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_min_price transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: set the minimum price for `currency`. `min_price` must be
   * strictly positive. Emits `min_price_updated`.
   */
  set_min_price: ({currency, min_price}: {currency: string, min_price: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_listing transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_listing: ({seller, listing_id}: {seller: string, listing_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a next_listing_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the next listing ID that will be assigned (i.e. `NextListingId`).
   * This is the public enumeration cursor — tooling should use it instead of
   * scanning `get_listing` over an unbounded range. The value is `1` before
   * any listing has been created.
   */
  next_listing_id: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_user_listings transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_listings: ({seller}: {seller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Listing>>>

  /**
   * Construct and simulate a get_user_purchases transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_purchases: ({buyer, limit}: {buyer: string, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Purchase>>>

  /**
   * Construct and simulate a get_active_listings transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return up to `limit` active listings, skipping the first `start` entries
   * of the active-listings index.
   * 
   * Input validation / edge-case handling (issue #120):
   * - `limit == 0`: a request for zero items is trivially satisfied, so we
   * return an empty vec immediately rather than treating it as an error.
   * - `start` beyond the number of active listings: the index iteration
   * simply skips every entry and yields an empty vec — no panic.
   * - Stale index entry (an id in `ActiveListings` whose `Listing(id)` record
   * was removed from persistent storage): skipped gracefully via the
   * `if let Some(l)` guard.
   * - An id still present in the index but whose listing has `active == false`:
   * filtered out by the `if l.active` check.
   * 
   * Every edge case degrades gracefully to an empty/partial result, so there
   * is no genuine failure condition to signal. The return type stays
   * `Vec<Listing>` (rather than `Result<..>`) to avoid needless API churn for
   * callers.
   */
  get_active_listings: ({start, limit}: {start: u64, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Listing>>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_bot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bot: ({bot_id}: {bot_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<BotNFT>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({bot_id, from, to}: {bot_id: u64, from: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a mint_tier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint_tier: ({owner, tier, token}: {owner: string, tier: Tier, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a token_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Off-chain verifiable descriptor. The traits are derived deterministically
   * from sha256(bot_id, minted_at, owner); this URI exposes the derivation
   * inputs so anyone can recompute `variant`/`bonus_bps` and confirm rarity.
   */
  token_uri: ({bot_id}: {bot_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a admin_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-controlled mint (no payment) for airdrops / grants. Distinguishable
   * from a purchase via the `grant` event.
   */
  admin_mint: ({to, tier}: {to: string, tier: BotTier}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, registry}: {admin: string, registry: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a mint_basic transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint_basic: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_tier_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_tier_info: ({tier}: {tier: BotTier}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [string, u64, i128]>>

  /**
   * Construct and simulate a get_user_bots transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_bots: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a admin_mint_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Batch admin mint for airdrops. All-or-nothing: if any single mint fails
   * (e.g. supply cap), the whole batch is rolled back. Capped by MAX_BATCH_SIZE.
   */
  admin_mint_batch: ({recipients}: {recipients: Array<readonly [string, BotTier]>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<u64>>>>

  /**
   * Construct and simulate a get_user_total_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_total_rate: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_user_bots_detailed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Full `BotNFT` records for up to the first `MAX_DETAILED_BOTS` bots
   * owned by `user`, in ownership order. Replaces the N+1 fan-out of
   * `get_user_bots` + `get_bot` with a single simulation; the cap is
   * enforced here, contract-side, and callers paginate past it with the
   * ID-based getters (#483).
   */
  get_user_bots_detailed: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<BotNFT>>>

  /**
   * Construct and simulate a get_user transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<UserProfile>>>

  /**
   * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register: ({user, username}: {user: string, username: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a add_points transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_points: ({user, points}: {user: string, points: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_writers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_writers: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Writers>>>

  /**
   * Construct and simulate a set_writers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_writers: ({accrual, bot_nft}: {accrual: string, bot_nft: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a total_users transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_users: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a is_registered transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_registered: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_claimed_amt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_claimed_amt: ({user, amount}: {user: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_leaderboard transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_leaderboard: ({limit}: {limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<UserProfile>>>

  /**
   * Construct and simulate a decrement_bot_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decrement_bot_count: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a increment_bot_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  increment_bot_count: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAGQ29uZmlnAAA=",
        "AAAAAAAAAAAAAAAHYnV5X2JvdAAAAAACAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAACmxpc3RpbmdfaWQAAAAAAAYAAAABAAAD6QAAA+0AAAAAAAAH0AAAABBNYXJrZXRwbGFjZUVycm9y",
        "AAAAAAAAAIhFc2Nyb3cgYGJvdF9pZGAgZnJvbSBgc2VsbGVyYCBpbnRvIHRoZSBtYXJrZXRwbGFjZSBjb250cmFjdCwgcmVjb3JkIGEKYExpc3RpbmdgIGF0IGBwcmljZWAgaW4gYGN1cnJlbmN5YCwgYW5kIHJldHVybiB0aGUgbmV3IGxpc3RpbmcgSUQuAAAACGxpc3RfYm90AAAABAAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAZib3RfaWQAAAAAAAYAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAIY3VycmVuY3kAAAATAAAAAQAAA+kAAAAGAAAH0AAAABBNYXJrZXRwbGFjZUVycm9y",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdib3RfbmZ0AAAAABMAAAAAAAAAB2ZlZV9icHMAAAAABA==",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAEE1hcmtldHBsYWNlRXJyb3I=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAEAAAAAAAAAB0xpc3RpbmcAAAAAAQAAAAYAAAAAAAAAAAAAAA5BY3RpdmVMaXN0aW5ncwAAAAAAAQAAAAAAAAAMVXNlckxpc3RpbmdzAAAAAQAAABMAAAABAAAAAAAAAA1Vc2VyUHVyY2hhc2VzAAAAAAAAAQAAABMAAAAAAAAAAAAAAA1OZXh0TGlzdGluZ0lkAAAAAAAAAAAAAAAAAAAGQ29uZmlnAAAAAAAAAAAAAAAAAAtJbml0aWFsaXplZAAAAAABAAAAAAAAAAhNaW5QcmljZQAAAAEAAAAT",
        "AAAAAQAAAAAAAAAAAAAAB0xpc3RpbmcAAAAACAAAAAAAAAAGYWN0aXZlAAAAAAABAAAAAAAAAAZib3RfaWQAAAAAAAYAAAAAAAAACGJvdF90aWVyAAAH0AAAAAdCb3RUaWVyAAAAAAAAAAAIY3VycmVuY3kAAAATAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAJbGlzdGVkX2F0AAAAAAAABgAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAZzZWxsZXIAAAAAABM=",
        "AAAAAAAAAFVTZXQgdGhlIGFkbWluIGFuZCBib3RfbmZ0IGFkZHJlc3Nlcy4gRmFpbHMgd2l0aCBgQWxyZWFkeUluaXRpYWxpemVkYCBpZgpjYWxsZWQgdHdpY2UuAAAAAAAACmluaXRpYWxpemUAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHYm90X25mdAAAAAATAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAABAAAD6QAAA+0AAAAAAAAH0AAAABBNYXJrZXRwbGFjZUVycm9y",
        "AAAAAQAAAAAAAAAAAAAACFB1cmNoYXNlAAAABgAAAAAAAAAGYm90X2lkAAAAAAAGAAAAAAAAAAhjdXJyZW5jeQAAABMAAAAAAAAACmxpc3RpbmdfaWQAAAAAAAYAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAMcHVyY2hhc2VkX2F0AAAABgAAAAAAAAAGc2VsbGVyAAAAAAAT",
        "AAAAAAAAAO1SZXRyaWV2ZSBhIGxpc3RpbmcgYnkgSUQuIEhpc3RvcmljYWwgbGlzdGluZ3MgKGJvdWdodC9jYW5jZWxsZWQvc3RhbGUpCnJlbWFpbiByZWFkYWJsZSB3aXRoIGBhY3RpdmUgPT0gZmFsc2VgOyBvbmx5IGFuIElEIHRoYXQgd2FzIG5ldmVyCmFzc2lnbmVkIHJldHVybnMgYExpc3RpbmdOb3RGb3VuZGAuIFRoaXMgaXMgaW50ZW50aW9uYWwgKHNlZSBtb2R1bGUKZG9jcyk6IGF1ZGl0YWJpbGl0eSBvdmVyIGhpZGluZy4AAAAAAAALZ2V0X2xpc3RpbmcAAAAAAQAAAAAAAAAKbGlzdGluZ19pZAAAAAAABgAAAAEAAAPpAAAH0AAAAAdMaXN0aW5nAAAAB9AAAAAQTWFya2V0cGxhY2VFcnJvcg==",
        "AAAAAAAAAAAAAAALc2V0X2JvdF9uZnQAAAAAAQAAAAAAAAALbmV3X2JvdF9uZnQAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAEE1hcmtldHBsYWNlRXJyb3I=",
        "AAAAAAAAAAAAAAALc2V0X2ZlZV9icHMAAAAAAQAAAAAAAAALbmV3X2ZlZV9icHMAAAAABAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAEE1hcmtldHBsYWNlRXJyb3I=",
        "AAAAAAAAAQBSZXR1cm4gdGhlIGNvbmZpZ3VyZWQgbWluaW11bSBwcmljZSBmb3IgYGN1cnJlbmN5YC4gSWYgdGhlIGFkbWluIGhhcyBub3QKc2V0IGFuIGV4cGxpY2l0IGZsb29yLCB0aGUgZGVmYXVsdCBgY2VpbCgxMF8wMDAvZmVlX2JwcylgIChvciBgMWAgd2hlbgpgZmVlX2JwcyA9PSAwYCkgaXMgcmV0dXJuZWQuIEV2ZXJ5IGFjY2VwdGVkIHByaWNlIGd1YXJhbnRlZXMKYHByaWNlICogZmVlX2JwcyAvIDEwXzAwMCA+PSAxYCB3aGVuIGBmZWVfYnBzID4gMGAuAAAADWdldF9taW5fcHJpY2UAAAAAAAABAAAAAAAAAAhjdXJyZW5jeQAAABMAAAABAAAACw==",
        "AAAAAAAAAHNBZG1pbi1vbmx5OiBzZXQgdGhlIG1pbmltdW0gcHJpY2UgZm9yIGBjdXJyZW5jeWAuIGBtaW5fcHJpY2VgIG11c3QgYmUKc3RyaWN0bHkgcG9zaXRpdmUuIEVtaXRzIGBtaW5fcHJpY2VfdXBkYXRlZGAuAAAAAA1zZXRfbWluX3ByaWNlAAAAAAAAAgAAAAAAAAAIY3VycmVuY3kAAAATAAAAAAAAAAltaW5fcHJpY2UAAAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAQTWFya2V0cGxhY2VFcnJvcg==",
        "AAAAAAAAAAAAAAAOY2FuY2VsX2xpc3RpbmcAAAAAAAIAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAKbGlzdGluZ19pZAAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAEE1hcmtldHBsYWNlRXJyb3I=",
        "AAAAAAAAAPlSZXR1cm4gdGhlIG5leHQgbGlzdGluZyBJRCB0aGF0IHdpbGwgYmUgYXNzaWduZWQgKGkuZS4gYE5leHRMaXN0aW5nSWRgKS4KVGhpcyBpcyB0aGUgcHVibGljIGVudW1lcmF0aW9uIGN1cnNvciDigJQgdG9vbGluZyBzaG91bGQgdXNlIGl0IGluc3RlYWQgb2YKc2Nhbm5pbmcgYGdldF9saXN0aW5nYCBvdmVyIGFuIHVuYm91bmRlZCByYW5nZS4gVGhlIHZhbHVlIGlzIGAxYCBiZWZvcmUKYW55IGxpc3RpbmcgaGFzIGJlZW4gY3JlYXRlZC4AAAAAAAAPbmV4dF9saXN0aW5nX2lkAAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAARZ2V0X3VzZXJfbGlzdGluZ3MAAAAAAAABAAAAAAAAAAZzZWxsZXIAAAAAABMAAAABAAAD6gAAB9AAAAAHTGlzdGluZwA=",
        "AAAAAAAAAAAAAAASZ2V0X3VzZXJfcHVyY2hhc2VzAAAAAAACAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAhQdXJjaGFzZQ==",
        "AAAABAAAAAAAAAAAAAAAEE1hcmtldHBsYWNlRXJyb3IAAAAPAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAACAAAAAAAAAAxJbnZhbGlkUHJpY2UAAAADAAAAAAAAABFCb3RUcmFuc2ZlckZhaWxlZAAAAAAAAAQAAAAAAAAAD0xpc3RpbmdOb3RGb3VuZAAAAAAFAAAAAAAAAAlOb3RTZWxsZXIAAAAAAAAGAAAAAAAAAA9MaXN0aW5nSW5hY3RpdmUAAAAABwAAAAAAAAARSW5zdWZmaWNpZW50RnVuZHMAAAAAAAAIAAAAAAAAABBMaXN0aW5nTm90QWN0aXZlAAAACQAAAAAAAAAMVW5hdXRob3JpemVkAAAACgAAAAAAAAANUGF5bWVudEZhaWxlZAAAAAAAAAsAAAAAAAAACE92ZXJmbG93AAAADAAAAAAAAAALUHJpY2VUb29Mb3cAAAAADQAAAAAAAAAMTGlzdGluZ1N0YWxlAAAADgAAAAAAAAAMU2VsZlB1cmNoYXNlAAAADw==",
        "AAAAAAAAA6BSZXR1cm4gdXAgdG8gYGxpbWl0YCBhY3RpdmUgbGlzdGluZ3MsIHNraXBwaW5nIHRoZSBmaXJzdCBgc3RhcnRgIGVudHJpZXMKb2YgdGhlIGFjdGl2ZS1saXN0aW5ncyBpbmRleC4KCklucHV0IHZhbGlkYXRpb24gLyBlZGdlLWNhc2UgaGFuZGxpbmcgKGlzc3VlICMxMjApOgotIGBsaW1pdCA9PSAwYDogYSByZXF1ZXN0IGZvciB6ZXJvIGl0ZW1zIGlzIHRyaXZpYWxseSBzYXRpc2ZpZWQsIHNvIHdlCnJldHVybiBhbiBlbXB0eSB2ZWMgaW1tZWRpYXRlbHkgcmF0aGVyIHRoYW4gdHJlYXRpbmcgaXQgYXMgYW4gZXJyb3IuCi0gYHN0YXJ0YCBiZXlvbmQgdGhlIG51bWJlciBvZiBhY3RpdmUgbGlzdGluZ3M6IHRoZSBpbmRleCBpdGVyYXRpb24Kc2ltcGx5IHNraXBzIGV2ZXJ5IGVudHJ5IGFuZCB5aWVsZHMgYW4gZW1wdHkgdmVjIOKAlCBubyBwYW5pYy4KLSBTdGFsZSBpbmRleCBlbnRyeSAoYW4gaWQgaW4gYEFjdGl2ZUxpc3RpbmdzYCB3aG9zZSBgTGlzdGluZyhpZClgIHJlY29yZAp3YXMgcmVtb3ZlZCBmcm9tIHBlcnNpc3RlbnQgc3RvcmFnZSk6IHNraXBwZWQgZ3JhY2VmdWxseSB2aWEgdGhlCmBpZiBsZXQgU29tZShsKWAgZ3VhcmQuCi0gQW4gaWQgc3RpbGwgcHJlc2VudCBpbiB0aGUgaW5kZXggYnV0IHdob3NlIGxpc3RpbmcgaGFzIGBhY3RpdmUgPT0gZmFsc2VgOgpmaWx0ZXJlZCBvdXQgYnkgdGhlIGBpZiBsLmFjdGl2ZWAgY2hlY2suCgpFdmVyeSBlZGdlIGNhc2UgZGVncmFkZXMgZ3JhY2VmdWxseSB0byBhbiBlbXB0eS9wYXJ0aWFsIHJlc3VsdCwgc28gdGhlcmUKaXMgbm8gZ2VudWluZSBmYWlsdXJlIGNvbmRpdGlvbiB0byBzaWduYWwuIFRoZSByZXR1cm4gdHlwZSBzdGF5cwpgVmVjPExpc3Rpbmc+YCAocmF0aGVyIHRoYW4gYFJlc3VsdDwuLj5gKSB0byBhdm9pZCBuZWVkbGVzcyBBUEkgY2h1cm4gZm9yCmNhbGxlcnMuAAAAE2dldF9hY3RpdmVfbGlzdGluZ3MAAAAAAgAAAAAAAAAFc3RhcnQAAAAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAB9AAAAAHTGlzdGluZwA=",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAwAAAAAAAAAAAAAABFRpZXIAAAADAAAAAAAAAAVCYXNpYwAAAAAAAAAAAAAAAAAACEFkdmFuY2VkAAAAAQAAAAAAAAAHUHJlbWl1bQAAAAAC",
        "AAAAAAAAAAAAAAAHZ2V0X2JvdAAAAAABAAAAAAAAAAZib3RfaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAGQm90TkZUAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAAZib3RfaWQAAAAAAAYAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAQAAAAAAAAAAAAAABkJvdE5GVAAAAAAACAAAAAAAAAAMYWNjcnVhbF9yYXRlAAAABgAAAEZEZXRlcm1pbmlzdGljIGJvbnVzIGJwcyAoMC4uNTAwKSBvbiB0b3Agb2YgdGhlIHRpZXIgYmFzZSBhY2NydWFsIHJhdGUuAAAAAAAJYm9udXNfYnBzAAAAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAACW1pbnRlZF9hdAAAAAAAAAYAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABHRpZXIAAAfQAAAAB0JvdFRpZXIAAAAAQERldGVybWluaXN0aWMgdmFyaWFudCAoMC4uPTcpIGFzc2lnbmVkIGF0IG1pbnQsIHVzZWQgZm9yIHJhcml0eS4AAAAHdmFyaWFudAAAAAAE",
        "AAAAAAAAAAAAAAAJbWludF90aWVyAAAAAAAAAwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAR0aWVyAAAH0AAAAARUaWVyAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAYAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAANlPZmYtY2hhaW4gdmVyaWZpYWJsZSBkZXNjcmlwdG9yLiBUaGUgdHJhaXRzIGFyZSBkZXJpdmVkIGRldGVybWluaXN0aWNhbGx5CmZyb20gc2hhMjU2KGJvdF9pZCwgbWludGVkX2F0LCBvd25lcik7IHRoaXMgVVJJIGV4cG9zZXMgdGhlIGRlcml2YXRpb24KaW5wdXRzIHNvIGFueW9uZSBjYW4gcmVjb21wdXRlIGB2YXJpYW50YC9gYm9udXNfYnBzYCBhbmQgY29uZmlybSByYXJpdHkuAAAAAAAACXRva2VuX3VyaQAAAAAAAAEAAAAAAAAABmJvdF9pZAAAAAAABgAAAAEAAAPpAAAAEAAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAwAAAAAAAAAAAAAAB0JvdFRpZXIAAAAABQAAAAAAAAAFQmFzaWMAAAAAAAAAAAAAAAAAAAZCcm9uemUAAAAAAAEAAAAAAAAABlNpbHZlcgAAAAAAAgAAAAAAAAAER29sZAAAAAMAAAAAAAAAB0RpYW1vbmQAAAAABA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAAAAAAAAAAABk5leHRJZAAAAAAAAQAAAAAAAAADQm90AAAAAAEAAAAGAAAAAQAAAAAAAAAIVXNlckJvdHMAAAABAAAAEwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAALSW5pdGlhbGl6ZWQAAAAAAAAAAAAAAAAIUmVnaXN0cnkAAAABAAAAAAAAAApUaWVyU3VwcGx5AAAAAAABAAAH0AAAAAdCb3RUaWVyAA==",
        "AAAAAAAAAHBBZG1pbi1jb250cm9sbGVkIG1pbnQgKG5vIHBheW1lbnQpIGZvciBhaXJkcm9wcyAvIGdyYW50cy4gRGlzdGluZ3Vpc2hhYmxlCmZyb20gYSBwdXJjaGFzZSB2aWEgdGhlIGBncmFudGAgZXZlbnQuAAAACmFkbWluX21pbnQAAAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAR0aWVyAAAH0AAAAAdCb3RUaWVyAAAAAAEAAAPpAAAABgAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhyZWdpc3RyeQAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAAAAAAAAAAAKbWludF9iYXNpYwAAAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAA+kAAAAGAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAAAAAAAAAAANZ2V0X3RpZXJfaW5mbwAAAAAAAAEAAAAAAAAABHRpZXIAAAfQAAAAB0JvdFRpZXIAAAAAAQAAA+0AAAADAAAAEAAAAAYAAAAL",
        "AAAAAAAAAAAAAAANZ2V0X3VzZXJfYm90cwAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAAG",
        "AAAABAAAAAAAAAAAAAAAC0JvdE5GVEVycm9yAAAAAAoAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAITm90Rm91bmQAAAACAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAADAAAAAAAAAAtJbnZhbGlkVGllcgAAAAAEAAAAAAAAAAtCb3ROb3RGb3VuZAAAAAAFAAAAAAAAAAhOb3RPd25lcgAAAAYAAAAAAAAAEUluc3VmZmljaWVudEZ1bmRzAAAAAAAABwAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAgAAAAAAAAAEVN1cHBseUNhcEV4Y2VlZGVkAAAAAAAACQAAAAAAAAANQmF0Y2hUb29MYXJnZQAAAAAAAAo=",
        "AAAAAAAAAJRCYXRjaCBhZG1pbiBtaW50IGZvciBhaXJkcm9wcy4gQWxsLW9yLW5vdGhpbmc6IGlmIGFueSBzaW5nbGUgbWludCBmYWlscwooZS5nLiBzdXBwbHkgY2FwKSwgdGhlIHdob2xlIGJhdGNoIGlzIHJvbGxlZCBiYWNrLiBDYXBwZWQgYnkgTUFYX0JBVENIX1NJWkUuAAAAEGFkbWluX21pbnRfYmF0Y2gAAAABAAAAAAAAAApyZWNpcGllbnRzAAAAAAPqAAAD7QAAAAIAAAATAAAH0AAAAAdCb3RUaWVyAAAAAAEAAAPpAAAD6gAAAAYAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAAAAAAAATZ2V0X3VzZXJfdG90YWxfcmF0ZQAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAG",
        "AAAAAAAAASFGdWxsIGBCb3RORlRgIHJlY29yZHMgZm9yIHVwIHRvIHRoZSBmaXJzdCBgTUFYX0RFVEFJTEVEX0JPVFNgIGJvdHMKb3duZWQgYnkgYHVzZXJgLCBpbiBvd25lcnNoaXAgb3JkZXIuIFJlcGxhY2VzIHRoZSBOKzEgZmFuLW91dCBvZgpgZ2V0X3VzZXJfYm90c2AgKyBgZ2V0X2JvdGAgd2l0aCBhIHNpbmdsZSBzaW11bGF0aW9uOyB0aGUgY2FwIGlzCmVuZm9yY2VkIGhlcmUsIGNvbnRyYWN0LXNpZGUsIGFuZCBjYWxsZXJzIHBhZ2luYXRlIHBhc3QgaXQgd2l0aCB0aGUKSUQtYmFzZWQgZ2V0dGVycyAoIzQ4MykuAAAAAAAAFmdldF91c2VyX2JvdHNfZGV0YWlsZWQAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAfQAAAABkJvdE5GVAAA",
        "AAAAAAAAAAAAAAAIZ2V0X3VzZXIAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAH0AAAAAtVc2VyUHJvZmlsZQAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAIdXNlcm5hbWUAAAAQAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAEAAAAAAAAAC1VzZXJQcm9maWxlAAAAAAEAAAATAAAAAQAAAAAAAAAIVXNlcm5hbWUAAAABAAAAEAAAAAAAAAAAAAAACFVzZXJMaXN0AAAAAAAAAAAAAAAKVG90YWxVc2VycwAAAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAAAAAAAAAAAAAtJbml0aWFsaXplZAAAAAAAAAAAAAAAAAdXcml0ZXJzAA==",
        "AAAAAQAAAAAAAAAAAAAAB1dyaXRlcnMAAAAAAgAAAAAAAAAHYWNjcnVhbAAAAAATAAAAAAAAAAdib3RfbmZ0AAAAABM=",
        "AAAAAAAAAAAAAAAKYWRkX3BvaW50cwAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAABnBvaW50cwAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANUmVnaXN0cnlFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAALZ2V0X3dyaXRlcnMAAAAAAAAAAAEAAAPoAAAH0AAAAAdXcml0ZXJzAA==",
        "AAAAAAAAAAAAAAALc2V0X3dyaXRlcnMAAAAAAgAAAAAAAAAHYWNjcnVhbAAAAAATAAAAAAAAAAdib3RfbmZ0AAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAAAAAAALdG90YWxfdXNlcnMAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAANaXNfcmVnaXN0ZXJlZAAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAE=",
        "AAAAAQAAAAAAAAAAAAAAC1VzZXJQcm9maWxlAAAAAAYAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAJYm90X2NvdW50AAAAAAAABAAAAAAAAAALY2xhaW1lZF9hbXQAAAAACwAAAAAAAAANcmVnaXN0ZXJlZF9hdAAAAAAAAAYAAAAAAAAADHRvdGFsX3BvaW50cwAAAAYAAAAAAAAACHVzZXJuYW1lAAAAEA==",
        "AAAAAAAAAAAAAAAPYWRkX2NsYWltZWRfYW10AAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1SZWdpc3RyeUVycm9yAAAA",
        "AAAAAAAAAAAAAAAPZ2V0X2xlYWRlcmJvYXJkAAAAAAEAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAtVc2VyUHJvZmlsZQA=",
        "AAAABAAAAAAAAAAAAAAADVJlZ2lzdHJ5RXJyb3IAAAAAAAAGAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEUFscmVhZHlSZWdpc3RlcmVkAAAAAAAAAgAAAAAAAAANVXNlcm5hbWVUYWtlbgAAAAAAAAMAAAAAAAAADU5vdFJlZ2lzdGVyZWQAAAAAAAAEAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAAFAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAABg==",
        "AAAAAAAAAAAAAAATZGVjcmVtZW50X2JvdF9jb3VudAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAATaW5jcmVtZW50X2JvdF9jb3VudAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    config: this.txFromJSON<Config>,
        buy_bot: this.txFromJSON<Result<void>>,
        list_bot: this.txFromJSON<Result<u64>>,
        set_admin: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        get_listing: this.txFromJSON<Result<Listing>>,
        set_bot_nft: this.txFromJSON<Result<void>>,
        set_fee_bps: this.txFromJSON<Result<void>>,
        get_min_price: this.txFromJSON<i128>,
        set_min_price: this.txFromJSON<Result<void>>,
        cancel_listing: this.txFromJSON<Result<void>>,
        next_listing_id: this.txFromJSON<u64>,
        get_user_listings: this.txFromJSON<Array<Listing>>,
        get_user_purchases: this.txFromJSON<Array<Purchase>>,
        get_active_listings: this.txFromJSON<Array<Listing>>,
        admin: this.txFromJSON<Result<string>>,
        get_bot: this.txFromJSON<Result<BotNFT>>,
        transfer: this.txFromJSON<Result<void>>,
        mint_tier: this.txFromJSON<Result<u64>>,
        token_uri: this.txFromJSON<Result<string>>,
        admin_mint: this.txFromJSON<Result<u64>>,
        initialize: this.txFromJSON<Result<void>>,
        mint_basic: this.txFromJSON<Result<u64>>,
        get_tier_info: this.txFromJSON<readonly [string, u64, i128]>,
        get_user_bots: this.txFromJSON<Array<u64>>,
        admin_mint_batch: this.txFromJSON<Result<Array<u64>>>,
        get_user_total_rate: this.txFromJSON<u64>,
        get_user_bots_detailed: this.txFromJSON<Array<BotNFT>>,
        get_user: this.txFromJSON<Result<UserProfile>>,
        register: this.txFromJSON<Result<void>>,
        get_admin: this.txFromJSON<Result<string>>,
        add_points: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        get_writers: this.txFromJSON<Option<Writers>>,
        set_writers: this.txFromJSON<Result<void>>,
        total_users: this.txFromJSON<u32>,
        is_registered: this.txFromJSON<boolean>,
        add_claimed_amt: this.txFromJSON<Result<void>>,
        get_leaderboard: this.txFromJSON<Array<UserProfile>>,
        decrement_bot_count: this.txFromJSON<Result<void>>,
        increment_bot_count: this.txFromJSON<Result<void>>
  }
}