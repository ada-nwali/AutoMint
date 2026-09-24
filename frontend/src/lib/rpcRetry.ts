/**
 * Retry-with-backoff engine for idempotent Soroban RPC calls (#454).
 *
 * Only *transient* failures are retried — rate limits, gateway errors
 * (502/503/504), other 5xx responses and transport-level hiccups. A
 * contract simulation failure, a wallet rejection or a sequence error is
 * deterministic: retrying it would only delay the real error.
 *
 * Non-idempotent operations — above all `sendTransaction` — must NEVER be
 * retried automatically: a submission that times out may still have landed,
 * and a second submission would either double-spend the sequence number or
 * fail with txBAD_SEQ. Callers pass `{ idempotent: false }` (or simply do
 * not wrap the call) to enforce a single attempt.
 */

/** Total retry attempts after the initial call (initial + 3 retries). */
export const MAX_RETRIES = 3;
/** First backoff delay; doubles on each subsequent retry. */
export const BASE_DELAY_MS = 1_000;
/** Upper bound of the random jitter added to each backoff delay. */
export const MAX_JITTER_MS = 500;

/** HTTP statuses that indicate a transient server-side condition. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Errors that must never be retried regardless of wording — deterministic
 * contract, wallet or sequence failures (#454).
 */
const NEVER_RETRY =
  /error\s*\(\s*contract|hosterror|simulation failed|not\s*registered|notregistered|user\s*declined|user\s*rejected|request\s*rejected|action\s*rejected|declined\s+by|txbadseq|invalid\s*sequence/i;

/**
 * Message fragments that indicate a transient network / gateway failure.
 * Matched only after {@link NEVER_RETRY}, so a contract error that happens
 * to mention a status code is still surfaced immediately.
 */
const RETRYABLE_MESSAGE =
  /rate\s*limit|too\s*many\s*requests|\b(408|425|429|500|502|503|504)\b|bad\s*gateway|gateway\s*timeout|service\s*unavailable|internal\s*server\s*error|fetch\s*failed|failed\s*to\s*fetch|network\s*(error|failure|problem|is\s*unreachable)|connection\s*(reset|refused|closed|error)|econnreset|econnrefused|econnaborted|etimedout|enotfound|socket\s*hang\s*up|load\s*failed|request\s*timeout|timeout/i;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function statusOf(error: unknown): number | null {
  if (error instanceof Response) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * True when the error is a transient RPC/transport failure worth retrying
 * with backoff (#454). Contract errors, wallet rejections and 4xx client
 * errors (other than 408/425/429) are never retryable.
 */
export function isRetryableRpcError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) {
    return RETRYABLE_STATUSES.has(status) || status >= 500;
  }

  const message = messageOf(error);
  if (!message) return false;
  if (NEVER_RETRY.test(message)) return false;
  return RETRYABLE_MESSAGE.test(message);
}

/** Server-provided Retry-After hint (in ms), when the error carries one. */
function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof Response) {
    const header = error.headers.get("Retry-After");
    if (header) {
      const seconds = Number(header);
      if (!Number.isNaN(seconds)) return seconds * 1_000;
    }
  }
  return null;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WithRetryOptions {
  /**
   * Whether the operation is safe to repeat. Defaults to `true` — every
   * current call site is simulate / getAccount / getTransaction /
   * prepareTransaction / getLatestLedger. Pass `false` for anything
   * non-idempotent (never `sendTransaction` automatically, #454): the
   * function then runs exactly once and any failure is rethrown as-is.
   */
  idempotent?: boolean;
  /** Override the retry budget (defaults to {@link MAX_RETRIES}). */
  maxRetries?: number;
  /**
   * Override the sleep used between attempts. Tests inject a no-op to
   * avoid waiting out real backoff delays.
   */
  delay?: (ms: number) => Promise<void>;
}

/**
 * Run `fn`, retrying transient RPC failures with exponential backoff and
 * jitter. Honours a `Retry-After` header on 429 responses when present.
 *
 * @throws the last error once the retry budget is exhausted, or immediately
 *   when the error is not retryable / the call is marked non-idempotent.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
): Promise<T> {
  const {
    idempotent = true,
    maxRetries = MAX_RETRIES,
    delay = defaultDelay,
  } = options;

  if (!idempotent) {
    return fn();
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableRpcError(error) || attempt === maxRetries) {
        throw error;
      }

      const serverDelay = getRetryAfterMs(error);
      const backoffDelay = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * MAX_JITTER_MS;
      const waitMs = (serverDelay ?? backoffDelay) + jitter;

      await delay(waitMs);
    }
  }

  throw lastError;
}
