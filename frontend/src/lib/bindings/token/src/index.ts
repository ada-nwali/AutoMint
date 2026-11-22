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

export type DataKey = {tag: "Allowance", values: readonly [AllowanceKey]} | {tag: "Balance", values: readonly [string]} | {tag: "State", values: void} | {tag: "Admin", values: void} | {tag: "TotalSupply", values: void} | {tag: "MaxSupply", values: void} | {tag: "Locked", values: readonly [string]} | {tag: "PendingAdmin", values: void};

export const Errors = {
  1: {message:"AlreadyInitialized"},

  2: {message:"NotInitialized"},

  3: {message:"Unauthorized"},

  4: {message:"InsufficientBalance"},

  5: {message:"InsufficientAllowance"},

  6: {message:"NegativeAmount"},

  7: {message:"AllowanceExpired"},

  8: {message:"Overflow"},

  1000: {message:"Paused"},

  9: {message:"SupplyCapExceeded"},

  10: {message:"InvalidDecimals"},

  11: {message:"InvalidExpiration"},

  12: {message:"InvalidMetadata"},

  13: {message:"NoPendingAdmin"},

  14: {message:"LengthMismatch"},

  15: {message:"BatchTooLarge"}
}

export interface TokenState {
  /**
 * Immutable after initialization: changing precision would reprice every
 * existing balance without changing its stored integer amount.
 */
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

/**
 * Common errors shared across contracts
 */
export const Errors = {
  /**
   * Contract is paused
   */
  1000: {message:"Paused"},

  /**
   * Not initialized
   */
  1001: {message:"NotInitialized"},

  /**
   * Unauthorized operation
   */
  1002: {message:"Unauthorized"}
}
/**
 * Shared data keys for admin and pause state
 */
export type CommonDataKey = {tag: "Admin", values: void} | {tag: "Paused", values: void};


export interface Client {
  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: {
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
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mint: ({to, amount}: {to: string, amount: i128}, options?: {
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
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: {
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
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pauses the contract (admin-only) (#336)
   */
  pause: (options?: {
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
   * Construct and simulate a paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Checks if the contract is paused (#336)
   */
  paused: (options?: {
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
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  symbol: (options?: {
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
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve: ({from, spender, amount, expiration_ledger}: {from: string, spender: string, amount: i128, expiration_ledger: u32}, options?: {
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
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token balance for `id`, defaulting to 0 when no record exists.
   */
  balance: ({id}: {id: string}, options?: {
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
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpauses the contract (admin-only) (#336)
   */
  unpause: (options?: {
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
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrades the contract wasm (admin-only) (#336)
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: {
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
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals: (options?: {
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
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: {
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
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: {
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
   * Construct and simulate a burn_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn_from: ({spender, from, amount}: {spender: string, from: string, amount: i128}, options?: {
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
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Proposes `new_admin` as the next administrator. The current admin
   * remains active until the proposed address calls `accept_admin`.
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
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, decimal, name, symbol}: {admin: string, decimal: u32, name: string, symbol: string}, options?: {
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
   * Construct and simulate a max_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the max supply cap, if set (#339)
   */
  max_supply: (options?: {
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
  }) => Promise<AssembledTransaction<Option<i128>>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accepts the pending admin proposal. Only the nominated address can
   * call this method.
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
   * Construct and simulate a bump_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * #345: permissionless keeper call that refreshes `id`'s balance
   * entry TTL without touching its amount. Anyone may call this — there
   * is nothing privileged about extending an entry's own lifetime, and
   * requiring auth here would defeat the point of a keeper being able
   * to rescue a dormant holder's balance from archival.
   */
  bump_balance: ({id}: {id: string}, options?: {
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
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_metadata transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Updates the token's display name and symbol. Decimal precision is
   * deliberately immutable: changing it would reprice every stored balance.
   */
  set_metadata: ({name, symbol}: {name: string, symbol: string}, options?: {
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
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the total supply of tokens (#338)
   */
  total_supply: (options?: {
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
   * Construct and simulate a pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the nominated administrator, if a transfer is pending.
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
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: {
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
   * Construct and simulate a set_max_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: set the maximum supply cap. Fails if cap is below current supply (#339)
   */
  set_max_supply: ({new_cap}: {new_cap: Option<i128>}, options?: {
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
   * Construct and simulate a transfer_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_batch: ({from, recipients, amounts}: {from: string, recipients: Array<string>, amounts: Array<i128>}, options?: {
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
   * Construct and simulate a spendable_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * #344: SEP-41 `spendable_balance` — the portion of `balance` that is
   * actually transferable right now. For this token there is currently
   * no locking mechanism, so it equals `balance` minus any reserve held
   * in `DataKey::Locked(id)` (0 today for every address). Reading it as
   * its own storage lookup, rather than hardcoding `spendable ==
   * balance`, lets a future lock/vesting feature populate
   * `DataKey::Locked` without an interface break.
   */
  spendable_balance: ({id}: {id: string}, options?: {
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
   * Construct and simulate a cancel_admin_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancels the pending admin proposal. Only the current admin can cancel.
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

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEYnVybgAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAEbWludAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAD6QAAABAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAACdQYXVzZXMgdGhlIGNvbnRyYWN0IChhZG1pbi1vbmx5KSAoIzMzNikAAAAABXBhdXNlAAAAAAAAAAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAACdDaGVja3MgaWYgdGhlIGNvbnRyYWN0IGlzIHBhdXNlZCAoIzMzNikAAAAABnBhdXNlZAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAA+kAAAAQAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAEpSZXR1cm5zIHRoZSB0b2tlbiBiYWxhbmNlIGZvciBgaWRgLCBkZWZhdWx0aW5nIHRvIDAgd2hlbiBubyByZWNvcmQgZXhpc3RzLgAAAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAACaWQAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAClVbnBhdXNlcyB0aGUgY29udHJhY3QgKGFkbWluLW9ubHkpICgjMzM2KQAAAAAAAAd1bnBhdXNlAAAAAAAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAC5VcGdyYWRlcyB0aGUgY29udHJhY3Qgd2FzbSAoYWRtaW4tb25seSkgKCMzMzYpAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAIZGVjaW1hbHMAAAAAAAAAAQAAA+kAAAAEAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAAAAAIFQcm9wb3NlcyBgbmV3X2FkbWluYCBhcyB0aGUgbmV4dCBhZG1pbmlzdHJhdG9yLiBUaGUgY3VycmVudCBhZG1pbgpyZW1haW5zIGFjdGl2ZSB1bnRpbCB0aGUgcHJvcG9zZWQgYWRkcmVzcyBjYWxscyBgYWNjZXB0X2FkbWluYC4AAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAEAAAAAAAAACUFsbG93YW5jZQAAAAAAAAEAAAfQAAAADEFsbG93YW5jZUtleQAAAAEAAAAAAAAAB0JhbGFuY2UAAAAAAQAAABMAAAAAAAAAAAAAAAVTdGF0ZQAAAAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAALVG90YWxTdXBwbHkAAAAAAAAAAAAAAAAJTWF4U3VwcGx5AAAAAAAAAQAAAAAAAAAGTG9ja2VkAAAAAAABAAAAEwAAAAAAAAAAAAAADFBlbmRpbmdBZG1pbg==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdkZWNpbWFsAAAAAAQAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAZzeW1ib2wAAAAAABAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAClSZXR1cm5zIHRoZSBtYXggc3VwcGx5IGNhcCwgaWYgc2V0ICgjMzM5KQAAAAAAAAptYXhfc3VwcGx5AAAAAAAAAAAAAQAAA+gAAAAL",
        "AAAAAAAAAFRBY2NlcHRzIHRoZSBwZW5kaW5nIGFkbWluIHByb3Bvc2FsLiBPbmx5IHRoZSBub21pbmF0ZWQgYWRkcmVzcyBjYW4KY2FsbCB0aGlzIG1ldGhvZC4AAAAMYWNjZXB0X2FkbWluAAAAAAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAAAAAT0jMzQ1OiBwZXJtaXNzaW9ubGVzcyBrZWVwZXIgY2FsbCB0aGF0IHJlZnJlc2hlcyBgaWRgJ3MgYmFsYW5jZQplbnRyeSBUVEwgd2l0aG91dCB0b3VjaGluZyBpdHMgYW1vdW50LiBBbnlvbmUgbWF5IGNhbGwgdGhpcyDigJQgdGhlcmUKaXMgbm90aGluZyBwcml2aWxlZ2VkIGFib3V0IGV4dGVuZGluZyBhbiBlbnRyeSdzIG93biBsaWZldGltZSwgYW5kCnJlcXVpcmluZyBhdXRoIGhlcmUgd291bGQgZGVmZWF0IHRoZSBwb2ludCBvZiBhIGtlZXBlciBiZWluZyBhYmxlCnRvIHJlc2N1ZSBhIGRvcm1hbnQgaG9sZGVyJ3MgYmFsYW5jZSBmcm9tIGFyY2hpdmFsLgAAAAAAAAxidW1wX2JhbGFuY2UAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAA=",
        "AAAAAAAAAIlVcGRhdGVzIHRoZSB0b2tlbidzIGRpc3BsYXkgbmFtZSBhbmQgc3ltYm9sLiBEZWNpbWFsIHByZWNpc2lvbiBpcwpkZWxpYmVyYXRlbHkgaW1tdXRhYmxlOiBjaGFuZ2luZyBpdCB3b3VsZCByZXByaWNlIGV2ZXJ5IHN0b3JlZCBiYWxhbmNlLgAAAAAAAAxzZXRfbWV0YWRhdGEAAAACAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAGc3ltYm9sAAAAAAAQAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAKVG9rZW5FcnJvcgAA",
        "AAAAAAAAAClSZXR1cm5zIHRoZSB0b3RhbCBzdXBwbHkgb2YgdG9rZW5zICgjMzM4KQAAAAAAAAx0b3RhbF9zdXBwbHkAAAAAAAAAAQAAAAs=",
        "AAAABAAAAAAAAAAAAAAAClRva2VuRXJyb3IAAAAAABAAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADFVuYXV0aG9yaXplZAAAAAMAAAAAAAAAE0luc3VmZmljaWVudEJhbGFuY2UAAAAABAAAAAAAAAAVSW5zdWZmaWNpZW50QWxsb3dhbmNlAAAAAAAABQAAAAAAAAAOTmVnYXRpdmVBbW91bnQAAAAAAAYAAAAAAAAAEEFsbG93YW5jZUV4cGlyZWQAAAAHAAAAAAAAAAhPdmVyZmxvdwAAAAgAAAAAAAAABlBhdXNlZAAAAAAD6AAAAAAAAAARU3VwcGx5Q2FwRXhjZWVkZWQAAAAAAAAJAAAAAAAAAA9JbnZhbGlkRGVjaW1hbHMAAAAACgAAAAAAAAARSW52YWxpZEV4cGlyYXRpb24AAAAAAAALAAAAAAAAAA9JbnZhbGlkTWV0YWRhdGEAAAAADAAAAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAAA0AAAAAAAAADkxlbmd0aE1pc21hdGNoAAAAAAAOAAAAAAAAAA1CYXRjaFRvb0xhcmdlAAAAAAAADw==",
        "AAAAAQAAAAAAAAAAAAAAClRva2VuU3RhdGUAAAAAAAMAAACDSW1tdXRhYmxlIGFmdGVyIGluaXRpYWxpemF0aW9uOiBjaGFuZ2luZyBwcmVjaXNpb24gd291bGQgcmVwcmljZSBldmVyeQpleGlzdGluZyBiYWxhbmNlIHdpdGhvdXQgY2hhbmdpbmcgaXRzIHN0b3JlZCBpbnRlZ2VyIGFtb3VudC4AAAAAB2RlY2ltYWwAAAAABAAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEA==",
        "AAAAAAAAAD5SZXR1cm5zIHRoZSBub21pbmF0ZWQgYWRtaW5pc3RyYXRvciwgaWYgYSB0cmFuc2ZlciBpcyBwZW5kaW5nLgAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAFNBZG1pbi1vbmx5OiBzZXQgdGhlIG1heGltdW0gc3VwcGx5IGNhcC4gRmFpbHMgaWYgY2FwIGlzIGJlbG93IGN1cnJlbnQgc3VwcGx5ICgjMzM5KQAAAAAOc2V0X21heF9zdXBwbHkAAAAAAAEAAAAAAAAAB25ld19jYXAAAAAD6AAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAApUb2tlbkVycm9yAAA=",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYmF0Y2gAAAAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAApyZWNpcGllbnRzAAAAAAPqAAAAEwAAAAAAAAAHYW1vdW50cwAAAAPqAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAAAQAAAAAAAAAAAAAADEFsbG93YW5jZUtleQAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAdzcGVuZGVyAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAADkFsbG93YW5jZVZhbHVlAAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABA==",
        "AAAAAAAAAbEjMzQ0OiBTRVAtNDEgYHNwZW5kYWJsZV9iYWxhbmNlYCDigJQgdGhlIHBvcnRpb24gb2YgYGJhbGFuY2VgIHRoYXQgaXMKYWN0dWFsbHkgdHJhbnNmZXJhYmxlIHJpZ2h0IG5vdy4gRm9yIHRoaXMgdG9rZW4gdGhlcmUgaXMgY3VycmVudGx5Cm5vIGxvY2tpbmcgbWVjaGFuaXNtLCBzbyBpdCBlcXVhbHMgYGJhbGFuY2VgIG1pbnVzIGFueSByZXNlcnZlIGhlbGQKaW4gYERhdGFLZXk6OkxvY2tlZChpZClgICgwIHRvZGF5IGZvciBldmVyeSBhZGRyZXNzKS4gUmVhZGluZyBpdCBhcwppdHMgb3duIHN0b3JhZ2UgbG9va3VwLCByYXRoZXIgdGhhbiBoYXJkY29kaW5nIGBzcGVuZGFibGUgPT0KYmFsYW5jZWAsIGxldHMgYSBmdXR1cmUgbG9jay92ZXN0aW5nIGZlYXR1cmUgcG9wdWxhdGUKYERhdGFLZXk6OkxvY2tlZGAgd2l0aG91dCBhbiBpbnRlcmZhY2UgYnJlYWsuAAAAAAAAEXNwZW5kYWJsZV9iYWxhbmNlAAAAAAAAAQAAAAAAAAACaWQAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAEZDYW5jZWxzIHRoZSBwZW5kaW5nIGFkbWluIHByb3Bvc2FsLiBPbmx5IHRoZSBjdXJyZW50IGFkbWluIGNhbiBjYW5jZWwuAAAAAAAVY2FuY2VsX2FkbWluX3RyYW5zZmVyAAAAAAAAAAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAClRva2VuRXJyb3IAAA==",
        "AAAABAAAACVDb21tb24gZXJyb3JzIHNoYXJlZCBhY3Jvc3MgY29udHJhY3RzAAAAAAAAAAAAAAtDb21tb25FcnJvcgAAAAADAAAAEkNvbnRyYWN0IGlzIHBhdXNlZAAAAAAABlBhdXNlZAAAAAAD6AAAAA9Ob3QgaW5pdGlhbGl6ZWQAAAAADk5vdEluaXRpYWxpemVkAAAAAAPpAAAAFlVuYXV0aG9yaXplZCBvcGVyYXRpb24AAAAAAAxVbmF1dGhvcml6ZWQAAAPq",
        "AAAAAgAAACpTaGFyZWQgZGF0YSBrZXlzIGZvciBhZG1pbiBhbmQgcGF1c2Ugc3RhdGUAAAAAAAAAAAANQ29tbW9uRGF0YUtleQAAAAAAAAIAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAABlBhdXNlZAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    burn: this.txFromJSON<Result<void>>,
        mint: this.txFromJSON<Result<void>>,
        name: this.txFromJSON<Result<string>>,
        admin: this.txFromJSON<Result<string>>,
        pause: this.txFromJSON<Result<void>>,
        paused: this.txFromJSON<boolean>,
        symbol: this.txFromJSON<Result<string>>,
        approve: this.txFromJSON<Result<void>>,
        balance: this.txFromJSON<i128>,
        unpause: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        decimals: this.txFromJSON<Result<u32>>,
        transfer: this.txFromJSON<Result<void>>,
        allowance: this.txFromJSON<i128>,
        burn_from: this.txFromJSON<Result<void>>,
        set_admin: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        max_supply: this.txFromJSON<Option<i128>>,
        accept_admin: this.txFromJSON<Result<void>>,
        bump_balance: this.txFromJSON<null>,
        set_metadata: this.txFromJSON<Result<void>>,
        total_supply: this.txFromJSON<i128>,
        pending_admin: this.txFromJSON<Option<string>>,
        transfer_from: this.txFromJSON<Result<void>>,
        set_max_supply: this.txFromJSON<Result<void>>,
        transfer_batch: this.txFromJSON<Result<void>>,
        spendable_balance: this.txFromJSON<i128>,
        cancel_admin_transfer: this.txFromJSON<Result<void>>
  }
}