/**
 * Maps thrown SDK errors (typed {@link SubrailsError} subclasses, or
 * anything else) to short messages the reference UI can show in a toast or
 * an inline notice.
 */

import { SubrailsError } from "@subrails/sdk";

const KNOWN_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_CONFIG: "The app is missing a required setting.",
  CONTRACT_CALL_FAILED: "The contract call failed. Check the network and try again.",
  PROTOCOL_27_REQUIRED: "This network does not support CAP-71 delegated authorization. Run on testnet.",
  MANDATE_NOT_FOUND: "No mandate exists with that id.",
  MANDATE_NOT_ACTIVE: "This mandate is no longer active.",
  MANDATE_EXPIRED: "This mandate has reached its expiry ledger.",
  CHARGE_TOO_EARLY: "Too early: the mandate's interval has not elapsed since the last charge.",
  AMOUNT_TOO_HIGH: "The amount exceeds the mandate's per-charge maximum.",
  WRONG_MERCHANT: "Only the mandate's merchant can trigger a charge.",
  WRONG_TOKEN: "The token does not match the one the mandate is set to.",
  UNAUTHORIZED: "The wallet did not authorize this operation.",
  INVALID_AMOUNT: "The amount must be positive.",
  INVALID_INTERVAL: "The interval must be positive.",
  INVALID_EXPIRY: "The expiry ledger must be in the future.",
  ALREADY_RESOLVED: "This mandate is already revoked or expired.",
  DUPLICATE_MANDATE: "A mandate for this account, merchant, and token already exists.",
  OVERFLOW: "The contract arithmetic overflowed.",
};

/** Turns any thrown value into a display message. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof SubrailsError) {
    const known = KNOWN_MESSAGES[cause.code];
    if (known !== undefined) {
      return known;
    }
    return cause.message;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}
