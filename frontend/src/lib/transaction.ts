import type { xdr } from '@stellar/stellar-sdk';
import { invokeContractCall } from './stellar';

export interface TransactionStatus {
  stage: 'building' | 'simulating' | 'assembling' | 'signing' | 'submitting' | 'polling' | 'success' | 'error';
  hash?: string;
  explorerUrl?: string;
  error?: string;
}

export async function executeTransaction(options: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  sourceAddress: string;
  onStatus?: (status: TransactionStatus) => void;
}): Promise<string> {
  options.onStatus?.({ stage: 'building' });
  try {
    options.onStatus?.({ stage: 'signing' });
    const hash = await invokeContractCall({
      contractAddress: options.contractId,
      method: options.method,
      args: options.args,
      publicKey: options.sourceAddress,
    });
    options.onStatus?.({
      stage: 'success',
      hash,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${hash}`,
    });
    return hash;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transaction failed';
    options.onStatus?.({ stage: 'error', error: message });
    throw error;
  }
}
