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


export interface Config {
  /**
 * 10^token_decimals — every mint is multiplied by this so that
 * "1 AMT" = `1 * amt_scale` base units (fixes #410).
 */
amt_scale: i128;
  points_per_amt: u64;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Admin", values: void} | {tag: "Initialized", values: void} | {tag: "BotNft", values: void} | {tag: "Registry", values: void} | {tag: "UserAccrual", values: readonly [string]} | {tag: "Frozen", values: readonly [string]} | {tag: "ReentrancyGuard", values: void};


export interface UserAccrual {
  carry_points: u64;
  last_claim_ts: u64;
  leftover: u64;
  lifetime_points: u64;
  rate: u64;
  started_at: u64;
  user: string;
}

export const Errors = {
  1: {message:"AlreadyInitialized"},

  2: {message:"AlreadyStarted"},

  3: {message:"NotStarted"},

  4: {message:"Unauthorized"},

  5: {message:"NotInitialized"},

  6: {message:"RegistryCallFailed"},

  7: {message:"TokenMintFailed"},

  8: {message:"InvalidConfig"},

  9: {message:"NoBots"},

  10: {message:"TooManyUsers"},

  11: {message:"NotRegistered"},

  12: {message:"Frozen"}
}

export interface AccrualState {
  carry_points: u64;
  last_claim_ts: u64;
  lifetime_points: u64;
  rate: u64;
  started_at: u64;
}


export interface Client {
  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim: ({user, token_contract, registry}: {user: string, token_contract: string, registry: string}, options?: {
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
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: {
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
  }) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a freeze transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  freeze: ({user}: {user: string}, options?: {
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
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settle accrued points for up to `MAX_SETTLE_USERS` users in one call,
   * without minting and without any user's signature (#414).
   * 
   * For each user this does exactly what `claim` does up to the mint:
   * the points earned since `last_claim_ts` (plus the carried sub-hour
   * remainder) are credited to the registry, added to `carry_points` and
   * `lifetime_points`, and `last_claim_ts` moves to now. The user's next
   * `claim` then mints from the carried balance, so a settled user ends up
   * with the same points and the same AMT as an unsettled one.
   * 
   * Why this is safe to leave permissionless: settling never moves value
   * out of the system and never reduces what a user is owed. The pending
   * amount is a pure function of stored state and the ledger clock, it is
   * credited to the user's own registry profile, and the only field a
   * caller can influence is *when* the credit is recorded, which `claim`
   * would record identically. There is nothing to gain by calling it early,
   * late, or repeatedly (a repeat within the same second credits zero), and
   * each ca
   */
  settle: ({users}: {users: Array<string>}, options?: {
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
   * Construct and simulate a unfreeze transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unfreeze: ({user}: {user: string}, options?: {
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
   * Construct and simulate a sync_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  sync_rate: ({user}: {user: string}, options?: {
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
  initialize: ({admin, bot_nft, registry, token, points_per_amt}: {admin: string, bot_nft: string, registry: string, token: string, points_per_amt: u64}, options?: {
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
   * Construct and simulate a stop_accrual transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  stop_accrual: ({user, registry}: {user: string, registry: string}, options?: {
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
   * Construct and simulate a start_accrual transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Starts accruing for `user` at the combined rate of the bots they own,
   * read from the bot_nft contract — never from the caller (#319).
   * 
   * The user must already be registered (#415): an unregistered address
   * would otherwise accrue time it can never claim, failing later inside
   * `registry.add_points` with no actionable error.
   */
  start_accrual: ({user}: {user: string}, options?: {
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
   * Construct and simulate a pending_points transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_points: ({user}: {user: string}, options?: {
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
   * Construct and simulate a get_accrual_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrual_admin: (options?: {
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
   * Construct and simulate a get_accrual_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrual_state: ({user}: {user: string}, options?: {
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
  }) => Promise<AssembledTransaction<Option<AccrualState>>>

  /**
   * Construct and simulate a get_accrual_states transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accrual states for up to `MAX_BATCH_USERS` users in one call, in the
   * same order as `users`. Addresses with no accrual record map to `None`.
   * Lets a leaderboard poll one simulation instead of one per row (#420).
   */
  get_accrual_states: ({users}: {users: Array<string>}, options?: {
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
  }) => Promise<AssembledTransaction<Result<Array<Option<AccrualState>>>>>

  /**
   * Construct and simulate a set_points_per_amt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_points_per_amt: ({points_per_amt}: {points_per_amt: u64}, options?: {
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
   * Construct and simulate a seconds_to_next_amt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Seconds until the next AMT token will be earned. Returns 0 if the user
   * already has enough carry points for the next token or if their rate is 0.
   * Computed from carry_points, points_per_amt, and accrual rate.
   */
  seconds_to_next_amt: ({user}: {user: string}, options?: {
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

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAFY2xhaW0AAAAAAAADAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAOdG9rZW5fY29udHJhY3QAAAAAABMAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAEAAAPpAAAABgAAB9AAAAAMQWNjcnVhbEVycm9y",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAH0AAAAAxBY2NydWFsRXJyb3I=",
        "AAAAAAAAAAAAAAAGZnJlZXplAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAAAABABTZXR0bGUgYWNjcnVlZCBwb2ludHMgZm9yIHVwIHRvIGBNQVhfU0VUVExFX1VTRVJTYCB1c2VycyBpbiBvbmUgY2FsbCwKd2l0aG91dCBtaW50aW5nIGFuZCB3aXRob3V0IGFueSB1c2VyJ3Mgc2lnbmF0dXJlICgjNDE0KS4KCkZvciBlYWNoIHVzZXIgdGhpcyBkb2VzIGV4YWN0bHkgd2hhdCBgY2xhaW1gIGRvZXMgdXAgdG8gdGhlIG1pbnQ6CnRoZSBwb2ludHMgZWFybmVkIHNpbmNlIGBsYXN0X2NsYWltX3RzYCAocGx1cyB0aGUgY2FycmllZCBzdWItaG91cgpyZW1haW5kZXIpIGFyZSBjcmVkaXRlZCB0byB0aGUgcmVnaXN0cnksIGFkZGVkIHRvIGBjYXJyeV9wb2ludHNgIGFuZApgbGlmZXRpbWVfcG9pbnRzYCwgYW5kIGBsYXN0X2NsYWltX3RzYCBtb3ZlcyB0byBub3cuIFRoZSB1c2VyJ3MgbmV4dApgY2xhaW1gIHRoZW4gbWludHMgZnJvbSB0aGUgY2FycmllZCBiYWxhbmNlLCBzbyBhIHNldHRsZWQgdXNlciBlbmRzIHVwCndpdGggdGhlIHNhbWUgcG9pbnRzIGFuZCB0aGUgc2FtZSBBTVQgYXMgYW4gdW5zZXR0bGVkIG9uZS4KCldoeSB0aGlzIGlzIHNhZmUgdG8gbGVhdmUgcGVybWlzc2lvbmxlc3M6IHNldHRsaW5nIG5ldmVyIG1vdmVzIHZhbHVlCm91dCBvZiB0aGUgc3lzdGVtIGFuZCBuZXZlciByZWR1Y2VzIHdoYXQgYSB1c2VyIGlzIG93ZWQuIFRoZSBwZW5kaW5nCmFtb3VudCBpcyBhIHB1cmUgZnVuY3Rpb24gb2Ygc3RvcmVkIHN0YXRlIGFuZCB0aGUgbGVkZ2VyIGNsb2NrLCBpdCBpcwpjcmVkaXRlZCB0byB0aGUgdXNlcidzIG93biByZWdpc3RyeSBwcm9maWxlLCBhbmQgdGhlIG9ubHkgZmllbGQgYQpjYWxsZXIgY2FuIGluZmx1ZW5jZSBpcyAqd2hlbiogdGhlIGNyZWRpdCBpcyByZWNvcmRlZCwgd2hpY2ggYGNsYWltYAp3b3VsZCByZWNvcmQgaWRlbnRpY2FsbHkuIFRoZXJlIGlzIG5vdGhpbmcgdG8gZ2FpbiBieSBjYWxsaW5nIGl0IGVhcmx5LApsYXRlLCBvciByZXBlYXRlZGx5IChhIHJlcGVhdCB3aXRoaW4gdGhlIHNhbWUgc2Vjb25kIGNyZWRpdHMgemVybyksIGFuZAplYWNoIGNhAAAABnNldHRsZQAAAAAAAQAAAAAAAAAFdXNlcnMAAAAAAAPqAAAAEwAAAAEAAAPpAAAABAAAB9AAAAAMQWNjcnVhbEVycm9y",
        "AAAAAAAAAAAAAAAIdW5mcmVlemUAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAgAAAHExMF50b2tlbl9kZWNpbWFscyDigJQgZXZlcnkgbWludCBpcyBtdWx0aXBsaWVkIGJ5IHRoaXMgc28gdGhhdAoiMSBBTVQiID0gYDEgKiBhbXRfc2NhbGVgIGJhc2UgdW5pdHMgKGZpeGVzICM0MTApLgAAAAAAAAlhbXRfc2NhbGUAAAAAAAALAAAAAAAAAA5wb2ludHNfcGVyX2FtdAAAAAAABg==",
        "AAAAAAAAAAAAAAAJc3luY19yYXRlAAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAAAYAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAAAAAAAAAAAAAtJbml0aWFsaXplZAAAAAAAAAAAAAAAAAZCb3ROZnQAAAAAAAAAAAAAAAAACFJlZ2lzdHJ5AAAAAQAAAAAAAAALVXNlckFjY3J1YWwAAAAAAQAAABMAAAABAAAAOlNldCBieSB0aGUgYWRtaW4gdG8gYmxvY2sgYSB1c2VyJ3MgYWNjcnVhbCBhY3Rpb25zICgjNDEzKS4AAAAAAAZGcm96ZW4AAAAAAAEAAAATAAAAAAAAAAAAAAAPUmVlbnRyYW5jeUd1YXJkAA==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdib3RfbmZ0AAAAABMAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAA5wb2ludHNfcGVyX2FtdAAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAAAAAAAAAAAMc3RvcF9hY2NydWFsAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAAAAAUBTdGFydHMgYWNjcnVpbmcgZm9yIGB1c2VyYCBhdCB0aGUgY29tYmluZWQgcmF0ZSBvZiB0aGUgYm90cyB0aGV5IG93biwKcmVhZCBmcm9tIHRoZSBib3RfbmZ0IGNvbnRyYWN0IOKAlCBuZXZlciBmcm9tIHRoZSBjYWxsZXIgKCMzMTkpLgoKVGhlIHVzZXIgbXVzdCBhbHJlYWR5IGJlIHJlZ2lzdGVyZWQgKCM0MTUpOiBhbiB1bnJlZ2lzdGVyZWQgYWRkcmVzcwp3b3VsZCBvdGhlcndpc2UgYWNjcnVlIHRpbWUgaXQgY2FuIG5ldmVyIGNsYWltLCBmYWlsaW5nIGxhdGVyIGluc2lkZQpgcmVnaXN0cnkuYWRkX3BvaW50c2Agd2l0aCBubyBhY3Rpb25hYmxlIGVycm9yLgAAAA1zdGFydF9hY2NydWFsAAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAxBY2NydWFsRXJyb3I=",
        "AAAAAQAAAAAAAAAAAAAAC1VzZXJBY2NydWFsAAAAAAcAAAAAAAAADGNhcnJ5X3BvaW50cwAAAAYAAAAAAAAADWxhc3RfY2xhaW1fdHMAAAAAAAAGAAAAAAAAAAhsZWZ0b3ZlcgAAAAYAAAAAAAAAD2xpZmV0aW1lX3BvaW50cwAAAAAGAAAAAAAAAARyYXRlAAAABgAAAAAAAAAKc3RhcnRlZF9hdAAAAAAABgAAAAAAAAAEdXNlcgAAABM=",
        "AAAAAAAAAAAAAAAOcGVuZGluZ19wb2ludHMAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+kAAAAGAAAH0AAAAAxBY2NydWFsRXJyb3I=",
        "AAAABAAAAAAAAAAAAAAADEFjY3J1YWxFcnJvcgAAAAwAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAOQWxyZWFkeVN0YXJ0ZWQAAAAAAAIAAAAAAAAACk5vdFN0YXJ0ZWQAAAAAAAMAAAAAAAAADFVuYXV0aG9yaXplZAAAAAQAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAFAAAAAAAAABJSZWdpc3RyeUNhbGxGYWlsZWQAAAAAAAYAAAAAAAAAD1Rva2VuTWludEZhaWxlZAAAAAAHAAAAAAAAAA1JbnZhbGlkQ29uZmlnAAAAAAAACAAAAAAAAAAGTm9Cb3RzAAAAAAAJAAAAAAAAAAxUb29NYW55VXNlcnMAAAAKAAAAAAAAAA1Ob3RSZWdpc3RlcmVkAAAAAAAACwAAAAAAAAAGRnJvemVuAAAAAAAM",
        "AAAAAQAAAAAAAAAAAAAADEFjY3J1YWxTdGF0ZQAAAAUAAAAAAAAADGNhcnJ5X3BvaW50cwAAAAYAAAAAAAAADWxhc3RfY2xhaW1fdHMAAAAAAAAGAAAAAAAAAA9saWZldGltZV9wb2ludHMAAAAABgAAAAAAAAAEcmF0ZQAAAAYAAAAAAAAACnN0YXJ0ZWRfYXQAAAAAAAY=",
        "AAAAAAAAAAAAAAARZ2V0X2FjY3J1YWxfYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAH0AAAAAxBY2NydWFsRXJyb3I=",
        "AAAAAAAAAAAAAAARZ2V0X2FjY3J1YWxfc3RhdGUAAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPoAAAH0AAAAAxBY2NydWFsU3RhdGU=",
        "AAAAAAAAANFBY2NydWFsIHN0YXRlcyBmb3IgdXAgdG8gYE1BWF9CQVRDSF9VU0VSU2AgdXNlcnMgaW4gb25lIGNhbGwsIGluIHRoZQpzYW1lIG9yZGVyIGFzIGB1c2Vyc2AuIEFkZHJlc3NlcyB3aXRoIG5vIGFjY3J1YWwgcmVjb3JkIG1hcCB0byBgTm9uZWAuCkxldHMgYSBsZWFkZXJib2FyZCBwb2xsIG9uZSBzaW11bGF0aW9uIGluc3RlYWQgb2Ygb25lIHBlciByb3cgKCM0MjApLgAAAAAAABJnZXRfYWNjcnVhbF9zdGF0ZXMAAAAAAAEAAAAAAAAABXVzZXJzAAAAAAAD6gAAABMAAAABAAAD6QAAA+oAAAPoAAAH0AAAAAxBY2NydWFsU3RhdGUAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAAAAAAAAAAASc2V0X3BvaW50c19wZXJfYW10AAAAAAABAAAAAAAAAA5wb2ludHNfcGVyX2FtdAAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAAAAAM5TZWNvbmRzIHVudGlsIHRoZSBuZXh0IEFNVCB0b2tlbiB3aWxsIGJlIGVhcm5lZC4gUmV0dXJucyAwIGlmIHRoZSB1c2VyCmFscmVhZHkgaGFzIGVub3VnaCBjYXJyeSBwb2ludHMgZm9yIHRoZSBuZXh0IHRva2VuIG9yIGlmIHRoZWlyIHJhdGUgaXMgMC4KQ29tcHV0ZWQgZnJvbSBjYXJyeV9wb2ludHMsIHBvaW50c19wZXJfYW10LCBhbmQgYWNjcnVhbCByYXRlLgAAAAAAE3NlY29uZHNfdG9fbmV4dF9hbXQAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAAAYAAAfQAAAADEFjY3J1YWxFcnJvcg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    claim: this.txFromJSON<Result<u64>>,
        config: this.txFromJSON<Result<Config>>,
        freeze: this.txFromJSON<Result<void>>,
        settle: this.txFromJSON<Result<u32>>,
        unfreeze: this.txFromJSON<Result<void>>,
        sync_rate: this.txFromJSON<Result<u64>>,
        initialize: this.txFromJSON<Result<void>>,
        stop_accrual: this.txFromJSON<Result<void>>,
        start_accrual: this.txFromJSON<Result<void>>,
        pending_points: this.txFromJSON<Result<u64>>,
        get_accrual_admin: this.txFromJSON<Result<string>>,
        get_accrual_state: this.txFromJSON<Option<AccrualState>>,
        get_accrual_states: this.txFromJSON<Result<Array<Option<AccrualState>>>>,
        set_points_per_amt: this.txFromJSON<Result<void>>,
        seconds_to_next_amt: this.txFromJSON<Result<u64>>
  }
}