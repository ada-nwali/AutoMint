/**
 * AM-035 Error Classification and Mapping Module.
 *
 * Categorizes thrown errors into Network, Contract, Wallet, or Unknown
 * with human-readable titles, diagnostic messages, and retryability flags.
 */

export type ErrorCategory = "network" | "contract" | "wallet" | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  title: string;
  message: string;
  isRetryable: boolean;
  raw?: unknown;
}

export function classifyError(error: unknown): ClassifiedError {
  if (!error) {
    return {
      category: "unknown",
      title: "Unknown Error",
      message: "An unexpected error occurred. Please try again.",
      isRetryable: true,
    };
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  const lower = rawMessage.toLowerCase();

  // 1. Network & RPC Outages (AM-035)
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("rpc") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("429") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("failed to fetch") ||
    lower.includes("horizon") ||
    lower.includes("soroban rpc") ||
    lower.includes("unreachable") ||
    lower.includes("connection refused")
  ) {
    return {
      category: "network",
      title: "Network Connection Error",
      message:
        "Unable to reach the Stellar Soroban RPC network. Please check your internet connection or try again later.",
      isRetryable: true,
      raw: error,
    };
  }

  // 2. Wallet & Freighter Errors
  if (
    lower.includes("wallet") ||
    lower.includes("freighter") ||
    lower.includes("locked") ||
    lower.includes("rejected") ||
    lower.includes("denied") ||
    lower.includes("declined") ||
    lower.includes("public key") ||
    lower.includes("not connected")
  ) {
    return {
      category: "wallet",
      title: "Wallet Error",
      message: rawMessage || "Freighter wallet interaction was rejected or failed.",
      isRetryable: true,
      raw: error,
    };
  }

  // 3. Soroban Smart Contract Errors (AM-035)
  if (
    lower.includes("simulation failed") ||
    lower.includes("contract") ||
    lower.includes("hosterror") ||
    lower.includes("error(contract") ||
    lower.includes("unauthorized") ||
    lower.includes("invalidprice") ||
    lower.includes("listingnotfound") ||
    lower.includes("listingnotactive") ||
    lower.includes("insufficientfunds") ||
    lower.includes("alreadyinitialized")
  ) {
    return {
      category: "contract",
      title: "Contract Error",
      message:
        rawMessage ||
        "The smart contract rejected the transaction simulation or call.",
      isRetryable: true,
      raw: error,
    };
  }

  return {
    category: "unknown",
    title: "Something Went Wrong",
    message: rawMessage || "An unexpected error occurred. Please try again.",
    isRetryable: true,
    raw: error,
  };
}
