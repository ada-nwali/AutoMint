import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProfiles } from "../hooks/useProfiles";
import { getUsersBatch } from "@/lib/contracts";
import type { UserProfile } from "@/types";

jest.mock("@/lib/contracts", () => ({
  ...jest.requireActual("@/lib/contracts"),
  getUsersBatch: jest.fn(),
}));

const mockGetUsersBatch = getUsersBatch as jest.MockedFunction<typeof getUsersBatch>;

describe("useProfiles Hook", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("stays disabled and makes no contract call when addresses is empty", () => {
    const { result } = renderHook(() => useProfiles([]), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(mockGetUsersBatch).not.toHaveBeenCalled();
  });

  it("deduplicates addresses and maps batch results by address in a single call", async () => {
    const alice: UserProfile = {
      address: "GALICE",
      username: "alice",
      total_points: 100n,
      points: 100n,
      claimed_amt: 0n,
      claimedAmt: 0n,
      registered_at: 1_700_000_000,
      registeredAt: 1_700_000_000,
      bot_count: 1,
      botCount: 1,
    };
    mockGetUsersBatch.mockResolvedValueOnce([alice, null]);

    const { result } = renderHook(
      () => useProfiles(["GALICE", "GSTRANGER", "GALICE"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGetUsersBatch).toHaveBeenCalledTimes(1);
    expect(mockGetUsersBatch).toHaveBeenCalledWith(["GALICE", "GSTRANGER"]);
    expect(result.current.data).toEqual({
      GALICE: alice,
      GSTRANGER: null,
    });
  });

  it("caps the queried batch at 50 addresses", async () => {
    const addresses = Array.from({ length: 60 }, (_, i) => `GADDR_${i}`);
    mockGetUsersBatch.mockResolvedValueOnce(Array.from({ length: 50 }, () => null));

    const { result } = renderHook(() => useProfiles(addresses), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGetUsersBatch).toHaveBeenCalledTimes(1);
    expect(mockGetUsersBatch.mock.calls[0]?.[0]).toHaveLength(50);
  });
});
