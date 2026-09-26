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
  points_per_amt: u64;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Admin", values: void} | {tag: "Initialized", values: void} | {tag: "UserAccrual", values: readonly [string]};


export interface UserAccrual {
  last_claim_ts: u64;
  rate: u64;
  started_at: u64;
  total_claimed_points: u64;
  user: string;
}

export const AccrualError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"AlreadyStarted"},
  3: {message:"NotStarted"},
  4: {message:"Unauthorized"},
  5: {message:"NotInitialized"}
}


export interface AccrualState {
  last_claim_ts: u64;
  total_claimed_points: u64;
}

export type DataKey = {tag: "Allowance", values: readonly [AllowanceKey]} | {tag: "Balance", values: readonly [string]} | {tag: "State", values: void} | {tag: "Admin", values: void};

export const TokenError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"Unauthorized"},
  4: {message:"InsufficientBalance"},
  5: {message:"InsufficientAllowance"},
  6: {message:"NegativeAmount"},
  7: {message:"AllowanceExpired"},
  8: {message:"Overflow"}
}


export interface TokenState {
  decimal: u32;
  name: string;
  symbol: string;
}


export interface AllowanceKey {
  from: string;
  spender: string;
}


export interface AllowanceValue {
  amount: i128;
  expiration_ledger: u32;
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
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim: ({user, token_contract, registry}: {user: string, token_contract: string, registry: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, points_per_amt}: {admin: string, points_per_amt: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_accrual transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_accrual: ({user, rate}: {user: string, rate: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pending_points transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_points: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u128>>>

  /**
   * Construct and simulate a get_accrual_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrual_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_accrual_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrual_state: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<AccrualState>>>

  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve: ({from, spender, amount, expiration_ledger}: {from: string, spender: string, amount: i128, expiration_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token balance for `id`, defaulting to 0 when no record exists.
   */
  balance: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, decimal, name, symbol}: {admin: string, decimal: u32, name: string, symbol: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAFY2xhaW0AAAAAAAADAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAOdG9rZW5fY29udHJhY3QAAAAAABMAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAEAAAPpAAAACwAAB9AAAAAMQWNjcnVhbEVycm9y",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAH0AAAAAxBY2NydWFsRXJyb3I=",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAQAAAAAAAAAOcG9pbnRzX3Blcl9hbXQAAAAAAAY=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAAAAAAAAAAAAAtJbml0aWFsaXplZAAAAAABAAAAAAAAAAtVc2VyQWNjcnVhbAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA5wb2ludHNfcGVyX2FtdAAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAAAAAAAAAAANc3RhcnRfYWNjcnVhbAAAAAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAARyYXRlAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADEFjY3J1YWxFcnJvcg==",
        "AAAAAQAAAAAAAAAAAAAAC1VzZXJBY2NydWFsAAAAAAUAAAAAAAAADWxhc3RfY2xhaW1fdHMAAAAAAAAGAAAAAAAAAARyYXRlAAAABgAAAAAAAAAKc3RhcnRlZF9hdAAAAAAABgAAAAAAAAAUdG90YWxfY2xhaW1lZF9wb2ludHMAAAAGAAAAAAAAAAR1c2VyAAAAEw==",
        "AAAAAAAAAAAAAAAOcGVuZGluZ19wb2ludHMAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+kAAAAKAAAH0AAAAAxBY2NydWFsRXJyb3I=",
        "AAAABAAAAAAAAAAAAAAADEFjY3J1YWxFcnJvcgAAAAUAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAOQWxyZWFkeVN0YXJ0ZWQAAAAAAAIAAAAAAAAACk5vdFN0YXJ0ZWQAAAAAAAMAAAAAAAAADFVuYXV0aG9yaXplZAAAAAQAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAAF",
        "AAAAAQAAAAAAAAAAAAAADEFjY3J1YWxTdGF0ZQAAAAIAAAAAAAAADWxhc3RfY2xhaW1fdHMAAAAAAAAGAAAAAAAAABR0b3RhbF9jbGFpbWVkX3BvaW50cwAAAAY=",
        "AAAAAAAAAAAAAAARZ2V0X2FjY3J1YWxfYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAARZ2V0X2FjY3J1YWxfc3RhdGUAAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPoAAAH0AAAAAxBY2NydWFsU3RhdGU=",
        "AAAAAAAAAAAAAAAEYnVybgAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAEbWludAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAD6QAAABAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAA+kAAAAQAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAEpSZXR1cm5zIHRoZSB0b2tlbiBiYWxhbmNlIGZvciBgaWRgLCBkZWZhdWx0aW5nIHRvIDAgd2hlbiBubyByZWNvcmQgZXhpc3RzLgAAAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAACaWQAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAIZGVjaW1hbHMAAAAAAAAAAQAAA+kAAAAEAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAAAAAACUFsbG93YW5jZQAAAAAAAAEAAAfQAAAADEFsbG93YW5jZUtleQAAAAEAAAAAAAAAB0JhbGFuY2UAAAAAAQAAABMAAAAAAAAAAAAAAAVTdGF0ZQAAAAAAAAAAAAAAAAAABUFkbWluAAAA",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdkZWNpbWFsAAAAAAQAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAZzeW1ib2wAAAAAABAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAABAAAAAAAAAAAAAAAClRva2VuRXJyb3IAAAAAAAgAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADFVuYXV0aG9yaXplZAAAAAMAAAAAAAAAE0luc3VmZmljaWVudEJhbGFuY2UAAAAABAAAAAAAAAAVSW5zdWZmaWNpZW50QWxsb3dhbmNlAAAAAAAABQAAAAAAAAAOTmVnYXRpdmVBbW91bnQAAAAAAAYAAAAAAAAAEEFsbG93YW5jZUV4cGlyZWQAAAAHAAAAAAAAAAhPdmVyZmxvdwAAAAg=",
        "AAAAAQAAAAAAAAAAAAAAClRva2VuU3RhdGUAAAAAAAMAAAAAAAAAB2RlY2ltYWwAAAAABAAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEA==",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAQAAAAAAAAAAAAAADEFsbG93YW5jZUtleQAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAdzcGVuZGVyAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAADkFsbG93YW5jZVZhbHVlAAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABA==",
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
    claim: this.txFromJSON<Result<i128>>,
        config: this.txFromJSON<Result<Config>>,
        initialize: this.txFromJSON<Result<void>>,
        start_accrual: this.txFromJSON<Result<void>>,
        pending_points: this.txFromJSON<Result<u128>>,
        get_accrual_admin: this.txFromJSON<string>,
        get_accrual_state: this.txFromJSON<Option<AccrualState>>,
        burn: this.txFromJSON<Result<void>>,
        mint: this.txFromJSON<Result<void>>,
        name: this.txFromJSON<Result<string>>,
        admin: this.txFromJSON<Result<string>>,
        symbol: this.txFromJSON<Result<string>>,
        approve: this.txFromJSON<Result<void>>,
        balance: this.txFromJSON<i128>,
        decimals: this.txFromJSON<Result<u32>>,
        transfer: this.txFromJSON<Result<void>>,
        allowance: this.txFromJSON<i128>,
        set_admin: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        transfer_from: this.txFromJSON<Result<void>>,
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