/**
 * Unit tests for useWallet (#457).
 *
 * Covers the background polling effect that detects Freighter account and
 * network changes while the user is already connected:
 *
 *   • Account switch: store is updated, old-address cache is evicted, toast fires.
 *   • Network switch: networkMismatch is updated, warning toast fires on new mismatch.
 *   • No-op when nothing changed: store and cache are left untouched.
 *   • Effect tears down cleanly on disconnect.
 */

import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAddress, getNetwork } from "@stellar/freighter-api";
import { toast } from "sonner";
import { useWallet } from "../hooks/useWallet";
import { useWalletStore } from "@/store/walletStore";

// ── External dependency mocks ─────────────────────────────────────────────

jest.mock("@stellar/freighter-api", () => ({
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetwork: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    loading: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  },
}));

const mockGetAddress = getAddress as jest.MockedFunction<typeof getAddress>;
const mockGetNetwork = getNetwork as jest.MockedFunction<typeof getNetwork>;

// Testnet passphrase — matches STELLAR_NETWORK_PASSPHRASE in constants.ts.
const TESTNET = "Test SDF Network ; September 2015";
const MAINNET = "Public Global Stellar Network ; September 2015";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Seed a query entry so we can assert it was evicted later. */
function seedCache(qc: QueryClient, key: unknown[], data: unknown) {
  qc.setQueryData(key, data);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("useWallet background polling (#457)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    queryClient = makeQueryClient();

    // Freighter default: same address, testnet — no changes.
    mockGetAddress.mockResolvedValue({ address: "GACCOUNT_A" } as never);
    mockGetNetwork.mockResolvedValue({ networkPassphrase: TESTNET } as never);

    // Start from a clean connected state (no persisted session marker, so
    // the #456 silent-restore effect never fires in these polling tests).
    useWalletStore.setState({
      status: "connected",
      publicKey: "GACCOUNT_A",
      network: TESTNET,
      networkMismatch: false,
      error: null,
      wasConnected: false,
      lastAddress: null,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    // Wrap the store reset in act() so React can flush any pending
    // state updates triggered by the Zustand subscription before teardown.
    act(() => {
      useWalletStore.setState({
        status: "disconnected",
        publicKey: null,
        network: null,
        networkMismatch: false,
        error: null,
        wasConnected: false,
        lastAddress: null,
      });
    });
  });

  // ── Account switch ──────────────────────────────────────────────────────

  it("updates the store and evicts old-address cache when Freighter reports a new account", async () => {
    // Seed address-scoped cache entries for the old account.
    seedCache(queryClient, ["registered", "GACCOUNT_A"], true);
    seedCache(queryClient, ["profile", "GACCOUNT_A"], { username: "alice" });
    seedCache(queryClient, ["bots", "GACCOUNT_A"], [1n, 2n]);
    seedCache(queryClient, ["accrualState", "GACCOUNT_A"], { last_claim_ts: 0n, total_claimed_points: 0n });
    seedCache(queryClient, ["amtBalance", "GACCOUNT_A"], 500n);
    seedCache(queryClient, ["dashboard", "GACCOUNT_A"], {});
    seedCache(queryClient, ["myListings", "GACCOUNT_A"], []);
    seedCache(queryClient, ["botDetails", "GACCOUNT_A", "1"], { id: 1n });

    mockGetAddress.mockResolvedValue({ address: "GACCOUNT_B" } as never);

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    // Advance past one poll interval.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    // Store updated to new address.
    expect(useWalletStore.getState().publicKey).toBe("GACCOUNT_B");

    // All old-address cache entries must be gone.
    expect(queryClient.getQueryData(["registered", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["profile", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["bots", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["accrualState", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["amtBalance", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["dashboard", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["myListings", "GACCOUNT_A"])).toBeUndefined();
    expect(queryClient.getQueryData(["botDetails", "GACCOUNT_A", "1"])).toBeUndefined();
  });

  it("shows an account-switch toast with a short version of the new key", async () => {
    mockGetAddress.mockResolvedValue({ address: "GACCOUNT_BNEWXXXXXX" } as never);

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("GACC"),  // starts with G
      expect.objectContaining({ id: "account-switch" })
    );
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("XXXX"),  // ends with last 4
      expect.objectContaining({ id: "account-switch" })
    );
  });

  it("does not update the store or fire a toast when the address is unchanged", async () => {
    // getAddress already returns GACCOUNT_A — same as the store.
    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(useWalletStore.getState().publicKey).toBe("GACCOUNT_A");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("also triggers on window-focus, not only on the timer", async () => {
    mockGetAddress.mockResolvedValue({ address: "GACCOUNT_B" } as never);

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    // No timer advance — fire focus event instead.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(useWalletStore.getState().publicKey).toBe("GACCOUNT_B");
  });

  // ── Network switch ──────────────────────────────────────────────────────

  it("sets networkMismatch=true and shows a warning toast when Freighter switches to a different network", async () => {
    mockGetNetwork.mockResolvedValue({ networkPassphrase: MAINNET } as never);

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(useWalletStore.getState().networkMismatch).toBe(true);
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("Network mismatch"),
      expect.objectContaining({ id: "network-mismatch" })
    );
  });

  it("clears networkMismatch when Freighter switches back to testnet without re-toasting", async () => {
    // Start with a mismatch already in place.
    useWalletStore.setState({ networkMismatch: true });
    mockGetNetwork.mockResolvedValue({ networkPassphrase: TESTNET } as never);

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(useWalletStore.getState().networkMismatch).toBe(false);
    // Switching back to testnet is a good thing — no warning toast.
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("does not call setNetworkMismatch when the network passphrase is unchanged", async () => {
    // Already on testnet, no mismatch — store should not be written.
    const setNetworkMismatch = jest.spyOn(
      useWalletStore.getState(),
      "setNetworkMismatch"
    );

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(setNetworkMismatch).not.toHaveBeenCalled();
    setNetworkMismatch.mockRestore();
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it("silently ignores Freighter errors during a poll tick without disconnecting", async () => {
    mockGetAddress.mockRejectedValue(new Error("Freighter locked"));
    mockGetNetwork.mockRejectedValue(new Error("Freighter locked"));

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    // Still connected — transient errors don't force a disconnect.
    expect(useWalletStore.getState().status).toBe("connected");
    expect(useWalletStore.getState().publicKey).toBe("GACCOUNT_A");
  });

  // ── Effect lifecycle ────────────────────────────────────────────────────

  it("does not start polling when the wallet is not connected", async () => {
    useWalletStore.setState({ status: "disconnected", publicKey: null });

    const wrapper = makeWrapper(queryClient);
    renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    // No Freighter calls — the effect gate prevents it.
    expect(mockGetAddress).not.toHaveBeenCalled();
    expect(mockGetNetwork).not.toHaveBeenCalled();
  });

  it("stops polling after the hook unmounts", async () => {
    mockGetAddress.mockResolvedValue({ address: "GACCOUNT_B" } as never);

    const wrapper = makeWrapper(queryClient);
    const { unmount } = renderHook(() => useWallet(), { wrapper });

    unmount();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    // After unmount the interval is cleared — Freighter must not be called.
    expect(mockGetAddress).not.toHaveBeenCalled();
  });
});

/**
 * Silent session restore (#456).
 *
 * A persisted wasConnected flag must re-derive the session through
 * getAddress() on mount — without requestAccess (no popup), without a
 * toast, and with the stale flag cleared when Freighter no longer returns
 * an address (revoked access).
 */
describe("useWallet silent session restore (#456)", () => {
  let queryClient: QueryClient;

  const startDisconnectedWithFlag = (flag: boolean) => {
    useWalletStore.setState({
      status: "disconnected",
      publicKey: null,
      network: null,
      networkMismatch: false,
      error: null,
      wasConnected: flag,
      lastAddress: flag ? "GACCOUNT_A" : null,
    });
  };

  beforeEach(() => {
    queryClient = makeQueryClient();
    jest.clearAllMocks();
    mockGetAddress.mockResolvedValue({ address: "GACCOUNT_A" } as never);
    mockGetNetwork.mockResolvedValue({ networkPassphrase: TESTNET } as never);
    startDisconnectedWithFlag(true);
  });

  afterEach(() => {
    act(() => {
      useWalletStore.setState({
        status: "disconnected",
        publicKey: null,
        network: null,
        networkMismatch: false,
        error: null,
        wasConnected: false,
        lastAddress: null,
      });
    });
  });

  const mountWallet = async () => {
    const wrapper = makeWrapper(queryClient);
    const utils = renderHook(() => useWallet(), { wrapper });
    // Flush the restore effect's promise chain.
    await act(async () => {});
    return utils;
  };

  it("restores a connected session from the persisted flag without a popup", async () => {
    await mountWallet();

    const state = useWalletStore.getState();
    expect(state.status).toBe("connected");
    expect(state.publicKey).toBe("GACCOUNT_A");
    expect(state.network).toBe(TESTNET);
    expect(state.networkMismatch).toBe(false);

    // getAddress re-derives the session — requestAccess would open the popup.
    expect(mockGetAddress).toHaveBeenCalled();
    expect(
      (jest.requireMock("@stellar/freighter-api") as { requestAccess: jest.Mock }).requestAccess
    ).not.toHaveBeenCalled();
    // The restore is silent — no connection toasts.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("marks a network mismatch when the restored wallet is on the wrong network", async () => {
    mockGetNetwork.mockResolvedValue({ networkPassphrase: MAINNET } as never);

    await mountWallet();

    const state = useWalletStore.getState();
    expect(state.status).toBe("connected");
    expect(state.networkMismatch).toBe(true);
  });

  it("clears the stale flag when Freighter no longer returns an address (revoked access)", async () => {
    mockGetAddress.mockResolvedValue({
      address: "",
      error: { code: -1, message: "User has not authorized this app" },
    } as never);

    await mountWallet();

    expect(useWalletStore.getState().wasConnected).toBe(false);
    expect(useWalletStore.getState().status).toBe("disconnected");
    expect(useWalletStore.getState().publicKey).toBeNull();
  });

  it("keeps the flag when the wallet is merely locked, so unlocking + reload restores", async () => {
    mockGetAddress.mockResolvedValue({
      address: "",
      error: { code: -1, message: "Wallet is locked" },
    } as never);

    await mountWallet();

    expect(useWalletStore.getState().wasConnected).toBe(true);
    expect(useWalletStore.getState().status).toBe("disconnected");
  });

  it("does nothing on mount when no session was persisted", async () => {
    startDisconnectedWithFlag(false);

    await mountWallet();

    expect(mockGetAddress).not.toHaveBeenCalled();
    expect(useWalletStore.getState().status).toBe("disconnected");
  });
});
