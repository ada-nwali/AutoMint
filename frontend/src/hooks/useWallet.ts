'use client';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { connectFreighter } from '@/lib/stellar';
import { useWalletStore } from '@/store/walletStore';
import { FREIGHTER_DOWNLOAD } from '@/lib/constants';
import { NETWORK_PASSPHRASE } from '@/lib/constants';

export function useWallet() {
  const store = useWalletStore();

  const connect = useCallback(async () => {
    store.setConnecting();
    try {
      const { publicKey, network } = await connectFreighter();
      store.setConnected(publicKey, network);
      toast.success('Wallet connected!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      if (msg === 'FREIGHTER_NOT_INSTALLED') {
        store.setError('Freighter not installed');
        toast.error('Freighter not found. Installing now…', { duration: 3000 });
        window.open(FREIGHTER_DOWNLOAD, '_blank');
        return;
      }
      store.setError(msg);
      toast.error(msg, { duration: 6000 });
    }
  }, [store]);

  const disconnect = useCallback(() => {
    store.disconnect();
    toast.info('Wallet disconnected.');
  }, [store]);

  return {
    status: store.status,
    publicKey: store.publicKey,
    network: store.network,
    error: store.error,
    isConnected: store.status === 'connected' && !!store.publicKey,
    connect,
    disconnect,
    networkMismatch:
      store.status === 'connected' &&
      !!store.network &&
      store.network !== NETWORK_PASSPHRASE,
    isConnecting: store.status === 'connecting',
    isNotInstalled: store.error === 'Freighter not installed',
  };
}
