import {
  Contract,
  TransactionBuilder,
  scValToNative,
  xdr,
  SorobanRpc,
} from "@stellar/stellar-sdk";
import {
  BASE_FEE,
  SOROBAN_RPC_URL,
  SOROBAN_RPC_URLS,
  STELLAR_NETWORK_PASSPHRASE,
  TX_TIMEOUT,
} from "./constants";
import {
  rpcCall,
  getServer,
  signTx,
  TxSendFailedError,
  TxFailedError,
  TxTimeoutError,
  UserRejectedError,
} from "./stellar";
import { withRetry } from "./rpcRetry";

/**
 * Multiplier applied to the assembled resource fee to add a safety buffer.
 * Configurable via NEXT_PUBLIC_FEE_MULTIPLIER env var (default 1.0).
 * Applied AFTER server.prepareTransaction assembles the resource fee.
 */
const FEE_MULTIPLIER = Number(process.env.NEXT_PUBLIC_FEE_MULTIPLIER) || 1.0;

/**
 * Transaction execution stage for status callbacks.
 */
export type TransactionStage =
  | "building"
  | "simulating"
  | "assembling"
  | "signing"
  | "submitting"
  | "polling"
  | "success"
  | "error";

/**
 * Status callback data passed to onStatus during transaction execution.
 */
export interface TransactionStatus {
  stage: TransactionStage;
  hash?: string;
  explorerUrl?: string;
  error?: string;
}

/**
 * Parameters for executeTransaction.
 */
export interface ExecuteTransactionParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  sourceAddress: string;
  onStatus?: (status: TransactionStatus) => void;
}

/**
 * Per-account sequence tracking state.
 */
interface SequenceState {
  current: number;
  pending: number;
  queue: (() => Promise<unknown>)[];
  processing: boolean;
}

/**
 * Module-level tracking of pending sequence numbers per account address.
 * Used to serialize transaction submissions and avoid bad sequence errors.
 */
const sequenceState = new Map<string, SequenceState>();

/**
 * Get or initialize the sequence state for an account.
 */
function getSequenceState(address: string): SequenceState {
  if (!sequenceState.has(address)) {
    sequenceState.set(address, {
      current: 0,
      pending: 0,
      queue: [],
      processing: false,
    });
  }
  return sequenceState.get(address)!;
}

/**
 * Process the transaction queue for an account serially.
 * Ensures submissions are serialized and sequence numbers stay in sync.
 */
async function processQueue(address: string): Promise<void> {
  const state = getSequenceState(address);
  if (state.processing) return;

  state.processing = true;
  try {
    while (state.queue.length > 0) {
      const tx = state.queue.shift();
      if (tx) {
        try {
          await tx();
        } catch {
          // Error already handled by caller
        }
      }
    }
  } finally {
    state.processing = false;
  }
}

/**
 * Build explorer URL from transaction hash.
 */
function buildExplorerUrl(hash: string): string {
  const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL || "";
  if (!horizonUrl) return "";
  return `${horizonUrl}/transactions/${hash}`;
}

/**
 * Submit a signed transaction and poll until confirmation, with hash extraction.
 * Similar to submitTx but also returns the transaction hash.
 */
async function submitTxWithHash(
  signedXdr: string
): Promise<{ hash: string; result: unknown }> {
  const server = getServer();

  // Rebuild to validate the XDR
  let txToSend: unknown = signedXdr;
  try {
    const maybeFromXdr = (TransactionBuilder as unknown as {
      fromXDR?: (xdr: string, passphrase: string) => unknown;
    }).fromXDR;
    if (typeof maybeFromXdr === "function") {
      txToSend = maybeFromXdr.call(TransactionBuilder, signedXdr, STELLAR_NETWORK_PASSPHRASE);
    } else {
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
    sendRes = await (server as unknown as {
      sendTransaction: (tx: unknown) => Promise<SorobanRpc.Api.SendTransactionResponse>;
    }).sendTransaction(txToSend as never);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

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

  // Poll with exponential backoff and a hard timeout
  const timeoutMs = (TX_TIMEOUT + 30) * 1000;
  const start = Date.now();
  let delayMs = 1000;
  const maxDelayMs = 8000;

  while (Date.now() - start < timeoutMs) {
    let getRes: SorobanRpc.Api.GetTransactionResponse | undefined;
    try {
      getRes = await server.getTransaction(hash);
    } catch {
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
      const ret = (getRes as unknown as { returnValue?: xdr.ScVal }).returnValue;
      let result: unknown = undefined;
      if (ret) {
        try {
          result = scValToNative(ret);
        } catch {
          result = undefined;
        }
      }
      return { hash, result };
    }

    if (status === "FAILED") {
      const diag =
        (getRes as unknown as { resultXdr?: string }).resultXdr ??
        (getRes as unknown as { errorResultXdr?: string }).errorResultXdr;
      throw new TxFailedError(
        `Transaction failed on-chain: ${diag ?? "unknown"}`,
        diag
      );
    }

    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }

  throw new TxTimeoutError(`Transaction ${hash} not confirmed within ${timeoutMs}ms`);
}

/**
 * Unified transaction pipeline: build → simulate → assemble → sign → submit → poll → decode.
 *
 * Handles:
 * - Building a Soroban contract invocation with proper fees
 * - Simulating to get resource footprint
 * - Assembling with prepareTransaction
 * - Signing via Freighter
 * - Submitting to RPC
 * - Polling for confirmation (with timeout)
 * - Decoding and returning the contract return value
 * - Sequence number management (incremented before each submission, reconciled after)
 * - Automatic retry on BAD_SEQ with refreshed account state
 *
 * @param params execution parameters including contract, method, args, and address
 * @returns the decoded contract return value (or undefined if void)
 * @throws UserRejectedError when the user rejects signing
 * @throws TxSendFailedError when submission fails
 * @throws TxFailedError when the transaction fails on-chain
 * @throws Error for simulation, build, or other failures
 */
export async function executeTransaction(
  params: ExecuteTransactionParams
): Promise<unknown> {
  const {
    contractId,
    method,
    args,
    sourceAddress,
    onStatus,
  } = params;

  const state = getSequenceState(sourceAddress);

  return new Promise((resolve, reject) => {
    const queuedTx = async () => {
      try {
        const result = await executeTransactionInternal(
          contractId,
          method,
          args,
          sourceAddress,
          onStatus,
          state
        );
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    state.queue.push(queuedTx);
    processQueue(sourceAddress);
  });
}

/**
 * Internal transaction execution with sequence management.
 */
async function executeTransactionInternal(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  onStatus: ((status: TransactionStatus) => void) | undefined,
  sequenceState: SequenceState
): Promise<unknown> {
  onStatus?.({ stage: "building" });

  const contract = new Contract(contractId);
  const account = await rpcCall((server) => server.getAccount(sourceAddress));

  // Initialize sequence tracking on first transaction for this account
  if (sequenceState.current === 0) {
    sequenceState.current = Number(account.sequenceNumber());
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build();

  onStatus?.({ stage: "simulating" });

  const simResult = await rpcCall((server) =>
    withRetry(() => server.simulateTransaction(tx))
  );

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const errorMsg = `Simulation failed for ${method}: ${simResult.error}`;
    onStatus?.({
      stage: "error",
      error: errorMsg,
    });
    throw new Error(errorMsg);
  }

  onStatus?.({ stage: "assembling" });

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();

  // Apply fee multiplier to assembled resource fee for surge buffer
  if (FEE_MULTIPLIER !== 1.0) {
    const baseFeeNum = parseInt(assembled.fee, 10);
    const multipliedFee = Math.ceil(baseFeeNum * FEE_MULTIPLIER).toString();
    assembled.fee = multipliedFee;
  }

  const xdr = assembled.toXDR();

  onStatus?.({ stage: "signing" });

  let signedXdr: string;
  try {
    signedXdr = await signTx(xdr, sourceAddress);
  } catch (error) {
    if (error instanceof UserRejectedError) {
      onStatus?.({ stage: "error", error: error.message });
      throw error;
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    onStatus?.({ stage: "error", error: errorMsg });
    throw error;
  }

  onStatus?.({ stage: "submitting" });

  // Increment pending sequence for this submission
  sequenceState.pending = sequenceState.current + 1;

  try {
    const { hash, result } = await submitTxWithHash(signedXdr);

    onStatus?.({
      stage: "polling",
      hash,
    });

    // Increment current sequence on successful submission
    sequenceState.current = sequenceState.pending;

    const explorerUrl = buildExplorerUrl(hash);
    onStatus?.({ stage: "success", hash, explorerUrl });

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Check if this is a BAD_SEQ error
    if (
      error instanceof TxSendFailedError &&
      errorMsg.includes("BAD_SEQ")
    ) {
      // Retry once with refreshed account state
      const refreshedAccount = await rpcCall((server) =>
        server.getAccount(sourceAddress)
      );
      sequenceState.current = Number(refreshedAccount.sequenceNumber());
      sequenceState.pending = sequenceState.current + 1;

      onStatus?.({ stage: "building" });

      // Rebuild with new sequence from refreshed account
      const retryTx = new TransactionBuilder(refreshedAccount, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(TX_TIMEOUT)
        .build();

      onStatus?.({ stage: "simulating" });

      const retrySimResult = await rpcCall((server) =>
        withRetry(() => server.simulateTransaction(retryTx))
      );

      if (SorobanRpc.Api.isSimulationError(retrySimResult)) {
        const retryError = `Simulation failed on retry for ${method}: ${retrySimResult.error}`;
        onStatus?.({ stage: "error", error: retryError });
        throw new Error(retryError);
      }

      onStatus?.({ stage: "assembling" });

      const retryAssembled = SorobanRpc.assembleTransaction(
        retryTx,
        retrySimResult
      ).build();

      if (FEE_MULTIPLIER !== 1.0) {
        const baseFeeNum = parseInt(retryAssembled.fee, 10);
        const multipliedFee = Math.ceil(baseFeeNum * FEE_MULTIPLIER).toString();
        retryAssembled.fee = multipliedFee;
      }

      const retryXdr = retryAssembled.toXDR();
      
      onStatus?.({ stage: "signing" });
      const retrySignedXdr = await signTx(retryXdr, sourceAddress);

      onStatus?.({ stage: "submitting" });

      const { hash: retryHash, result: retryResult } = await submitTxWithHash(retrySignedXdr);

      sequenceState.current = sequenceState.pending;

      const explorerUrl = buildExplorerUrl(retryHash);
      onStatus?.({ stage: "success", hash: retryHash, explorerUrl });

      return retryResult;
    }

    onStatus?.({ stage: "error", error: errorMsg });
    throw error;
  }
}

/**
 * Reset sequence state for all accounts. Test-only utility.
 */
export function __resetSequenceStateForTests(): void {
  sequenceState.clear();
}
