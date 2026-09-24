import '@testing-library/jest-dom';

// --- jsdom polyfills ---------------------------------------------------
//
// jest-environment-jsdom does not implement every Web API that our
// dependencies assume is present in a browser. Each polyfill below exists
// because a specific library or code path needs it under jsdom; keep the
// comments up to date if you add/remove a dependency that relies on one
// of these.

// TextEncoder/TextDecoder: not implemented by jsdom. Required by
// @stellar/stellar-sdk (via @stellar/stellar-base) when encoding/decoding
// XDR and by `whatwg-url` (a transitive dependency used for URL parsing
// in stellar-sdk's RPC client).
import { TextEncoder, TextDecoder } from 'util';
if (typeof globalThis.TextEncoder === 'undefined') {
  // @ts-expect-error - Node's util.TextEncoder is a compatible superset
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // @ts-expect-error - Node's util.TextDecoder is a compatible superset
  globalThis.TextDecoder = TextDecoder;
}

// crypto.subtle / crypto.getRandomValues: jsdom's `window.crypto` does not
// implement the SubtleCrypto interface. @stellar/stellar-sdk's XDR/keypair
// utilities (via tweetnacl / stellar-base hashing helpers) expect
// `crypto.subtle` and `crypto.getRandomValues` to exist on the global
// object, matching real browsers. Node's `crypto.webcrypto` implements the
// same Web Crypto API, so we use it to back the global `crypto` object.
import { webcrypto } from 'crypto';
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

// window.matchMedia: not implemented by jsdom. Needed by any component
// that checks `prefers-reduced-motion` (framer-motion's
// `useReducedMotion` hook, used indirectly by animated components like
// the landing page hero and PointsCounter) — without this, those
// components throw "matchMedia is not a function" under jsdom.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {}, // deprecated API, kept for older libs
      removeListener: () => {}, // deprecated API, kept for older libs
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// IntersectionObserver: not implemented by jsdom. Needed by scroll/viewport
// triggered animations (framer-motion's `whileInView`, and any future
// lazy-loading component) that would otherwise throw
// "IntersectionObserver is not defined" during render in tests.
if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe = () => {};
    unobserve = () => {};
    disconnect = () => {};
    takeRecords = (): IntersectionObserverEntry[] => [];
  }
  // @ts-expect-error - minimal mock, not a full IntersectionObserver implementation
  window.IntersectionObserver = MockIntersectionObserver;
  // @ts-expect-error - also expose on global for code that reads it off `globalThis`
  globalThis.IntersectionObserver = MockIntersectionObserver;
}

// ResizeObserver: not implemented by jsdom. Several UI libraries
// (framer-motion layout animations, and chart/leaderboard table sizing)
// probe for it defensively; polyfilled so those code paths don't throw.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class MockResizeObserver implements ResizeObserver {
    observe = () => {};
    unobserve = () => {};
    disconnect = () => {};
  }
  // @ts-expect-error - minimal mock, not a full ResizeObserver implementation
  window.ResizeObserver = MockResizeObserver;
}

// fetch Response/Request/Headers: jsdom (as used by jest-environment-jsdom
// in this repo's Jest/Node version) does not provide the fetch API
// globals. `src/lib/rpcRetry.ts` checks `error instanceof Response` when
// classifying Soroban RPC rate-limit errors, so `Response` must exist as a
// global even in tests that only exercise error-handling paths. Node's
// built-in `undici` implementation (available via `node:` globals in
// recent Node versions, exposed here through `node-fetch`-free `undici`)
// backs these.
if (typeof globalThis.Response === 'undefined') {
  try {
    // undici's fetch implementation itself needs ReadableStream/
    // WritableStream/TransformStream, which jsdom also doesn't provide.
    // Node's `stream/web` module implements the same WHATWG Streams API.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ReadableStream, WritableStream, TransformStream } = require('stream/web');
    if (typeof globalThis.ReadableStream === 'undefined') {
      globalThis.ReadableStream = ReadableStream;
    }
    if (typeof globalThis.WritableStream === 'undefined') {
      globalThis.WritableStream = WritableStream;
    }
    if (typeof globalThis.TransformStream === 'undefined') {
      globalThis.TransformStream = TransformStream;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const undici = require('undici');
    globalThis.Response = undici.Response;
    globalThis.Request = undici.Request;
    globalThis.Headers = undici.Headers;
    if (typeof globalThis.fetch === 'undefined') {
      globalThis.fetch = undici.fetch;
    }
  } catch {
    // undici not available — leave Response undefined; tests relying on
    // it will surface a clear failure instead of failing polyfill setup.
  }
}
