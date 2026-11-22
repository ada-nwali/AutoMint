/**
 * Unit tests for app/providers.tsx (#241)
 * Tests that Providers renders children and supplies a working QueryClient context.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import Providers from "../providers";

// Test component that consumes the QueryClient context
function TestChildComponent() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["testQueryKey"],
    queryFn: () => "queryClient-working",
    initialData: "initial-test-data",
  });

  return (
    <div>
      <span data-testid="child-element">Child Content Rendered</span>
      <span data-testid="query-status">
        {queryClient ? "QueryClient Available" : "No QueryClient"}
      </span>
      <span data-testid="query-data">{data}</span>
    </div>
  );
}

describe("app/providers.tsx (#241)", () => {
  it("renders children elements without crashing", () => {
    render(
      <Providers>
        <div data-testid="simple-child">Hello Providers</div>
      </Providers>
    );

    expect(screen.getByTestId("simple-child")).toBeInTheDocument();
    expect(screen.getByText("Hello Providers")).toBeInTheDocument();
  });

  it("supplies a working QueryClient context to descendant components", () => {
    render(
      <Providers>
        <TestChildComponent />
      </Providers>
    );

    expect(screen.getByTestId("child-element")).toHaveTextContent("Child Content Rendered");
    expect(screen.getByTestId("query-status")).toHaveTextContent("QueryClient Available");
    expect(screen.getByTestId("query-data")).toHaveTextContent("initial-test-data");
  });

  it("initializes QueryClient with expected default options", () => {
    let capturedClient: any = null;

    function ConfigCaptureComponent() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <Providers>
        <ConfigCaptureComponent />
      </Providers>
    );

    expect(capturedClient).toBeDefined();
    const defaultQueryOptions = capturedClient.getDefaultOptions().queries;
    // staleTime is 0 globally so invalidation refetches at once (#496); each
    // query declares its own longer window where it wants one.
    expect(defaultQueryOptions.staleTime).toBe(0);
    // retry is a predicate now, not a fixed count (#497).
    expect(typeof defaultQueryOptions.retry).toBe("function");
    expect(defaultQueryOptions.refetchOnWindowFocus).toBe(false);
    expect(defaultQueryOptions.refetchOnReconnect).toBe(false);

    const defaultMutationOptions = capturedClient.getDefaultOptions().mutations;
    expect(typeof defaultMutationOptions.retry).toBe("function");
  });

  it("query retry predicate: retries a network blip, never a contract or rejection error (#497)", () => {
    let capturedClient: any = null;
    function Capture() {
      capturedClient = useQueryClient();
      return null;
    }
    render(
      <Providers>
        <Capture />
      </Providers>
    );
    const retry = capturedClient.getDefaultOptions().queries.retry;
    expect(retry(0, new Error("failed to fetch: soroban rpc timeout"))).toBe(true);
    expect(retry(0, new Error("Error(Contract, #4): simulation failed"))).toBe(false);
    expect(retry(0, new Error("User declined the transaction"))).toBe(false);
    expect(retry(0, new Error("NotRegistered"))).toBe(false);
    expect(retry(9, new Error("network error"))).toBe(false);
  });

  it("mutation retry predicate: at most one pre-signature retry, never post-submit (#497)", () => {
    let capturedClient: any = null;
    function Capture() {
      capturedClient = useQueryClient();
      return null;
    }
    render(
      <Providers>
        <Capture />
      </Providers>
    );
    const retry = capturedClient.getDefaultOptions().mutations.retry;
    expect(retry(0, new Error("fetch failed while reading account"))).toBe(true);
    expect(retry(1, new Error("fetch failed while reading account"))).toBe(false);
    expect(retry(0, new Error("network error after submit"))).toBe(false);
  });

  it("permits setting and retrieving query cache data via QueryClient", () => {
    let capturedClient: any = null;

    function CacheTestComponent() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <Providers>
        <CacheTestComponent />
      </Providers>
    );

    capturedClient.setQueryData(["customKey"], { points: 1500 });
    const cachedData = capturedClient.getQueryData(["customKey"]);
    expect(cachedData).toEqual({ points: 1500 });
  });
});
