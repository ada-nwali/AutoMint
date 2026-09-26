import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
  xdr,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getNetwork as freighterGetNetwork,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";
import {
  BASE_FEE,
  SOROBAN_RPC_URL,
  SOROBAN_RPC_URLS,
  RPC_FAILOVER_AFTER,
  STELLAR_NETWORK_PASSPHRASE,
  TX_TIMEOUT,
} from "./constants";
import { withRetry, isRetryableRpcError } from "./rpcRetry";
import { useWalletStore } from "@/store/walletStore";

/**
 * Multiplier applied to the assembled resource fee to add a safety buffer.
 * Configurable via NEXT_PUBLIC_FEE_MULTIPLIER env var (default 1.0).
 * Applied AFTER server.prepareTransaction assembles the resource fee,
 * not before, to ensure the base fee covers the simulated cost.
 */
const FEE_MULTIPLIER = Number(process.env.NEXT_PUBLIC_FEE_MULTIPLIER) || 1.0;

/**
 * Memoized {@link SorobanRpc.Server} instances keyed by endpoint URL, so
 * each configured RPC URL keeps one client (and one HTTP connection pool)
 * for the lifetime of the page (#454).
 */
const _servers = new Map<string, SorobanRpc.Server>();

/** Index into {@link SOROBAN_RPC_URLS} of the endpoint currently in use. */
let _activeIndex = 0;

/**
 * Consecutive retryable failures against the active endpoint. Reaches
 * {@link RPC_FAILOVER_AFTER} → rotate to the next URL; any success resets
 * it to zero (#454).
 */
let _consecutiveFailures = 0;

/** The RPC endpoint currently serving calls — surfaced for the status UI. */
export function getActiveRpcUrl(): string {
  return SOROBAN_RPC_URLS[_activeIndex] ?? SOROBAN_RPC_URL;
}

/** Every configured RPC endpoint, in failover order (#454). */
export function getRpcEndpoints(): readonly string[] {
  return SOROBAN_RPC_URLS;
}

/**
 * Reset module-level endpoint state. Test-only — keeps failover cases in
 * one file from seeing each other's active index.
 */
export function __resetRpcFailoverStateForTests(): void {
  _activeIndex = 0;
  _consecutiveFailures = 0;
  _servers.clear();
}

function serverFor(url: string): SorobanRpc.Server {
  let server = _servers.get(url);
  if (!server) {
    server = new SorobanRpc.Server(url, {
      allowHttp: url.startsWith("http://"),
    });
    _servers.set(url, server);
  }
  return server;
}

/**
 * Returns a memoized {@link SorobanRpc.Server} pointed at the *active*
 * endpoint. The instance is created on first use per URL and reused on
 * every subsequent call. Because failover can rotate the active URL, call
 * this (or use {@link rpcCall}) per operation rather than caching the
 * server across a retry loop (#454).
 */
export function getServer(): SorobanRpc.Server {
  return serverFor(getActiveRpcUrl());
}

/** Record a transient failure; rotate the endpoint once the threshold is hit. */
function noteRpcFailure(error: unknown): void {
  if (!isRetryableRpcError(error)) return;
  if (SOROBAN_RPC_URLS.length <= 1) return;

  _consecutiveFailures += 1;
  if (_consecutiveFailures >= RPC_FAILOVER_AFTER) {
    _activeIndex = (_activeIndex + 1) % SOROBAN_RPC_URLS.length;
    _consecutiveFailures = 0;
  }
}

/** A healthy response proves the active endpoint works again. */
function noteRpcSuccess(): void {
  _consecutiveFailures = 0;
}

/**
 * Run an **idempotent** RPC operation with retry + failover (#454).
 *
 * - Each attempt resolves the server *fresh* via {@link getServer}, so a
 *   failover triggered by an earlier attempt is picked up immediately.
 * - Transient failures (502/503/504, rate limits, transport errors) are
 *   retried with exponential backoff and jitter by {@link withRetry}.
 * - After {@link RPC_FAILOVER_AFTER} consecutive transient failures the
 *   active endpoint rotates to the next URL in `SOROBAN_RPC_URLS`.
 * - Deterministic errors (contract rejections, wallet errors) surface
 *   immediately without retry or failover.
 *
 * Never wrap `sendTransaction` in this helper — submissions are not
 * idempotent and must be attempted exactly once (#454).
 */
export async function rpcCall<T>(
  fn: (server: SorobanRpc.Server) => Promise<T>
): Promise<T> {
  return withRetry(
    async () => {
      try {
        const result = await fn(getServer());
        noteRpcSuccess();
        return result;
      } catch (error) {
        noteRpcFailure(error);
        throw error;
      }
    },
    { idempotent: true }
  );
}

/**
 * Heuristic for turning a Freighter API error (or thrown value) into a
 * user-facing message. Freighter v3 returns `{ error: { code, message } }`
 * objects rather than throwing, but older paths / the extension bridge can
 * still throw, so we handle both.
 */
function describeFreighterError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("lock")) {
    return "Your Freighter wallet is locked. Please unlock it and try again.";
  }
  if (
    lower.includes("reject") ||
    lower.includes("denied") ||
    lower.includes("declined") ||
    lower.includes("cancel")
  ) {
    return "Connection request was rejected in Freighter.";
  }
  return message;
}

/**
 * Trigger the Freighter authorization popup and return the connected wallet's
 * public key and network.
 *
 * Throws descriptive {@link Error}s for the common failure modes so the UI can
 * catch and display them:
 * - Freighter extension not installed / not detected
 * - wallet locked
 * - user rejected the access request
 *
 * @returns the connected account's `publicKey` and its `network` label
 */
export async function connectFreighter(): Promise<{
  publicKey: string;
  network: string;
}> {
  // 1. Detect the extension. `isConnected` reports whether Freighter is
  //    installed and reachable in the current browser.
  let connected: { isConnected: boolean; error?: { message: string } };
  try {
    connected = await freighterIsConnected();
  } catch {
    throw new Error(
      "Freighter wallet extension is not installed or could not be detected."
    );
  }
  if (connected?.error || !connected?.isConnected) {
    throw new Error(
      "Freighter wallet extension is not installed or could not be detected."
    );
  }

  // 2. Request access — this opens the authorization popup.
  let access: { address: string; error?: { message: string } };
  try {
    access = await freighterRequestAccess();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(describeFreighterError(msg));
  }
  if (access?.error) {
    throw new Error(describeFreighterError(access.error.message));
  }
  if (!access?.address) {
    throw new Error("Freighter did not return a public key.");
  }

  // 3. Fetch the active network (best-effort).
  let network = "";
  try {
    const net = await freighterGetNetwork();
    if (!net?.error && net?.network) {
      network = net.network;
    }
  } catch {
    // A missing network shouldn't block an otherwise successful connection.
  }

  return { publicKey: access.address, network };
}

// -- Read-path caching (#482) -----------------------------------------------

/**
 * How long a fetched account stays fresh in the read cache (#482).
 *
 * Deliberately shorter than the dashboard poll cadence (`DASHBOARD_POLL_MS`,
 * 30s): every polling hook in a poll round shares one `getAccount`, and a
 * later round only reuses an entry if it fires within this window.
 */
export const ACCOUNT_CACHE_TTL_MS = 10_000;

/** The account type `server.getAccount` resolves to. */
type CachedAccount = Awaited<ReturnType<SorobanRpc.Server["getAccount"]>>;

interface TtlEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

/** Accounts memoized by address for {@link ACCOUNT_CACHE_TTL_MS} (#482). */
const _accountCache = new Map<string, TtlEntry<CachedAccount>>();

/**
 * In-flight simulations keyed by `(contractId, method, args)` (#482).
 * Entries exist only while a simulation is pending -- settled promises are
 * removed, so results are never served stale and failures never stick.
 */
const _simulationInflight = new Map<string, Promise<unknown>>();

/**
 * Drop every cached read (#482).
 *
 * Cache invalidation rules:
 *  1. **TTL** -- account entries expire {@link ACCOUNT_CACHE_TTL_MS} after
 *     creation; an expired entry is replaced on the next read.
 *  2. **Confirmed transactions** -- {@link submitTx} calls this when a
 *     transaction reaches a terminal on-chain state (`SUCCESS` *or*
 *     `FAILED`): either outcome consumes a sequence number and may change
 *     balances / contract state that the caches would otherwise keep
 *     serving stale.
 *  3. **Errors** -- a rejected `getAccount` drops its own entry immediately,
 *     so failures are never cached. Simulation promises are removed when
 *     they settle, so only *concurrent* identical calls share one
 *     in-flight promise.
 */
export function invalidateReadCaches(): void {
  _accountCache.clear();
  _simulationInflight.clear();
}

/**
 * `getAccount` memoized by address with a short TTL (#482).
 *
 * The cached *promise* is stored, so concurrent readers (six polling hooks
 * firing in the same tick) share a single RPC round trip even before the
 * first one resolves: six reads make one account fetch.
 */
async function getAccountCached(sourceAddress: string): Promise<CachedAccount> {
  const now = Date.now();
  const hit = _accountCache.get(sourceAddress);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = rpcCall((server) => server.getAccount(sourceAddress));
  _accountCache.set(sourceAddress, {
    promise,
    expiresAt: now + ACCOUNT_CACHE_TTL_MS,
  });
  try {
    return await promise;
  } catch (error) {
    // Never cache a failed fetch -- drop *our* entry (a newer one may have
    // replaced it meanwhile) so the next read retries from scratch.
    if (_accountCache.get(sourceAddress)?.promise === promise) {
      _accountCache.delete(sourceAddress);
    }
    throw error;
  }
}

/**
 * Stable cache key for a simulation: `(contractId, method, args)` (#482).
 * Args are XDR-encoded when possible so distinct ScVals never collide;
 * test doubles without `toXDR` fall back to JSON.
 */
function simulationKey(
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): string {
  const parts = args.map((arg) => {
    try {
      const maybe = arg as unknown as {
        toXDR?: () => { toString(encoding: string): string };
      };
      if (typeof maybe.toXDR === "function") {
        return maybe.toXDR().toString("base64");
      }
    } catch {
      // fall through to JSON
    }
    return JSON.stringify(arg);
  });
  return [contractId, method, parts.join("|")].join(" ");
}

/**
 * Read-only contract simulation helper.
 *
 * Builds a transaction that invokes `method(...args)` on `contractId`, submits
 * it to the RPC's `simulateTransaction`, and decodes the return value to a
 * native JS value. No signing or submission occurs, so `sourceAddress` only
 * needs to be a real (loadable) account — it never signs anything.
 *
 * Two read-path caches apply (#482):
 *  - `sourceAddress`'s account is fetched through `getAccountCached`
 *    (short TTL), so a poll round of identical reads costs one `getAccount`.
 *  - Concurrently identical simulations `(contractId, method, args)` share
 *    one in-flight promise; the entry is removed as soon as it settles.
 *
 * Callers declare the shape they expect through `T`
 * (`simulateContractCall<bigint>(...)`); the decode itself is not validated
 * against it, so callers that cannot trust the contract still narrow the
 * result (e.g. `Array.isArray`) before use.
 *
 * A simulation succeeded when the RPC returned a `result` — the truthiness of
 * the decoded value says nothing about it, so a function returning `0`,
 * `false`, `""` or `[]` decodes to exactly that. A function returning `()`
 * (or an `Option::None`, which Soroban encodes as void) resolves to
 * `undefined` rather than throwing.
 *
 * @throws Error when the simulation fails or the RPC returns no `result`.
 */
export async function simulateContractCall<T = unknown>(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string
): Promise<T | undefined> {
  // Deduplicate concurrent identical simulations (#482): callers sharing a
  // (contractId, method, args) key await the same in-flight promise.
  const key = simulationKey(contractId, method, args);
  const inflight = _simulationInflight.get(key);
  if (inflight) return inflight as Promise<T | undefined>;

  const run = (async (): Promise<T | undefined> => {
    const contract = new Contract(contractId);
    const account = await getAccountCached(sourceAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT)
      .build();

    const result = await rpcCall((server) => server.simulateTransaction(tx));

    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new Error(`Simulation failed for ${method}: ${result.error}`);
    }

    if (!result.result) {
      throw new Error(`No result from simulation of ${method}`);
    }

    const { retval } = result.result;
    if (!retval || retval.switch().name === "scvVoid") {
      return undefined;
    }

    return scValToNative(retval) as T;
  })();

  _simulationInflight.set(key, run);
  try {
    return await run;
  } finally {
    // Only concurrent callers share the promise -- once it settles the entry
    // is dropped so later reads see fresh state (and failures do not stick).
    _simulationInflight.delete(key);
  }
}

/**
 * Build a state-changing transaction that invokes `method(...args)` on
 * `contractId` and returns its base64 XDR, ready for the wallet to sign.
 *
 * Unlike a bare `TransactionBuilder` fee, `BASE_FEE` alone only covers the
 * classic-operation inclusion fee. Every Soroban invocation also carries a
 * resource fee (CPU instructions, ledger read/write bytes/entries) that
 * varies per contract and per call. `server.prepareTransaction` simulates
 * the call and pads the tx fee with that simulated resource cost — skipped,
 * the resource fee is 0 and the ledger footprint is empty, so the tx is
 * rejected on submission regardless of how high BASE_FEE is set. This
 * applies to every write across all 5 contracts (registry, bot_nft, accrual,
 * marketplace, token), including each leg of the register → mint_basic →
 * start_accrual flow.
 *
 * After assembly, the fee is multiplied by `FEE_MULTIPLIER` (configurable
 * via `NEXT_PUBLIC_FEE_MULTIPLIER`, default 1.0) to add a safety buffer
 * during network congestion.
 */
export async function buildPreparedTx(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string
): Promise<string> {
  const contract = new Contract(contractId);
  const account = await rpcCall((server) => server.getAccount(sourceAddress));

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build();

  const prepared = await rpcCall((server) => server.prepareTransaction(tx));

  // Apply fee multiplier to assembled resource fee for surge buffer
  if (FEE_MULTIPLIER !== 1.0) {
    const baseFeeNum = parseInt(prepared.fee, 10);
    const multipliedFee = Math.ceil(baseFeeNum * FEE_MULTIPLIER).toString();
    prepared.fee = multipliedFee;
  }

  return prepared.toXDR();
}

export function addressToScVal(address: string): xdr.ScVal {
  return nativeToScVal(address, { type: "address" });
}

export function u64ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

export function i128ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function stringToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "string" });
}

export function boolToScVal(value: boolean): xdr.ScVal {
  return nativeToScVal(value, { type: "bool" });
}

/**
 * Typed error thrown when the user explicitly rejects the signing request
 * in Freighter. The UI should stay silent on this error (no error toast)
 * — it is not a failure, just a cancellation.
 */
export class UserRejectedError extends Error {
  constructor(message = "User rejected transaction") {
    super(message);
    this.name = "UserRejectedError";
  }
}

/**
 * Thrown when `sendTransaction` itself returns `ERROR` (not `PENDING`).
 * Carries the diagnostic `errorResultXdr` for debugging.
 */
export class TxSendFailedError extends Error {
  public resultXdr?: string | undefined;
  constructor(message: string, resultXdr?: string | undefined) {
    super(message);
    this.name = "TxSendFailedError";
    this.resultXdr = resultXdr;
  }
}

/**
 * Thrown when `getTransaction` reports `FAILED` after submission.
 */
export class TxFailedError extends Error {
  public resultXdr?: string | undefined;
  constructor(message: string, resultXdr?: string | undefined) {
    super(message);
    this.name = "TxFailedError";
    this.resultXdr = resultXdr;
  }
}

/**
 * Thrown when the poll loop exceeds the hard timeout without reaching
 * `SUCCESS` or `FAILED`.
 */
export class TxTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxTimeoutError";
  }
}

function isUserRejectionMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("reject") ||
    lower.includes("cancel") ||
    lower.includes("denied") ||
    lower.includes("declined") ||
    lower.includes("user declined")
  );
}

/**
 * Request Freighter to sign the prepared XDR.
 *
 * Uses the Freighter v3 `signTransaction(xdr, { networkPassphrase, address })`
 * shape. Handles both the object return `{ signedTxXdr, error }` and the older
 * throw-on-error contract. A user rejection (cancel/decline/deny) is mapped
 * to {@link UserRejectedError} so the UI can suppress its error toast.
 *
 * @param xdr - base64 transaction XDR from `buildPreparedTx` / `buildTxXdr`
 * @param address - optional explicit signer address; falls back to the
 *   connected wallet's public key in the Zustand store.
 * @returns the signed XDR string (distinct from the input)
 */
export async function signTx(xdr: string, address?: string): Promise<string> {
  let resolvedAddress = address;
  if (!resolvedAddress) {
    try {
      const walletKey = useWalletStore.getState().publicKey;
      if (walletKey) resolvedAddress = walletKey;
    } catch {
      // Zustand store not available (e.g. in unit tests)
    }
  }

  let result: unknown;
  try {
    // Freighter v3 expects (xdr, { networkPassphrase, address })
    // Some SDK versions export signTransaction directly; handle both.
    const signer =
      (freighterSignTransaction as unknown as (
        xdr: string,
        opts: { networkPassphrase: string; address?: string }
      ) => Promise<unknown>) ?? (null as unknown as never);

    if (!signer) {
      throw new Error("Freighter signTransaction is not available");
    }

    result = await signer(xdr, {
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      ...(resolvedAddress ? { address: resolvedAddress } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isUserRejectionMessage(msg)) {
      throw new UserRejectedError(msg);
    }
    // Freighter v3 may not throw but return { error }; check below.
    // If it did throw a non-rejection error, propagate.
    if (err instanceof UserRejectedError) throw err;
    throw err instanceof Error ? err : new Error(msg);
  }

  // Handle Freighter v3 object return shape { signedTxXdr, error }
  // Some builds use signedXDR / signedTransaction aliases.
  if (typeof result === "string") {
    if (!result) throw new Error("Freighter returned empty signed XDR");
    return result;
  }

  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const errorVal = obj.error;
    if (errorVal) {
      const errMsg =
        typeof errorVal === "string"
          ? errorVal
          : (errorVal as { message?: string })?.message ?? String(errorVal);
      if (isUserRejectionMessage(errMsg)) {
        throw new UserRejectedError(errMsg);
      }
      throw new Error(errMsg);
    }

    const signed =
      (obj.signedTxXdr as string | undefined) ??
      (obj.signedXDR as string | undefined) ??
      (obj.signedTx as string | undefined) ??
      (obj.signedTransaction as string | undefined) ??
      (obj.signed_transaction as string | undefined) ??
      (obj.signed as string | undefined);

    if (signed) return signed;

    // Fallback: some Freighter builds nest under result.signedTxXdr.error style?
    throw new Error("Freighter did not return a signed transaction");
  }

  throw new Error("Unexpected Freighter signTransaction return shape");
}

/**
 * Submit a signed transaction and poll until it is confirmed on-chain.
 *
 * 1. Rebuilds the transaction from the signed XDR via
 *    `TransactionBuilder.fromXDR(xdr, networkPassphrase)` to validate it.
 * 2. Sends it via `server.sendTransaction`.
 * 3. Polls `server.getTransaction(hash)` with exponential backoff until the
 *    status leaves `NOT_FOUND`.
 * 4. Throws typed errors for `ERROR` (send failure), `FAILED` (on-chain
 *    failure with `resultXdr` diagnostic), and timeout. On `SUCCESS` returns
 *    the decoded `returnValue` (via `scValToNative`) if present.
 *
 * @param signedXdr - base64 signed transaction XDR from {@link signTx}
 * @returns the contract's return value decoded with `scValToNative`, or
 *   `undefined` when the contract returns void.
 */
export async function submitTx(signedXdr: string): Promise<unknown> {
  const server = getServer();

  // Rebuild to validate the XDR; fallback to raw string if the SDK's
  // fromXDR is unavailable (test mocks) — sendTransaction will still accept it.
  let txToSend: unknown = signedXdr;
  try {
    const maybeFromXdr = (TransactionBuilder as unknown as {
      fromXDR?: (xdr: string, passphrase: string) => unknown;
    }).fromXDR;
    if (typeof maybeFromXdr === "function") {
      txToSend = maybeFromXdr.call(TransactionBuilder, signedXdr, STELLAR_NETWORK_PASSPHRASE);
    } else {
      // Fallback via Transaction class (SDK v12 uses Transaction constructor)
      const sdk = await import("@stellar/stellar-sdk");
      const TxClass = (sdk as unknown as { Transaction?: unknown }).Transaction as
        | (new (xdr: string, passphrase: string) => unknown)
        | undefined;
      if (TxClass) {
        try {
          txToSend = new (TxClass as new (x: string, p: string) => unknown)(
            signedXdr,
            STELLAR_NETWORK_PASSPHRASE
          );
        } catch {
          txToSend = signedXdr;
        }
      }
    }
  } catch {
    txToSend = signedXdr;
  }

  let sendRes: SorobanRpc.Api.SendTransactionResponse;
  try {
    // Server accepts Transaction | string depending on SDK version; cast is safe.
    sendRes = await (server as unknown as { sendTransaction: (tx: unknown) => Promise<SorobanRpc.Api.SendTransactionResponse> }).sendTransaction(
      txToSend as never
    );
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  // The initial send leg can synchronously report ERROR (e.g. duplicate, bad seq)
  if ((sendRes as unknown as { status: string }).status === "ERROR") {
    const r = sendRes as unknown as { errorResultXdr?: string; status: string };
    throw new TxSendFailedError(
      `Transaction submission failed: ${r.errorResultXdr ?? r.status}`,
      r.errorResultXdr
    );
  }

  const hash = (sendRes as unknown as { hash?: string }).hash;
  if (!hash) {
    throw new TxSendFailedError("No transaction hash returned from sendTransaction");
  }

  // Poll with exponential backoff and a hard timeout so we never hang forever.
  const timeoutMs = (TX_TIMEOUT + 30) * 1000;
  const start = Date.now();
  let delayMs = 1000;
  const maxDelayMs = 8000;

  while (Date.now() - start < timeoutMs) {
    let getRes: SorobanRpc.Api.GetTransactionResponse | undefined;
    try {
      getRes = await server.getTransaction(hash);
    } catch {
      // Transient RPC failure — back off and retry.
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, maxDelayMs);
      continue;
    }

    const status = (getRes as unknown as { status: string }).status;

    if (status === "NOT_FOUND") {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, maxDelayMs);
      continue;
    }

    if (status === "SUCCESS") {
      // A confirmed transaction (#482) consumed the source account's
      // sequence number and may have changed balances / contract state:
      // drop cached reads so the next poll sees the new world.
      invalidateReadCaches();
      const ret = (getRes as unknown as { returnValue?: xdr.ScVal }).returnValue;
      if (ret) {
        try {
          return scValToNative(ret);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }

    if (status === "FAILED") {
      // FAILED is also a confirmed transaction: the sequence number was
      // consumed, so the account cache is stale either way (#482).
      invalidateReadCaches();
      const diag =
        (getRes as unknown as { resultXdr?: string; errorResultXdr?: string }).resultXdr ??
        (getRes as unknown as { resultXdr?: string }).resultXdr;
      throw new TxFailedError(
        `Transaction failed on-chain: ${diag ?? "unknown"}`,
        diag
      );
    }

    // Unknown status — treat as pending and back off.
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }

  throw new TxTimeoutError(`Transaction ${hash} not confirmed within ${timeoutMs}ms`);
}

/**
 * Fetch the current ledger's close time from the RPC.
 *
 * Returns a Unix timestamp (seconds since epoch) representing when the most
 * recent ledger was closed. Used to compute the client-clock offset so the
 * interpolated accrual counter stays accurate even when the browser clock is
 * skewed (#492).
 *
 * `getLatestLedger` only returns id/sequence/protocolVersion, so we probe
 * `getTransaction` with a hash that cannot exist: every response shape —
 * including NOT_FOUND — carries `latestLedgerCloseTime`. Goes through
 * {@link rpcCall} so it inherits retry + endpoint failover.
 */
export async function getLedgerCloseTime(): Promise<number> {
  const result = await rpcCall((server) =>
    server.getTransaction("0".repeat(64))
  );
  return Number(result.latestLedgerCloseTime);
}
