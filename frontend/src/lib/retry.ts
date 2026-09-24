import { classifyError } from "./errorMap";

/** A read query that fails with a network error is retried at most this many times. */
export const MAX_QUERY_RETRIES = 2;
/** A mutation is retried at most this many times, and only before a signature is requested. */
export const MAX_MUTATION_RETRIES = 1;

/**
 * Messages that mean "this will never succeed on retry" even though the error
 * text might otherwise trip the network heuristic.
 */
const NEVER_RETRY =
  /not\s*registered|notregistered|user\s*declined|user\s*rejected|request\s*rejected|action\s*rejected/i;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

/**
 * Query retry predicate (#497).
 *
 * `retry: 3` previously applied to every query, so a query failing because a
 * contract ID is wrong — which will never succeed — just delayed the error by
 * ~7 seconds of exponential backoff. This retries **only** network-class
 * failures, and only up to `MAX_QUERY_RETRIES`. A wrong contract ID, a
 * `NotRegistered` state, and a user rejection all error immediately.
 */
export function retryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (NEVER_RETRY.test(messageOf(error))) return false;
  return classifyError(error).category === "network";
}

/**
 * Heuristic: did this error happen after a signature was requested? If so the
 * transaction may already be broadcast, so the mutation must not be retried
 * (#497 — "a submitted transaction is never resubmitted").
 */
export function wasSignatureRequested(error: unknown): boolean {
  return /sign|signature|submit|sent|broadcast|freighter|xdr|sequence|already\s*on-chain/i.test(
    messageOf(error),
  );
}

/**
 * Mutation retry predicate (#497).
 *
 * Mutations had no retry at all, so a transient RPC blip on the
 * simulate / `getAccount` step failed a user's claim outright. This retries a
 * mutation at most `MAX_MUTATION_RETRIES` time(s), and only when the failure is
 * a network error that clearly happened **before** any signature was requested.
 * Anything ambiguous is treated as post-signature and not retried.
 */
export function retryMutation(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_MUTATION_RETRIES) return false;
  if (wasSignatureRequested(error)) return false;
  return classifyError(error).category === "network";
}
