import {
  Address,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  isConnected,
  requestAccess,
  signTransaction,
  getNetworkDetails,
} from '@stellar/freighter-api';
import {
  SOROBAN_RPC_URL,
  NETWORK_PASSPHRASE,
  TX_TIMEOUT,
  BASE_FEE,
} from './constants';

// ── RPC server singleton ──────────────────────────────────────────────────────

let _server: SorobanRpc.Server | null = null;

export function getServer(): SorobanRpc.Server {
  if (!_server) {
    _server = new SorobanRpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
  }
  return _server;
}

// ── Wallet helpers ────────────────────────────────────────────────────────────

export async function checkFreighter(): Promise<boolean> {
  try {
    const result = await isConnected();
    return !!result.isConnected;
  } catch {
    return false;
  }
}

export async function connectFreighter(): Promise<{ publicKey: string; network: string }> {
  // 1. Extension installed?
  let installed = false;
  try {
    const r = await isConnected();
    installed = !!r.isConnected;
  } catch {
    installed = false;
  }
  if (!installed) throw new Error('FREIGHTER_NOT_INSTALLED');

  // 2. requestAccess() is the correct v3 entry point:
  //    - Shows "Allow this site?" popup if not yet authorized
  //    - Shows unlock screen if wallet is locked
  //    - Returns address once the user approves
  const access = await requestAccess();
  if (access.error || !access.address) {
    const raw = (access.error ?? '').toLowerCase();
    if (raw.includes('reject') || raw.includes('denied') || raw.includes('cancel')) {
      throw new Error('Connection cancelled. Approve AutoMint in the Freighter popup and try again.');
    }
    if (raw.includes('unlock') || raw.includes('locked') || raw.includes('password')) {
      throw new Error('Freighter is locked. Open the extension, enter your password, then try again.');
    }
    // Fallback — show raw error so user knows what to act on
    throw new Error(
      access.error
        ? `Freighter: ${access.error}`
        : 'Freighter did not return an address. Open Freighter, unlock it, and try again.'
    );
  }

  // 3. Read network passphrase so we can validate it client-side
  const netResult = await getNetworkDetails();
  if (netResult.error) {
    throw new Error('Could not read network from Freighter. Switch Freighter to Testnet and try again.');
  }

  return { publicKey: access.address, network: netResult.networkPassphrase };
}

// ── ScVal conversion helpers ──────────────────────────────────────────────────

export function addressToScVal(address: string): xdr.ScVal {
  return Address.fromString(address).toScVal();
}

export function u64ToScVal(value: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

export function i128ToScVal(value: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'i128' });
}

export function stringToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'string' });
}

export function boolToScVal(value: boolean): xdr.ScVal {
  return nativeToScVal(value, { type: 'bool' });
}

// ── Contract call helpers ─────────────────────────────────────────────────────

interface InvokeOptions {
  contractAddress: string;
  method: string;
  args?: xdr.ScVal[];
  publicKey: string;
}

/**
 * Simulate a read-only contract call and return the decoded result.
 */
export async function simulateContractCall<T = unknown>(
  contractAddressOrOpts: string | (Omit<InvokeOptions, 'publicKey'> & { publicKey?: string }),
  method?: string,
  args?: xdr.ScVal[],
  publicKey?: string
): Promise<T> {
  const opts = typeof contractAddressOrOpts === 'string'
    ? { contractAddress: contractAddressOrOpts, method: method ?? '', args, publicKey }
    : contractAddressOrOpts;
  const server = getServer();
  const contract = new Contract(opts.contractAddress);
  // Deployer exists on testnet and works as a caller for read-only simulations
  const caller = opts.publicKey ?? 'GDQ6QUVINBCLB3ZCA5BHDBI6E7BNJGCIDWX7WPE2F7UYSGD7P5KBPM2F';

  const account = await server.getAccount(caller);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(opts.method, ...(opts.args ?? [])))
    .setTimeout(TX_TIMEOUT)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }
  if (!simResult.result) {
    throw new Error('No result returned from simulation');
  }

  return scValToNative(simResult.result.retval) as T;
}

export async function rpcCall<T>(
  callback: (server: SorobanRpc.Server) => Promise<T> | T
): Promise<T> {
  return callback(getServer());
}

/**
 * Build, sign (with Freighter), submit a mutating contract call,
 * and poll until confirmed. Returns the transaction hash.
 */
export async function invokeContractCall(opts: InvokeOptions): Promise<string> {
  const server = getServer();
  const contract = new Contract(opts.contractAddress);

  const account = await server.getAccount(opts.publicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(opts.method, ...(opts.args ?? [])))
    .setTimeout(TX_TIMEOUT)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  const xdrString = preparedTx.toEnvelope().toXDR('base64');

  const signResult = await signTransaction(xdrString, {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: opts.publicKey,
  });

  if (signResult.error) {
    throw new Error(`Signing failed: ${signResult.error}`);
  }

  const signedTx = TransactionBuilder.fromXDR(
    signResult.signedTxXdr,
    NETWORK_PASSPHRASE
  );
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;
  let attempts = 0;
  while (attempts < 30) {
    await sleep(2000);
    const txResult = await server.getTransaction(hash);
    if (txResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (txResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
    attempts++;
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Utility helpers ───────────────────────────────────────────────────────────

export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
