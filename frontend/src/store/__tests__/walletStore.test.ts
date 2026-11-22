import { useWalletStore, WALLET_PERSIST_KEY, type PersistedWallet } from "../walletStore";

/** Read whatever the persist middleware last wrote to localStorage. */
function readPersisted(): { state?: PersistedWallet; version?: number } | null {
  const raw = localStorage.getItem(WALLET_PERSIST_KEY);
  return raw ? JSON.parse(raw) : null;
}

function resetStore() {
  useWalletStore.setState({
    status: "disconnected",
    publicKey: null,
    network: null,
    networkMismatch: false,
    error: null,
    wasConnected: false,
    lastAddress: null,
  });
  localStorage.removeItem(WALLET_PERSIST_KEY);
}

describe("walletStore", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  test("setConnecting updates state correctly", () => {
    useWalletStore.getState().setConnecting();
    const state = useWalletStore.getState();
    expect(state.status).toBe("connecting");
    expect(state.error).toBeNull();
  });

  test("setConnected updates state correctly", () => {
    useWalletStore.getState().setConnected("0x123", "testnet");
    const state = useWalletStore.getState();
    expect(state.status).toBe("connected");
    expect(state.publicKey).toBe("0x123");
    expect(state.network).toBe("testnet");
    expect(state.error).toBeNull();
  });

  test("setError updates state correctly", () => {
    useWalletStore.getState().setError("Connection failed");
    const state = useWalletStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("Connection failed");
  });

  test("disconnect resets state correctly", () => {
    useWalletStore.getState().setConnected("0x123", "testnet");
    useWalletStore.getState().disconnect();
    const state = useWalletStore.getState();
    expect(state.status).toBe("disconnected");
    expect(state.publicKey).toBeNull();
    expect(state.network).toBeNull();
    expect(state.networkMismatch).toBe(false);
    expect(state.error).toBeNull();
  });
});

/**
 * Persistence contract (#456).
 *
 * The store must survive a full reload with only two pieces of data — the
 * wasConnected flag and the last address — and an explicit disconnect must
 * clear them so the next load does not silently restore.
 */
describe("walletStore persistence (#456)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  test("setConnected persists only wasConnected and lastAddress", () => {
    useWalletStore.getState().setConnected("GABC123", "Test SDF Network ; September 2015");

    const persisted = readPersisted();
    expect(persisted).not.toBeNull();
    expect(persisted!.state).toEqual({
      wasConnected: true,
      lastAddress: "GABC123",
    });
    // Runtime fields and anything sensitive never reach storage.
    expect(persisted!.state).not.toHaveProperty("publicKey");
    expect(persisted!.state).not.toHaveProperty("status");
    expect(persisted!.state).not.toHaveProperty("network");
    expect(persisted!.state).not.toHaveProperty("error");
    expect(persisted!.state).not.toHaveProperty("networkMismatch");
  });

  test("disconnect clears the persisted flag so a reload does not restore", () => {
    useWalletStore.getState().setConnected("GABC123", "testnet");
    expect(readPersisted()!.state!.wasConnected).toBe(true);

    useWalletStore.getState().disconnect();

    const persisted = readPersisted();
    expect(persisted!.state).toEqual({
      wasConnected: false,
      lastAddress: null,
    });
  });

  test("explicit disconnect survives a simulated reload", () => {
    useWalletStore.getState().setConnected("GABC123", "testnet");
    useWalletStore.getState().disconnect();

    // Simulate the reload: read the flag back the way the restore effect
    // would — the store itself starts disconnected, only storage carries over.
    const { wasConnected, lastAddress } = readPersisted()!.state!;
    expect(wasConnected).toBe(false);
    expect(lastAddress).toBeNull();
  });

  test("a connected session leaves wasConnected set for the next load", () => {
    useWalletStore.getState().setConnected("GXYZ", "testnet");

    const { wasConnected, lastAddress } = readPersisted()!.state!;
    expect(wasConnected).toBe(true);
    expect(lastAddress).toBe("GXYZ");
  });

  test("clearPersistedSession drops the flag without touching live state", () => {
    useWalletStore.getState().setConnected("GABC123", "testnet");
    useWalletStore.getState().clearPersistedSession();

    const state = useWalletStore.getState();
    expect(state.wasConnected).toBe(false);
    expect(state.lastAddress).toBeNull();
    // Live session state is untouched — only the stored marker is cleared.
    expect(state.status).toBe("connected");
    expect(state.publicKey).toBe("GABC123");

    expect(readPersisted()!.state).toEqual({
      wasConnected: false,
      lastAddress: null,
    });
  });
});
