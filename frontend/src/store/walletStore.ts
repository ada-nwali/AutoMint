import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * The only two fields ever written to storage (#456).
 *
 * A `wasConnected` flag lets the app know a session existed before the
 * reload; `lastAddress` is the public key that session used so a stale or
 * foreign account is easy to spot. Neither is a secret — the private key
 * never leaves Freighter — and no other store field (status, error,
 * networkMismatch) is persisted, so a reload always starts from a clean
 * slate apart from this flag.
 */
export interface PersistedWallet {
  wasConnected: boolean;
  lastAddress: string | null;
}

export interface WalletState extends PersistedWallet {
  status: WalletStatus;
  publicKey: string | null;
  network: string | null;
  networkMismatch: boolean;
  error: string | null;
  setConnecting: () => void;
  setConnected: (publicKey: string, network: string) => void;
  setNetworkMismatch: (mismatch: boolean) => void;
  setError: (error: string) => void;
  /**
   * Explicit user disconnect. Also clears the persisted flag so the next
   * page load does NOT silently re-restore the session (#456).
   */
  disconnect: () => void;
  /**
   * Clears only the persisted session marker, leaving live state alone.
   * Used when a stored flag turns out to be stale — e.g. Freighter no
   * longer returns an address because access was revoked (#456).
   */
  clearPersistedSession: () => void;
}

export const WALLET_PERSIST_KEY = "automint-wallet";

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      status: "disconnected",
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
      wasConnected: false,
      lastAddress: null,
      setConnecting: () => set({ status: "connecting", error: null }),
      setConnected: (publicKey, network) =>
        set({
          status: "connected",
          publicKey,
          network,
          error: null,
          wasConnected: true,
          lastAddress: publicKey,
        }),
      setNetworkMismatch: (mismatch) => set({ networkMismatch: mismatch }),
      setError: (error) => set({ status: "error", error }),
      disconnect: () =>
        set({
          status: "disconnected",
          publicKey: null,
          network: null,
          networkMismatch: false,
          error: null,
          wasConnected: false,
          lastAddress: null,
        }),
      clearPersistedSession: () => set({ wasConnected: false, lastAddress: null }),
    }),
    {
      name: WALLET_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Persist ONLY the session marker and the last address. Status,
      // publicKey, network, mismatch and error are runtime state that must
      // be re-derived on every load (#456).
      partialize: (state): PersistedWallet => ({
        wasConnected: state.wasConnected,
        lastAddress: state.lastAddress,
      }),
    }
  )
);

/**
 * Named atomic selectors.
 *
 * Every call site reads store state through one of these instead of an
 * inline arrow with a hand-written parameter type. Two reasons:
 *
 *  1. **Type safety.** An inline `(s: { publicKey: string | null }) => s.publicKey`
 *     duplicates part of `WalletState` and silently drifts from it when the
 *     store changes. These selectors are typed against `WalletState` itself,
 *     so a rename or a type change is a compile error at every call site.
 *  2. **Render cost.** Each selector returns a single primitive (or a stable
 *     action reference), so zustand's default `Object.is` comparison only
 *     re-renders a subscriber when that exact value changes. Selecting an
 *     object literal — or subscribing to the whole store by calling
 *     `useWalletStore()` with no selector — re-renders every consumer on
 *     every unrelated state change.
 */
export const selectStatus = (s: WalletState): WalletStatus => s.status;
export const selectPublicKey = (s: WalletState): string | null => s.publicKey;
export const selectNetwork = (s: WalletState): string | null => s.network;
export const selectNetworkMismatch = (s: WalletState): boolean => s.networkMismatch;
export const selectError = (s: WalletState): string | null => s.error;
export const selectWasConnected = (s: WalletState): boolean => s.wasConnected;

/**
 * Action selectors. Actions are created once by the store initializer and
 * never replaced, so subscribing to one never triggers a re-render.
 */
export const selectSetConnecting = (s: WalletState) => s.setConnecting;
export const selectSetConnected = (s: WalletState) => s.setConnected;
export const selectSetNetworkMismatch = (s: WalletState) => s.setNetworkMismatch;
export const selectSetError = (s: WalletState) => s.setError;
export const selectDisconnect = (s: WalletState) => s.disconnect;
export const selectClearPersistedSession = (s: WalletState) => s.clearPersistedSession;
