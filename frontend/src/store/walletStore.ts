'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WalletStatus } from '@/types';

interface WalletStore {
  status: WalletStatus;
  publicKey: string | null;
  network: string | null;
  error: string | null;
  setConnected: (publicKey: string, network: string) => void;
  setConnecting: () => void;
  setError: (error: string) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletStore>()(
  persist(
    (set) => ({
      status: 'disconnected',
      publicKey: null,
      network: null,
      error: null,

      setConnected: (publicKey, network) =>
        set({ status: 'connected', publicKey, network, error: null }),

      setConnecting: () =>
        set({ status: 'connecting', error: null }),

      setError: (error) =>
        set({ status: 'error', error }),

      disconnect: () =>
        set({ status: 'disconnected', publicKey: null, network: null, error: null }),
    }),
    {
      name: 'automint-wallet',
      partialize: (s) => ({ publicKey: s.publicKey, network: s.network }),
    }
  )
);

export const selectPublicKey = (state: WalletStore) => state.publicKey;
