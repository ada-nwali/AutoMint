import { toast } from "sonner";
import type { ContractName } from "./constants";

export interface ContractErrorMessage {
  title: string;
  message: string;
  action: string;
}

const message = (
  title: string,
  text: string,
  action: string
): ContractErrorMessage => ({ title, message: text, action });

export const CONTRACT_ERROR_MESSAGES: Readonly<
  Record<ContractName, Readonly<Record<number, ContractErrorMessage>>>
> = {
  token: {
    1: message("Already initialized", "The AMT token has already been configured.", "Refresh the page."),
    2: message("Token unavailable", "The AMT token has not been initialized.", "Contact support."),
    3: message("Not authorized", "This wallet cannot perform that token operation.", "Connect the authorized wallet."),
    4: message("Not enough AMT", "Your AMT balance is too low for this transaction.", "Claim points"),
    5: message("Allowance too low", "The approved spending amount is insufficient.", "Approve a higher amount."),
    6: message("Invalid amount", "Token amounts cannot be negative.", "Enter a non-negative amount."),
    7: message("Allowance expired", "The token allowance has expired.", "Approve the spender again."),
    8: message("Amount too large", "The resulting token amount exceeds the supported range.", "Try a smaller amount."),
    9: message("Supply cap reached", "This mint would exceed the AMT supply cap.", "Try again after the cap is updated."),
    10: message("Invalid decimals", "The token precision is invalid.", "Contact support."),
    11: message("Invalid expiration", "The allowance expiration is outside the supported range.", "Choose a valid expiration."),
    12: message("Invalid token details", "The token name and symbol must not be empty.", "Review the token details."),
    13: message("No admin change pending", "There is no pending token administrator change.", "Ask the current admin to propose a change."),
    14: message("Recipient list mismatch", "Each recipient must have a matching amount.", "Review the recipient list."),
    15: message("Too many recipients", "This transfer contains more recipients than one transaction supports.", "Split it into smaller batches."),
    16: message("Mint limit reached", "The token mint budget for this ledger window is exhausted.", "Wait for the next mint window."),
    17: message("Invalid mint limit", "The mint ceiling or its window length is invalid.", "Use a non-negative ceiling and a positive window."),
    1000: message("Token paused", "AMT transfers and minting are temporarily paused.", "Try again when the token is unpaused."),
  },
  registry: {
    1: message("Already initialized", "The registry has already been configured.", "Refresh the page."),
    2: message("Already registered", "This wallet already has a registry profile.", "Open your profile."),
    3: message("Username unavailable", "That username is already in use.", "Choose another username."),
    4: message("Profile not found", "No registered profile exists for this wallet.", "Register your wallet."),
    5: message("Not authorized", "This wallet cannot perform that registry operation.", "Connect the authorized wallet."),
    6: message("Registry unavailable", "The registry has not been initialized.", "Contact support."),
    7: message("User limit reached", "The registry has reached its maximum user count.", "Contact support."),
    8: message("Batch too large", "This request contains more addresses than one call supports.", "Split the request into smaller batches."),
    9: message("Invalid amount", "Claimed amounts cannot be negative.", "Retry with a non-negative amount."),
    10: message("No admin change pending", "There is no pending registry administrator change.", "Ask the current admin to propose a change."),
    11: message("Points update rejected", "This points update exceeds the amount one call may add.", "Contact support."),
    12: message("Invalid username", "Usernames must be 1 to 32 characters long.", "Enter a username within that length."),
  },
  botNft: {
    1: message("Already initialized", "The bot collection has already been configured.", "Refresh the page."),
    2: message("Bot not found", "The requested bot or record does not exist.", "Check the bot ID."),
    3: message("Not authorized", "This wallet cannot perform that bot operation.", "Connect the authorized wallet."),
    4: message("Invalid bot tier", "The selected bot tier is not supported.", "Choose an available tier."),
    5: message("Bot not found", "That bot does not exist.", "Check the bot ID."),
    6: message("Not bot owner", "This wallet does not own the requested bot.", "Switch to the bot owner wallet."),
    7: message("Insufficient funds", "There is not enough payment-token balance for this bot.", "Add funds and try again."),
    8: message("Collection unavailable", "The bot collection has not been initialized.", "Contact support."),
    9: message("Tier supply reached", "No more bots of this tier can currently be minted.", "Choose another tier."),
    10: message("Batch too large", "This request contains more bots than one call supports.", "Split the request into smaller batches."),
    11: message("Nickname too long", "The bot nickname exceeds the allowed length.", "Use a shorter nickname."),
    12: message("Range too large", "The requested bot range exceeds the query limit.", "Request a smaller range."),
    13: message("Invalid amount", "The withdrawal amount must be positive.", "Enter a valid amount."),
    14: message("Treasury balance too low", "The bot treasury does not have enough payment tokens.", "Try a smaller withdrawal."),
    15: message("Bot ID limit reached", "No further bot IDs can be allocated.", "Contact support."),
  },
  accrual: {
    1: message("Already initialized", "The accrual contract has already been configured.", "Refresh the page."),
    2: message("Already accruing", "Accrual has already been started for this user.", "Refresh your accrual status."),
    3: message("Accrual not started", "There is no accrual record for this user.", "Start accrual first."),
    4: message("Not authorized", "This wallet cannot perform that accrual operation.", "Connect the authorized wallet."),
    5: message("Accrual unavailable", "The accrual contract has not been initialized.", "Contact support."),
    6: message("Registry update failed", "The registry could not record this accrual update.", "Try again later."),
    7: message("AMT mint failed", "The token contract rejected this AMT mint.", "Try again later."),
    8: message("Invalid accrual settings", "The requested accrual configuration is invalid.", "Review the accrual settings."),
    9: message("No bots found", "A bot is required before accrual can start.", "Mint or buy a bot."),
    10: message("Too many users", "This request contains more users than one call supports.", "Split the request into smaller batches."),
    11: message("Registration required", "This wallet must be registered before accrual can start.", "Register your wallet."),
    12: message("Accrual paused", "Accrual is frozen for this user.", "Contact support."),
    13: message("Mint limit update failed", "The token contract rejected the mint limit configuration.", "Review the limit and try again."),
  },
  marketplace: {
    1: message("Already initialized", "The marketplace has already been configured.", "Refresh the page."),
    2: message("Marketplace unavailable", "The marketplace has not been initialized.", "Contact support."),
    3: message("Invalid price", "The listing price must be valid and positive.", "Enter a valid price."),
    4: message("Bot transfer failed", "The marketplace could not transfer the bot.", "Check bot ownership and try again."),
    5: message("Listing not found", "That marketplace listing does not exist.", "Refresh the listings."),
    6: message("Not listing seller", "Only the seller can perform this operation.", "Switch to the seller wallet."),
    7: message("Listing inactive", "This listing is no longer active.", "Refresh the listings."),
    8: message("Insufficient funds", "Your wallet does not have enough funds for this purchase.", "Add funds and try again."),
    9: message("Listing unavailable", "This listing is not active.", "Refresh the listings."),
    10: message("Not authorized", "This wallet cannot perform that marketplace operation.", "Connect the authorized wallet."),
    11: message("Payment failed", "The marketplace could not complete the payment.", "Check your balance and try again."),
    12: message("Amount too large", "The marketplace amount exceeds the supported range.", "Try a smaller amount."),
    13: message("Price too low", "The listing price is below the marketplace minimum.", "Increase the price."),
    14: message("Listing changed", "This listing changed after it was loaded.", "Refresh and try again."),
    15: message("Cannot buy own bot", "A seller cannot purchase their own bot.", "Use another wallet."),
    16: message("Listing limit reached", "You have reached the maximum number of active listings.", "Cancel a listing before adding another."),
    17: message("Invalid bot collection", "This bot is not from a supported collection.", "Choose a supported bot."),
    18: message("Marketplace paused", "Marketplace transactions are temporarily paused.", "Try again later."),
    19: message("No admin change pending", "There is no pending marketplace administrator change.", "Ask the current admin to propose a change."),
    20: message("Bot not found", "That bot does not exist.", "Check the bot ID."),
    21: message("Not bot owner", "This wallet does not own the requested bot.", "Switch to the bot owner wallet."),
    22: message("Transaction re-entered", "The marketplace blocked a nested transaction.", "Wait for the current transaction to finish."),
    23: message("Currency not supported", "This payment token is not enabled in the marketplace.", "Choose a supported currency."),
    24: message("Listing expired", "This listing has expired.", "Refresh the listings."),
    25: message("Invalid offer expiry", "An offer must expire in the future.", "Choose a later expiry time."),
    26: message("Offer not found", "That offer does not exist.", "Refresh the offers."),
    27: message("Offer inactive", "This offer has already been accepted or cancelled.", "Refresh the offers."),
    28: message("Offer expired", "This offer has expired.", "Create a new offer."),
    29: message("Not offer owner", "Only the offer creator can cancel it before expiry.", "Switch to the offer creator wallet."),
    30: message("Cannot offer on own bot", "You cannot make an offer on a bot you own or listed.", "Choose another bot."),
    31: message("Offer limit reached", "This bot already has the maximum number of open offers.", "Try again after an offer closes."),
    32: message("Invalid withdrawal amount", "The fee withdrawal amount must be positive.", "Enter a valid amount."),
    33: message("Insufficient fees", "The marketplace has not accrued enough fees for this withdrawal.", "Try a smaller amount."),
  },
};

const GENERIC_ERROR: ContractErrorMessage = {
  title: "Transaction failed",
  message: "The contract could not complete this request.",
  action: "Review the details and try again.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorStrings(error: unknown, depth = 0): string[] {
  if (typeof error === "string") return [error];
  if (error instanceof Error) {
    const cause = depth < 3 && isRecord(error) ? error.cause : undefined;
    return [error.message, ...errorStrings(cause, depth + 1)];
  }
  if (!isRecord(error) || depth >= 3) return [];

  const strings: string[] = [];
  for (const key of ["message", "error", "result", "cause", "details"]) {
    const value = error[key];
    if (typeof value === "string") {
      strings.push(value);
    } else if (value instanceof Error || isRecord(value)) {
      strings.push(...errorStrings(value, depth + 1));
    }
  }
  return strings;
}

/** Maps Soroban simulation or submission errors to actionable UI copy. */
export function parseContractError(
  err: unknown,
  contract: ContractName
): ContractErrorMessage {
  for (const text of errorStrings(err)) {
    const match = text.match(/Error\s*\(\s*Contract\s*,\s*#?(\d+)\s*\)/i);
    if (match) {
      return CONTRACT_ERROR_MESSAGES[contract][Number(match[1])] ?? GENERIC_ERROR;
    }
  }
  return GENERIC_ERROR;
}

/** Shows mapped contract copy while keeping the suggested next step visible. */
export function toastContractError(err: unknown, contract: ContractName): void {
  const parsed = parseContractError(err, contract);
  toast.error(parsed.title, {
    description: `${parsed.message} Next step: ${parsed.action}`,
  });
}
