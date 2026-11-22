/**
 * Render-cost guarantees for the wallet store selectors (#505).
 *
 * The store is a single zustand object holding connection status, the public
 * key, the network passphrase and the last error. Before named selectors
 * existed, `useWallet` subscribed to the whole store, so writing an error
 * message re-rendered the header even though the header never displays one.
 * These tests pin that behaviour down: a subscriber only re-renders when the
 * exact value it selected changes.
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useWalletStore,
  selectPublicKey,
  selectStatus,
  selectError,
} from "@/store/walletStore";
import { useWallet } from "@/hooks/useWallet";

jest.mock("@stellar/freighter-api", () => ({
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetwork: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    loading: jest.fn(),
    warning: jest.fn(),
  },
}));

/** useWallet reads a QueryClient, so any component using it needs a provider. */
function withQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

const INITIAL = {
  status: "disconnected" as const,
  publicKey: null,
  network: null,
  networkMismatch: false,
  error: null,
};

beforeEach(() => {
  act(() => {
    useWalletStore.setState(INITIAL);
  });
});

describe("wallet store selectors", () => {
  it("selectPublicKey and selectStatus read the live store value", () => {
    act(() => {
      useWalletStore.getState().setConnected("GABC", "Test SDF Network ; September 2015");
    });

    expect(selectPublicKey(useWalletStore.getState())).toBe("GABC");
    expect(selectStatus(useWalletStore.getState())).toBe("connected");
    expect(selectError(useWalletStore.getState())).toBeNull();
  });

  it("does not re-render a publicKey subscriber when only error changes", () => {
    const renders = jest.fn();

    function PublicKeyOnly() {
      const publicKey = useWalletStore(selectPublicKey);
      renders();
      return <span data-testid="pk">{publicKey ?? "none"}</span>;
    }

    render(<PublicKeyOnly />);
    const before = renders.mock.calls.length;

    act(() => {
      useWalletStore.setState({ error: "Freighter rejected the request" });
    });

    expect(renders.mock.calls.length).toBe(before);
    expect(screen.getByTestId("pk")).toHaveTextContent("none");
  });

  it("re-renders a publicKey subscriber when publicKey itself changes", () => {
    const renders = jest.fn();

    function PublicKeyOnly() {
      const publicKey = useWalletStore(selectPublicKey);
      renders();
      return <span data-testid="pk">{publicKey ?? "none"}</span>;
    }

    render(<PublicKeyOnly />);
    const before = renders.mock.calls.length;

    act(() => {
      useWalletStore.setState({ publicKey: "GNEW" });
    });

    expect(renders.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId("pk")).toHaveTextContent("GNEW");
  });
});

describe("useWallet subscription surface", () => {
  it("does not re-render a component that only renders the public key when error changes", () => {
    const renders = jest.fn();

    function HeaderLike() {
      const { publicKey } = useWallet();
      renders();
      return <span data-testid="header-pk">{publicKey ?? "none"}</span>;
    }

    render(withQueryClient(<HeaderLike />));
    const before = renders.mock.calls.length;

    act(() => {
      useWalletStore.setState({ error: "Simulation failed" });
    });

    expect(renders.mock.calls.length).toBe(before);
  });

  it("re-renders when a field it does expose changes", () => {
    const renders = jest.fn();

    function HeaderLike() {
      const { networkMismatch } = useWallet();
      renders();
      return <span data-testid="mismatch">{String(networkMismatch)}</span>;
    }

    render(withQueryClient(<HeaderLike />));
    const before = renders.mock.calls.length;

    act(() => {
      useWalletStore.getState().setNetworkMismatch(true);
    });

    expect(renders.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId("mismatch")).toHaveTextContent("true");
  });
});
