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
      new ContractSpec([ "AAAAAAAAAAAAAAAIZ2V0X3VzZXIAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAH0AAAAAtVc2VyUHJvZmlsZQAAAAfQAAAADVJlZ2lzdHJ5RXJyb3IAAAA=",
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