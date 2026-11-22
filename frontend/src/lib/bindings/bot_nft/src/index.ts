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

export interface BotNFT {
  accrual_rate: u64;
  /**
 * Deterministic bonus bps (0..500) on top of the tier base accrual rate.
 */
bonus_bps: u32;
  id: u64;
  minted_at: u64;
  minter: string;
  /**
 * Owner-settable nickname (max 24 bytes). None when unset; callers that
 * need a display name fall back to `tier.name()`.
 */
nickname: Option<string>;
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

export type DataKey = {tag: "NextId", values: void} | {tag: "Bot", values: readonly [u64]} | {tag: "UserBots", values: readonly [string]} | {tag: "Admin", values: void} | {tag: "Initialized", values: void} | {tag: "Registry", values: void} | {tag: "TierSupply", values: readonly [BotTier]} | {tag: "TierRate", values: readonly [BotTier]} | {tag: "Marketplace", values: void} | {tag: "Accrual", values: void} | {tag: "PaymentToken", values: void} | {tag: "TierIndex", values: readonly [BotTier]};


/**
 * Typed tier descriptor returned by `get_tier_info` and `all_tiers`.
 */
export interface TierInfo {
  name: string;
  price: i128;
  rate: u64;
}

export const Errors = {
  1: {message:"AlreadyInitialized"},

  2: {message:"NotFound"},

  3: {message:"Unauthorized"},

  4: {message:"InvalidTier"},

  5: {message:"BotNotFound"},

  6: {message:"NotOwner"},

  7: {message:"InsufficientFunds"},

  8: {message:"NotInitialized"},

  9: {message:"SupplyCapExceeded"},

  10: {message:"BatchTooLarge"},

  11: {message:"NicknameTooLong"},

  12: {message:"RangeLimitExceeded"},

  /**
   * `withdraw` amount was zero or negative.
   */
  13: {message:"InvalidAmount"},

  /**
   * `withdraw` amount exceeds the treasury balance of the payment token.
   */
  14: {message:"InsufficientTreasury"},

  /**
   * The bot id counter has reached `u64::MAX`; no further bot can be minted.
   */
  15: {message:"Overflow"},

  /**
   * The optional per-tier mint cap has been reached.
   */
  16: {message:"TierSoldOut"},

  /**
   * The requested cap is below the current minted supply.
   */
  17: {message:"CapBelowSupply"},

  /**
   * The approval has expired.
   */
  18: {message:"ApprovalExpired"},

  /**
   * The caller is neither the owner, an approved spender, nor an approved operator.
   */
  19: {message:"NotApproved"},

  /**
   * The requested tier rate is zero or outside the permitted adjustment band.
   */
  20: {message:"InvalidRate"}
}

export interface StoredBotNFT {
  bonus_bps: u32;
  id: u64;
  minted_at: u64;
  minter: string;
  nickname: Option<string>;
  owner: string;
  tier: BotTier;
  variant: u32;
}


export interface Client {
  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burn a bot, removing it from storage, decrementing tier supply,
   * removing it from owner's bot list and tier index, and decrementing the owner's
   * count in the registry contract (#398).
   */
  burn: ({bot_id, owner}: {bot_id: u64, owner: string}, options?: {
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
   * Construct and simulate a get_bot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bot: ({bot_id}: {bot_id: u64}, options?: {
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
  }) => Promise<AssembledTransaction<Result<BotNFT>>>

  /**
   * Construct and simulate a next_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The next bot id that will be assigned. Callers use it as the exclusive
   * upper bound when paginating with `get_bots_range` (#391).
   */
  next_id: (options?: {
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
  }) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a bump_bot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionlessly refresh the persistent storage TTL of a single bot (#397).
   */
  bump_bot: ({bot_id}: {bot_id: u64}, options?: {
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
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({bot_id, from, to}: {bot_id: u64, from: string, to: string}, options?: {
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
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only withdrawal of accumulated tier payments (#322).
   * 
   * `mint_tier` uses the payment token stored during initialization. The
   * token address is supplied explicitly here so the balance is checked
   * before transferring; callers should pass the configured payment token.
   */
  withdraw: ({token, to, amount}: {token: string, to: string, amount: i128}, options?: {
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
   * Construct and simulate a all_tiers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every tier's descriptor, in tier order (Basic .. Diamond).
   */
  all_tiers: (options?: {
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
  }) => Promise<AssembledTransaction<Array<TierInfo>>>

  /**
   * Construct and simulate a mint_tier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint_tier: ({owner, tier}: {owner: string, tier: BotTier}, options?: {
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
   * Construct and simulate a token_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Off-chain verifiable descriptor. The traits are derived deterministically
   * from sha256(bot_id, minted_at, owner); this URI exposes the derivation
   * inputs so anyone can recompute `variant`/`bonus_bps` and confirm rarity.
   */
  token_uri: ({bot_id}: {bot_id: u64}, options?: {
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
   * Construct and simulate a admin_mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-controlled mint (no payment) for airdrops / grants. Distinguishable
   * from a purchase via the `grant` event.
   */
  admin_mint: ({to, tier}: {to: string, tier: BotTier}, options?: {
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
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, registry, payment_token}: {admin: string, registry: string, payment_token: string}, options?: {
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
   * Construct and simulate a mint_basic transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint_basic: ({owner}: {owner: string}, options?: {
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
   * Construct and simulate a rename_bot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set or clear the owner-chosen nickname for a bot. Max 24 bytes; pass
   * an empty string to clear. Only the current owner may rename.
   */
  rename_bot: ({bot_id, name}: {bot_id: u64, name: string}, options?: {
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
   * Construct and simulate a set_accrual transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_accrual: ({accrual}: {accrual: string}, options?: {
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
   * Construct and simulate a get_tier_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_tier_info: ({tier}: {tier: BotTier}, options?: {
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
  }) => Promise<AssembledTransaction<TierInfo>>

  /**
   * Construct and simulate a get_user_bots transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_bots: ({user}: {user: string}, options?: {
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
  }) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a payment_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  payment_token: (options?: {
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
   * Construct and simulate a set_tier_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_tier_rate: ({tier, rate}: {tier: BotTier, rate: u64}, options?: {
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
   * Construct and simulate a bump_user_bots transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionlessly refresh the persistent storage TTL of a user's bot list
   * and all bots owned by that user (#397).
   */
  bump_user_bots: ({user}: {user: string}, options?: {
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
   * Construct and simulate a get_bots_range transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Up to `limit` existing bots whose ids fall in `[start_id, start_id + limit)`,
   * skipping ids with no stored entry (burned or not yet minted). `limit`
   * above `MAX_RANGE_LIMIT` (100) returns `RangeLimitExceeded` (#391).
   */
  get_bots_range: ({start_id, limit}: {start_id: u64, limit: u32}, options?: {
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
  }) => Promise<AssembledTransaction<Result<Array<BotNFT>>>>

  /**
   * Construct and simulate a set_marketplace transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_marketplace: ({marketplace}: {marketplace: string}, options?: {
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
   * Construct and simulate a admin_mint_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Batch admin mint for airdrops. All-or-nothing: if any single mint fails
   * (e.g. supply cap), the whole batch is rolled back. Capped by MAX_BATCH_SIZE.
   */
  admin_mint_batch: ({recipients}: {recipients: Array<readonly [string, BotTier]>}, options?: {
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
  }) => Promise<AssembledTransaction<Result<Array<u64>>>>

  /**
   * Construct and simulate a get_bots_by_tier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return a page of bot IDs for a specific tier (#398).
   * 
   * Paged in buckets of `TIER_PAGE_SIZE` (10). Bounded to guarantee predictable
   * simulation cost without client-side N+1 filtering.
   */
  get_bots_by_tier: ({tier, page}: {tier: BotTier, page: u32}, options?: {
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
  }) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a treasury_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Balance of `token` held by this contract (accumulated tier payments).
   */
  treasury_balance: ({token}: {token: string}, options?: {
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
  }) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_user_total_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_user_total_rate: ({user}: {user: string}, options?: {
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
  }) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_user_bots_detailed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Full `BotNFT` records for up to the first `MAX_DETAILED_BOTS` bots
   * owned by `user`, in ownership order. Replaces the N+1 fan-out of
   * `get_user_bots` + `get_bot` with a single simulation; the cap is
   * enforced here, contract-side, and callers paginate past it with the
   * ID-based getters (#483).
   */
  get_user_bots_detailed: ({user}: {user: string}, options?: {
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
  }) => Promise<AssembledTransaction<Array<BotNFT>>>

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAALVCdXJuIGEgYm90LCByZW1vdmluZyBpdCBmcm9tIHN0b3JhZ2UsIGRlY3JlbWVudGluZyB0aWVyIHN1cHBseSwKcmVtb3ZpbmcgaXQgZnJvbSBvd25lcidzIGJvdCBsaXN0IGFuZCB0aWVyIGluZGV4LCBhbmQgZGVjcmVtZW50aW5nIHRoZSBvd25lcidzCmNvdW50IGluIHRoZSByZWdpc3RyeSBjb250cmFjdCAoIzM5OCkuAAAAAAAABGJ1cm4AAAACAAAAAAAAAAZib3RfaWQAAAAAAAYAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAwAAAAAAAAAAAAAABFRpZXIAAAADAAAAAAAAAAVCYXNpYwAAAAAAAAAAAAAAAAAACEFkdmFuY2VkAAAAAQAAAAAAAAAHUHJlbWl1bQAAAAAC",
        "AAAAAAAAAAAAAAAHZ2V0X2JvdAAAAAABAAAAAAAAAAZib3RfaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAGQm90TkZUAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAAIBUaGUgbmV4dCBib3QgaWQgdGhhdCB3aWxsIGJlIGFzc2lnbmVkLiBDYWxsZXJzIHVzZSBpdCBhcyB0aGUgZXhjbHVzaXZlCnVwcGVyIGJvdW5kIHdoZW4gcGFnaW5hdGluZyB3aXRoIGBnZXRfYm90c19yYW5nZWAgKCMzOTEpLgAAAAduZXh0X2lkAAAAAAAAAAABAAAABg==",
        "AAAAAAAAAEtQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2ggdGhlIHBlcnNpc3RlbnQgc3RvcmFnZSBUVEwgb2YgYSBzaW5nbGUgYm90ICgjMzk3KS4AAAAACGJ1bXBfYm90AAAAAQAAAAAAAAAGYm90X2lkAAAAAAAGAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAAZib3RfaWQAAAAAAAYAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAARBBZG1pbi1vbmx5IHdpdGhkcmF3YWwgb2YgYWNjdW11bGF0ZWQgdGllciBwYXltZW50cyAoIzMyMikuCgpgbWludF90aWVyYCB0YWtlcyB0aGUgcGF5bWVudCB0b2tlbiBhcyBhIHBlci1jYWxsIGFyZ3VtZW50IChubyB0b2tlbiBpcwpzdG9yZWQgeWV0KSwgc28gdGhlIHRva2VuIHRvIHdpdGhkcmF3IGlzIHBhc3NlZCBleHBsaWNpdGx5LiBUaGUgYmFsYW5jZQppcyBjaGVja2VkIHVwIGZyb250IHNvIGFuIG92ZXItd2l0aGRyYXdhbCBmYWlscyBiZWZvcmUgYW55IHRyYW5zZmVyLgAAAAh3aXRoZHJhdwAAAAMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAQAAAAAAAAAAAAAABkJvdE5GVAAAAAAACQAAAAAAAAAMYWNjcnVhbF9yYXRlAAAABgAAAEZEZXRlcm1pbmlzdGljIGJvbnVzIGJwcyAoMC4uNTAwKSBvbiB0b3Agb2YgdGhlIHRpZXIgYmFzZSBhY2NydWFsIHJhdGUuAAAAAAAJYm9udXNfYnBzAAAAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAACW1pbnRlZF9hdAAAAAAAAAYAAAAAAAAABm1pbnRlcgAAAAAAEwAAAHVPd25lci1zZXR0YWJsZSBuaWNrbmFtZSAobWF4IDI0IGJ5dGVzKS4gTm9uZSB3aGVuIHVuc2V0OyBjYWxsZXJzIHRoYXQKbmVlZCBhIGRpc3BsYXkgbmFtZSBmYWxsIGJhY2sgdG8gYHRpZXIubmFtZSgpYC4AAAAAAAAIbmlja25hbWUAAAPoAAAAEAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAR0aWVyAAAH0AAAAAdCb3RUaWVyAAAAAEBEZXRlcm1pbmlzdGljIHZhcmlhbnQgKDAuLj03KSBhc3NpZ25lZCBhdCBtaW50LCB1c2VkIGZvciByYXJpdHkuAAAAB3ZhcmlhbnQAAAAABA==",
        "AAAAAAAAADpFdmVyeSB0aWVyJ3MgZGVzY3JpcHRvciwgaW4gdGllciBvcmRlciAoQmFzaWMgLi4gRGlhbW9uZCkuAAAAAAAJYWxsX3RpZXJzAAAAAAAAAAAAAAEAAAPqAAAH0AAAAAhUaWVySW5mbw==",
        "AAAAAAAAAAAAAAAJbWludF90aWVyAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAR0aWVyAAAH0AAAAARUaWVyAAAAAQAAA+kAAAAGAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAAAAANlPZmYtY2hhaW4gdmVyaWZpYWJsZSBkZXNjcmlwdG9yLiBUaGUgdHJhaXRzIGFyZSBkZXJpdmVkIGRldGVybWluaXN0aWNhbGx5CmZyb20gc2hhMjU2KGJvdF9pZCwgbWludGVkX2F0LCBvd25lcik7IHRoaXMgVVJJIGV4cG9zZXMgdGhlIGRlcml2YXRpb24KaW5wdXRzIHNvIGFueW9uZSBjYW4gcmVjb21wdXRlIGB2YXJpYW50YC9gYm9udXNfYnBzYCBhbmQgY29uZmlybSByYXJpdHkuAAAAAAAACXRva2VuX3VyaQAAAAAAAAEAAAAAAAAABmJvdF9pZAAAAAAABgAAAAEAAAPpAAAAEAAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAwAAAAAAAAAAAAAAB0JvdFRpZXIAAAAABQAAAAAAAAAFQmFzaWMAAAAAAAAAAAAAAAAAAAZCcm9uemUAAAAAAAEAAAAAAAAABlNpbHZlcgAAAAAAAgAAAAAAAAAER29sZAAAAAMAAAAAAAAAB0RpYW1vbmQAAAAABA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADAAAAAAAAAAAAAAABk5leHRJZAAAAAAAAQAAAAAAAAADQm90AAAAAAEAAAAGAAAAAQAAAAAAAAAIVXNlckJvdHMAAAABAAAAEwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAALSW5pdGlhbGl6ZWQAAAAAAAAAAAAAAAAIUmVnaXN0cnkAAAABAAAAAAAAAApUaWVyU3VwcGx5AAAAAAABAAAH0AAAAAdCb3RUaWVyAAAAAAEAAAAAAAAACFRpZXJSYXRlAAAAAQAAB9AAAAAHQm90VGllcgAAAAAAAAAAAAAAAAtNYXJrZXRwbGFjZQAAAAAAAAAAAAAAAAdBY2NydWFsAAAAAAAAAAAAAAAADFBheW1lbnRUb2tlbgAAAAEAAAAAAAAACVRpZXJJbmRleAAAAAAAAAEAAAfQAAAAB0JvdFRpZXIA",
        "AAAAAAAAAHBBZG1pbi1jb250cm9sbGVkIG1pbnQgKG5vIHBheW1lbnQpIGZvciBhaXJkcm9wcyAvIGdyYW50cy4gRGlzdGluZ3Vpc2hhYmxlCmZyb20gYSBwdXJjaGFzZSB2aWEgdGhlIGBncmFudGAgZXZlbnQuAAAACmFkbWluX21pbnQAAAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAR0aWVyAAAH0AAAAAdCb3RUaWVyAAAAAAEAAAPpAAAABgAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhyZWdpc3RyeQAAABMAAAAAAAAADXBheW1lbnRfdG9rZW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAAAAAAAAAAAKbWludF9iYXNpYwAAAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAA+kAAAAGAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAAAAAIFTZXQgb3IgY2xlYXIgdGhlIG93bmVyLWNob3NlbiBuaWNrbmFtZSBmb3IgYSBib3QuIE1heCAyNCBieXRlczsgcGFzcwphbiBlbXB0eSBzdHJpbmcgdG8gY2xlYXIuIE9ubHkgdGhlIGN1cnJlbnQgb3duZXIgbWF5IHJlbmFtZS4AAAAAAAAKcmVuYW1lX2JvdAAAAAAAAgAAAAAAAAAGYm90X2lkAAAAAAAGAAAAAAAAAARuYW1lAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAQAAAEJUeXBlZCB0aWVyIGRlc2NyaXB0b3IgcmV0dXJuZWQgYnkgYGdldF90aWVyX2luZm9gIGFuZCBgYWxsX3RpZXJzYC4AAAAAAAAAAAAIVGllckluZm8AAAADAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAARyYXRlAAAABg==",
        "AAAAAAAAAAAAAAALc2V0X2FjY3J1YWwAAAAAAQAAAAAAAAAHYWNjcnVhbAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAAAAAAAAAAANZ2V0X3RpZXJfaW5mbwAAAAAAAAEAAAAAAAAABHRpZXIAAAfQAAAAB0JvdFRpZXIAAAAAAQAAB9AAAAAIVGllckluZm8=",
        "AAAAAAAAAAAAAAANZ2V0X3VzZXJfYm90cwAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAAG",
        "AAAAAAAAAAAAAAANcGF5bWVudF90b2tlbgAAAAAAAAAAAAABAAAD6QAAABMAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAAAAAAAANc2V0X3RpZXJfcmF0ZQAAAAAAAAIAAAAAAAAABHRpZXIAAAfQAAAAB0JvdFRpZXIAAAAAAAAAAARyYXRlAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAABAAAAAAAAAAAAAAAC0JvdE5GVEVycm9yAAAAAA8AAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAITm90Rm91bmQAAAACAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAADAAAAAAAAAAtJbnZhbGlkVGllcgAAAAAEAAAAAAAAAAtCb3ROb3RGb3VuZAAAAAAFAAAAAAAAAAhOb3RPd25lcgAAAAYAAAAAAAAAEUluc3VmZmljaWVudEZ1bmRzAAAAAAAABwAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAgAAAAAAAAAEVN1cHBseUNhcEV4Y2VlZGVkAAAAAAAACQAAAAAAAAANQmF0Y2hUb29MYXJnZQAAAAAAAAoAAAAAAAAAD05pY2tuYW1lVG9vTG9uZwAAAAALAAAAAAAAABJSYW5nZUxpbWl0RXhjZWVkZWQAAAAAAAwAAAAnYHdpdGhkcmF3YCBhbW91bnQgd2FzIHplcm8gb3IgbmVnYXRpdmUuAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAADQAAAERgd2l0aGRyYXdgIGFtb3VudCBleGNlZWRzIHRoZSB0cmVhc3VyeSBiYWxhbmNlIG9mIHRoZSBwYXltZW50IHRva2VuLgAAABRJbnN1ZmZpY2llbnRUcmVhc3VyeQAAAA4AAABIVGhlIGJvdCBpZCBjb3VudGVyIGhhcyByZWFjaGVkIGB1NjQ6Ok1BWGA7IG5vIGZ1cnRoZXIgYm90IGNhbiBiZSBtaW50ZWQuAAAACE92ZXJmbG93AAAADw==",
        "AAAAAAAAAHBQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2ggdGhlIHBlcnNpc3RlbnQgc3RvcmFnZSBUVEwgb2YgYSB1c2VyJ3MgYm90IGxpc3QKYW5kIGFsbCBib3RzIG93bmVkIGJ5IHRoYXQgdXNlciAoIzM5NykuAAAADmJ1bXBfdXNlcl9ib3RzAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAANZVcCB0byBgbGltaXRgIGV4aXN0aW5nIGJvdHMgd2hvc2UgaWRzIGZhbGwgaW4gYFtzdGFydF9pZCwgc3RhcnRfaWQgKyBsaW1pdClgLApza2lwcGluZyBpZHMgd2l0aCBubyBzdG9yZWQgZW50cnkgKGJ1cm5lZCBvciBub3QgeWV0IG1pbnRlZCkuIGBsaW1pdGAKYWJvdmUgYE1BWF9SQU5HRV9MSU1JVGAgKDEwMCkgcmV0dXJucyBgUmFuZ2VMaW1pdEV4Y2VlZGVkYCAoIzM5MSkuAAAAAAAOZ2V0X2JvdHNfcmFuZ2UAAAAAAAIAAAAAAAAACHN0YXJ0X2lkAAAABgAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+kAAAPqAAAH0AAAAAZCb3RORlQAAAAAB9AAAAALQm90TkZURXJyb3IA",
        "AAAAAQAAAAAAAAAAAAAADFN0b3JlZEJvdE5GVAAAAAgAAAAAAAAACWJvbnVzX2JwcwAAAAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAltaW50ZWRfYXQAAAAAAAAGAAAAAAAAAAZtaW50ZXIAAAAAABMAAAAAAAAACG5pY2tuYW1lAAAD6AAAABAAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAEdGllcgAAB9AAAAAHQm90VGllcgAAAAAAAAAAB3ZhcmlhbnQAAAAABA==",
        "AAAAAAAAAAAAAAAPc2V0X21hcmtldHBsYWNlAAAAAAEAAAAAAAAAC21hcmtldHBsYWNlAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtCb3RORlRFcnJvcgA=",
        "AAAAAAAAAJRCYXRjaCBhZG1pbiBtaW50IGZvciBhaXJkcm9wcy4gQWxsLW9yLW5vdGhpbmc6IGlmIGFueSBzaW5nbGUgbWludCBmYWlscwooZS5nLiBzdXBwbHkgY2FwKSwgdGhlIHdob2xlIGJhdGNoIGlzIHJvbGxlZCBiYWNrLiBDYXBwZWQgYnkgTUFYX0JBVENIX1NJWkUuAAAAEGFkbWluX21pbnRfYmF0Y2gAAAABAAAAAAAAAApyZWNpcGllbnRzAAAAAAPqAAAD7QAAAAIAAAATAAAH0AAAAAdCb3RUaWVyAAAAAAEAAAPpAAAD6gAAAAYAAAfQAAAAC0JvdE5GVEVycm9yAA==",
        "AAAAAAAAALRSZXR1cm4gYSBwYWdlIG9mIGJvdCBJRHMgZm9yIGEgc3BlY2lmaWMgdGllciAoIzM5OCkuCgpQYWdlZCBpbiBidWNrZXRzIG9mIGBUSUVSX1BBR0VfU0laRWAgKDEwKS4gQm91bmRlZCB0byBndWFyYW50ZWUgcHJlZGljdGFibGUKc2ltdWxhdGlvbiBjb3N0IHdpdGhvdXQgY2xpZW50LXNpZGUgTisxIGZpbHRlcmluZy4AAAAQZ2V0X2JvdHNfYnlfdGllcgAAAAIAAAAAAAAABHRpZXIAAAfQAAAAB0JvdFRpZXIAAAAAAAAAAARwYWdlAAAABAAAAAEAAAPqAAAABg==",
        "AAAAAAAAAEVCYWxhbmNlIG9mIGB0b2tlbmAgaGVsZCBieSB0aGlzIGNvbnRyYWN0IChhY2N1bXVsYXRlZCB0aWVyIHBheW1lbnRzKS4AAAAAAAAQdHJlYXN1cnlfYmFsYW5jZQAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAATZ2V0X3VzZXJfdG90YWxfcmF0ZQAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAG",
        "AAAAAAAAASFGdWxsIGBCb3RORlRgIHJlY29yZHMgZm9yIHVwIHRvIHRoZSBmaXJzdCBgTUFYX0RFVEFJTEVEX0JPVFNgIGJvdHMKb3duZWQgYnkgYHVzZXJgLCBpbiBvd25lcnNoaXAgb3JkZXIuIFJlcGxhY2VzIHRoZSBOKzEgZmFuLW91dCBvZgpgZ2V0X3VzZXJfYm90c2AgKyBgZ2V0X2JvdGAgd2l0aCBhIHNpbmdsZSBzaW11bGF0aW9uOyB0aGUgY2FwIGlzCmVuZm9yY2VkIGhlcmUsIGNvbnRyYWN0LXNpZGUsIGFuZCBjYWxsZXJzIHBhZ2luYXRlIHBhc3QgaXQgd2l0aCB0aGUKSUQtYmFzZWQgZ2V0dGVycyAoIzQ4MykuAAAAAAAAFmdldF91c2VyX2JvdHNfZGV0YWlsZWQAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAfQAAAABkJvdE5GVAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    burn: this.txFromJSON<Result<void>>,
        admin: this.txFromJSON<Result<string>>,
        get_bot: this.txFromJSON<Result<BotNFT>>,
        next_id: this.txFromJSON<u64>,
        bump_bot: this.txFromJSON<Result<void>>,
        transfer: this.txFromJSON<Result<void>>,
        withdraw: this.txFromJSON<Result<void>>,
        all_tiers: this.txFromJSON<Array<TierInfo>>,
        mint_tier: this.txFromJSON<Result<u64>>,
        token_uri: this.txFromJSON<Result<string>>,
        admin_mint: this.txFromJSON<Result<u64>>,
        initialize: this.txFromJSON<Result<void>>,
        mint_basic: this.txFromJSON<Result<u64>>,
        rename_bot: this.txFromJSON<Result<void>>,
        set_accrual: this.txFromJSON<Result<void>>,
        get_tier_info: this.txFromJSON<TierInfo>,
        get_user_bots: this.txFromJSON<Array<u64>>,
        payment_token: this.txFromJSON<Result<string>>,
        set_tier_rate: this.txFromJSON<Result<void>>,
        bump_user_bots: this.txFromJSON<Result<void>>,
        get_bots_range: this.txFromJSON<Result<Array<BotNFT>>>,
        set_marketplace: this.txFromJSON<Result<void>>,
        admin_mint_batch: this.txFromJSON<Result<Array<u64>>>,
        get_bots_by_tier: this.txFromJSON<Array<u64>>,
        treasury_balance: this.txFromJSON<i128>,
        get_user_total_rate: this.txFromJSON<u64>,
        get_user_bots_detailed: this.txFromJSON<Array<BotNFT>>
  }
}
