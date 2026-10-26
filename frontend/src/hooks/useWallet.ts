import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { requestAccess, getAddress, getNetwork, watchWalletChanges } from "@stellar/freighter-api";
import { toast } from "sonner";
import {
  useWalletStore,
  selectStatus,
  selectPublicKey,
  selectNetwork,
  selectNetworkMismatch,
  selectError,
  selectSetConnecting,
  selectSetConnected,
  selectSetNetworkMismatch,
  selectSetError,
  selectDisconnect,
  selectWasConnected,
  selectClearPersistedSession,
} from "@/store/walletStore";
import { STELLAR_NETWORK_PASSPHRASE } from "@/lib/constants";
import { qk, DASHBOARD_POLL_MS } from "@/lib/queryKeys";

const FREIGHTER_DOWNLOAD_URL = "https://freighter.app";

function isFreighterInstalled(): boolean {
  return typeof window !== "undefined" && "freighter" in window;
}

/** Truncate a Stellar public key to a readable "G…XXXX" label for toasts. */
function shortKey(pk: string): string {
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

/**
 * Freighter API v3 resolves failed calls with an `error` field instead of
 * rejecting (#658). Throw on it so a failed call is never read as a success
 * with an empty address or a missing network.
 */
function unwrapFreighter<T extends object>(result: T): T {
  const { error } = result as { error?: { message?: string } };
  if (error) {
    throw new Error(error.message || "Freighter request failed");
  }
  return result;
}

/** The connected account from Freighter, rejecting an empty address (#658). */
async function fetchAddress(): Promise<string> {
  const { address } = unwrapFreighter(await getAddress());
  if (!address) {
    throw new Error("Freighter did not return an account address");
  }
  return address;
}

/**
 * Remove every React Query cache entry that is keyed to a specific wallet
 * address. Called when the connected account changes so the new account never
 * sees stale data from the previous session.
 *
 * We remove rather than invalidate: an invalidated entry stays in the cache
 * and triggers an immediate background refetch with the old address still
 * interpolated into the key. Removal drops it cleanly; the new address drives
 * fresh queries as hooks re-run with the updated `publicKey`.
 */
function evictAddressCache(queryClient: ReturnType<typeof useQueryClient>, address: string): void {
  const addressScoped: Array<ReturnType<typeof qk[keyof typeof qk]>> = [
    qk.registered(address),
    qk.profile(address),
    qk.profilePoints(address),
    qk.bots(address),
    qk.accrualState(address),
    qk.amtBalance(address),
    qk.dashboard(address),
    qk.myListings(address),
  ];
  for (const key of addressScoped) {
    queryClient.removeQueries({ queryKey: key });
  }
  // botDetails is keyed by address + botId — remove the whole address subtree.
  queryClient.removeQueries({ queryKey: ["botDetails", address] });
}

/**
 * Connection state and actions for the Freighter wallet.
 *
 * Subscribes atomically to only the three state fields its consumers render
 * (`status`, `publicKey`, `networkMismatch`) rather than to the whole store.
 * `network` and `error` are deliberately absent: nothing that renders the
 * header or the dashboard displays them, so subscribing to them here would
 * re-render every consumer whenever a failed connection attempt sets an
 * error message. Read them with {@link useWalletNetwork} and
 * {@link useWalletError} in the components that actually show them.
 *
 * Background polling (#457)
 * ─────────────────────────
 * While connected, a single effect polls both `getAddress()` and `getNetwork()`
 * on `DASHBOARD_POLL_MS` interval and on every `window focus` event. Two
 * independent changes are handled:
 *
 *   • Account switch: the store is updated to the new public key, all cache
 *     entries scoped to the previous address are evicted, and a toast names
 *     the incoming account.
 *   • Network switch: `networkMismatch` is updated, triggering the AM-138
 *     mismatch banner if the new network differs from `STELLAR_NETWORK_PASSPHRASE`.
 */
export function useWallet() {
  const status = useWalletStore(selectStatus);
  const publicKey = useWalletStore(selectPublicKey);
  const networkMismatch = useWalletStore(selectNetworkMismatch);
  const wasConnected = useWalletStore(selectWasConnected);

  const setConnecting = useWalletStore(selectSetConnecting);
  const setConnected = useWalletStore(selectSetConnected);
  const setNetworkMismatch = useWalletStore(selectSetNetworkMismatch);
  const setError = useWalletStore(selectSetError);
  const disconnect = useWalletStore(selectDisconnect);
  const clearPersistedSession = useWalletStore(selectClearPersistedSession);

  const queryClient = useQueryClient();

  const isConnecting = status === "connecting";
  const isNotInstalled = !isFreighterInstalled();

  const connect = useCallback(async () => {
    if (!isFreighterInstalled()) {
      toast.error("Freighter wallet is not installed", {
        action: {
          label: "Install Freighter",
          onClick: () => window.open(FREIGHTER_DOWNLOAD_URL, "_blank"),
        },
        duration: 8000,
      });
      window.open(FREIGHTER_DOWNLOAD_URL, "_blank");
      return;
    }

    // Guard: if already connecting, ignore duplicate requests (#532)
    if (status === "connecting") return;

    setConnecting();
    toast.loading("Connecting wallet...", { id: "wallet-connect" });

    try {
      unwrapFreighter(await requestAccess());
      const pk = await fetchAddress();
      const net = unwrapFreighter(await getNetwork());
      setConnected(pk, net.networkPassphrase);

      const isMismatch = net.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE;
      setNetworkMismatch(isMismatch);
      if (isMismatch) {
        toast.warning(
          `Network mismatch — Freighter is on a different network. Please switch to Testnet.`,
          { id: "wallet-connect", duration: 8000 },
        );
      } else {
        toast.success("Wallet connected!", { id: "wallet-connect" });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      toast.error(message, { id: "wallet-connect" });
    }
  }, [status, setConnecting, setConnected, setNetworkMismatch, setError]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    toast.success("Wallet disconnected");
  }, [disconnect]);

  // -------------------------------------------------------------------------
  // Silent session restore (#456)
  //
  // The store persists only a `wasConnected` flag and the last address —
  // never a secret. On mount, if that flag is set, the session is re-derived
  // with getAddress() + getNetwork(), which do NOT open the authorization
  // popup for an already-authorized origin. Freighter still holds the grant,
  // so a full page reload lands the user back where they were.
  //
  // Failure handling:
  //   • Revoked / removed access (getAddress returns no address): the stale
  //     flag is cleared so the next load starts clean.
  //   • Wallet locked (message mentions "lock"): the flag is KEPT — the user
  //     simply unlocks and reloads to restore.
  //   • Anything else: treated like revocation and cleared, so a stored flag
  //     can never strand the UI in a permanent restore loop.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!wasConnected || status !== "disconnected") return;
    let cancelled = false;

    const restore = async () => {
      try {
        const { address, error } = await getAddress();
        if (cancelled) return;

        if (error || !address) {
          const message = (error?.message ?? "").toLowerCase();
          if (!message.includes("lock")) {
            clearPersistedSession();
          }
          return;
        }

        // A failed getNetwork throws into the catch below, which applies the
        // same keep-or-clear policy as any other restore failure (#658).
        const net = unwrapFreighter(await getNetwork());
        if (cancelled) return;

        setConnected(address, net.networkPassphrase);
        setNetworkMismatch(net.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE);
      } catch (err) {
        if (cancelled) return;
        const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (!message.includes("lock")) {
          clearPersistedSession();
        }
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [wasConnected, status, setConnected, setNetworkMismatch, clearPersistedSession]);

  // -------------------------------------------------------------------------
  // Background wallet state poll (#457)
  //
  // Polls both getAddress() and getNetwork() together so the two checks share
  // one Freighter round-trip per interval. Runs every DASHBOARD_POLL_MS and
  // immediately on each window-focus event (same pattern as the network-only
  // effect it replaces).
  //
  // The effect is gated on `status === "connected"` so it never fires for a
  // visitor who has not connected yet, and tears itself down if the user
  // explicitly disconnects via the UI.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (status !== "connected") return;

    const checkWalletState = async () => {
      try {
        // Fetch both in parallel — two lightweight Freighter bridge calls.
        // A returned error skips the whole tick (the catch below), so a
        // failed read never looks like an account or network change (#658).
        const [addressResult, netResult] = await Promise.all([
          getAddress(),
          getNetwork(),
        ]);
        const { address: freshAddress } = unwrapFreighter(addressResult);
        const freshNet = unwrapFreighter(netResult);

        // ── Account change ──────────────────────────────────────────────────
        // Read the current store value inline (not from the closure) so we
        // always compare against the latest state even if the effect captured
        // an earlier render's `publicKey`.
        const currentKey = useWalletStore.getState().publicKey;
        if (freshAddress && freshAddress !== currentKey) {
          // Evict all cache entries keyed to the old address before updating
          // the store. Evicting first means no query observer can fire with
          // the old key between the two operations.
          if (currentKey) {
            evictAddressCache(queryClient, currentKey);
          }
          setConnected(freshAddress, freshNet.networkPassphrase);
          toast.info(
            `Account switched to ${shortKey(freshAddress)}`,
            { id: "account-switch", duration: 5000 },
          );
        }

        // ── Network change ──────────────────────────────────────────────────
        const isMismatch = freshNet.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE;
        const currentMismatch = useWalletStore.getState().networkMismatch;
        if (isMismatch !== currentMismatch) {
          setNetworkMismatch(isMismatch);
          if (isMismatch) {
            toast.warning(
              "Network mismatch — Freighter is on a different network. Please switch to Testnet.",
              { id: "network-mismatch", duration: 8000 },
            );
          }
        }
      } catch {
        // Freighter locked, extension uninstalled, or bridge unavailable —
        // silently skip this tick. The user can reconnect via the connect
        // button; we don't force-disconnect on a transient error.
      }
    };

    // #1455: Subscribe to Freighter wallet changes for instant detection
    let unsubscribe: (() => void) | undefined;
    try {
      if (typeof watchWalletChanges === "function") {
        unsubscribe = watchWalletChanges(checkWalletState);
      }
    } catch {
      // Fallback to polling if watchWalletChanges is unavailable in the current browser runtime
    }

    const intervalId = setInterval(checkWalletState, DASHBOARD_POLL_MS);
    window.addEventListener("focus", checkWalletState);
    return () => {
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch {
          // Ignore unsubscribe errors
        }
      }
      clearInterval(intervalId);
      window.removeEventListener("focus", checkWalletState);
    };
  }, [status, setConnected, setNetworkMismatch, queryClient]);

  return {
    status,
    publicKey,
    networkMismatch,
    connect,
    disconnect: disconnectWallet,
    isConnected: status === "connected",
    isConnecting,
    isNotInstalled,
  };
}

/** The network passphrase Freighter reports, or `null` when disconnected. */
export function useWalletNetwork(): string | null {
  return useWalletStore(selectNetwork);
}

/** The last connection error message, or `null` when there is none. */
export function useWalletError(): string | null {
  return useWalletStore(selectError);
}
