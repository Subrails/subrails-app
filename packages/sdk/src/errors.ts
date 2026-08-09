/**
 * Typed errors for the Subrails SDK.
 *
 * Contract functions return errors as numeric codes (the `#[contracterror]`
 * enum in the contract). SDK callers must never see raw numbers: every
 * contract failure surfaces as an instance of a named `SubrailsError`
 * subclass, mapped from the code via {@link errorFromContractCode}.
 *
 * The error codes below match the mandate-policy contract exactly:
 * 1-12 are the documented protocol codes, 13-14 are the codes the contract
 * adds for its duplicate-pair guard and checked-arithmetic overflow.
 */

/** Base class for every error thrown by the SDK. */
export abstract class SubrailsError extends Error {
  /** Stable machine-readable code for this error, e.g. `"MANDATE_NOT_FOUND"`. */
  readonly code: string;
  /** The contract error code, when this error maps from a contract code. */
  readonly contractCode?: number;
  /** The underlying error, when this error wraps a lower-level failure. */
  override readonly cause?: unknown;

  constructor(message: string, options: { code: string; contractCode?: number; cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    if (options.contractCode !== undefined) {
      this.contractCode = options.contractCode;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Raised when SDK configuration is missing or invalid. */
export class InvalidConfigError extends SubrailsError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "INVALID_CONFIG", cause });
  }
}

/** Raised when a contract call fails with a code this SDK cannot map. */
export class ContractCallError extends SubrailsError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "CONTRACT_CALL_FAILED", cause });
  }
}

/**
 * Raised when a delegated charge is attempted on a network without Protocol
 * 27 (CAP-71). Delegated authorization does not exist before Protocol 27, so
 * this SDK refuses to fabricate it.
 */
export class Protocol27RequiredError extends SubrailsError {
  constructor(message: string) {
    super(message, { code: "PROTOCOL_27_REQUIRED" });
  }
}

/** Contract code 1: no mandate exists with the given id. */
export class MandateNotFoundError extends SubrailsError {
  constructor(message = "No mandate exists with the given id.", cause?: unknown) {
    super(message, { code: "MANDATE_NOT_FOUND", contractCode: 1, cause });
  }
}

/** Contract code 2: the mandate is not Active (it is revoked). */
export class NotActiveError extends SubrailsError {
  constructor(message = "The mandate is not active.", cause?: unknown) {
    super(message, { code: "MANDATE_NOT_ACTIVE", contractCode: 2, cause });
  }
}

/** Contract code 3: the mandate has reached its expiry ledger. */
export class ExpiredError extends SubrailsError {
  constructor(message = "The mandate has expired.", cause?: unknown) {
    super(message, { code: "MANDATE_EXPIRED", contractCode: 3, cause });
  }
}

/** Contract code 4: the current ledger is before the mandate's next valid ledger. */
export class TooEarlyError extends SubrailsError {
  constructor(message = "The charge is too early for the mandate's interval.", cause?: unknown) {
    super(message, { code: "CHARGE_TOO_EARLY", contractCode: 4, cause });
  }
}

/** Contract code 5: the charge amount exceeds the mandate's max amount. */
export class AmountTooHighError extends SubrailsError {
  constructor(message = "The charge amount exceeds the mandate's maximum.", cause?: unknown) {
    super(message, { code: "AMOUNT_TOO_HIGH", contractCode: 5, cause });
  }
}

/** Contract code 6: the charging party is not the mandate's merchant. */
export class WrongMerchantError extends SubrailsError {
  constructor(message = "The charging party is not the mandate's merchant.", cause?: unknown) {
    super(message, { code: "WRONG_MERCHANT", contractCode: 6, cause });
  }
}

/** Contract code 7: the token does not match the mandate's token. */
export class WrongTokenError extends SubrailsError {
  constructor(message = "The token does not match the mandate's token.", cause?: unknown) {
    super(message, { code: "WRONG_TOKEN", contractCode: 7, cause });
  }
}

/** Contract code 8: the authorization check failed. */
export class UnauthorizedError extends SubrailsError {
  constructor(message = "The authorization was rejected.", cause?: unknown) {
    super(message, { code: "UNAUTHORIZED", contractCode: 8, cause });
  }
}

/** Contract code 9: the charge amount is not positive. */
export class InvalidAmountError extends SubrailsError {
  constructor(message = "The amount must be positive.", cause?: unknown) {
    super(message, { code: "INVALID_AMOUNT", contractCode: 9, cause });
  }
}

/** Contract code 10: the interval is not positive. */
export class InvalidIntervalError extends SubrailsError {
  constructor(message = "The interval must be positive.", cause?: unknown) {
    super(message, { code: "INVALID_INTERVAL", contractCode: 10, cause });
  }
}

/** Contract code 11: the expiry ledger is not in the future. */
export class InvalidExpiryError extends SubrailsError {
  constructor(message = "The expiry ledger must be in the future.", cause?: unknown) {
    super(message, { code: "INVALID_EXPIRY", contractCode: 11, cause });
  }
}

/** Contract code 12: the mandate is already revoked or expired. */
export class AlreadyResolvedError extends SubrailsError {
  constructor(message = "The mandate is already resolved.", cause?: unknown) {
    super(message, { code: "ALREADY_RESOLVED", contractCode: 12, cause });
  }
}

/** Contract code 13: a mandate already exists for this account, merchant, token. */
export class DuplicateMandateError extends SubrailsError {
  constructor(message = "A mandate already exists for this account, merchant, and token.", cause?: unknown) {
    super(message, { code: "DUPLICATE_MANDATE", contractCode: 13, cause });
  }
}

/** Contract code 14: a checked arithmetic operation overflowed. */
export class OverflowError extends SubrailsError {
  constructor(message = "A contract arithmetic operation overflowed.", cause?: unknown) {
    super(message, { code: "OVERFLOW", contractCode: 14, cause });
  }
}

/** Every named contract error, indexed by contract error code. */
export const CONTRACT_ERRORS: Readonly<Record<number, new (message?: string, cause?: unknown) => SubrailsError>> = {
  1: MandateNotFoundError,
  2: NotActiveError,
  3: ExpiredError,
  4: TooEarlyError,
  5: AmountTooHighError,
  6: WrongMerchantError,
  7: WrongTokenError,
  8: UnauthorizedError,
  9: InvalidAmountError,
  10: InvalidIntervalError,
  11: InvalidExpiryError,
  12: AlreadyResolvedError,
  13: DuplicateMandateError,
  14: OverflowError,
};

/** Maps a contract error code to its named SDK error. */
export function errorFromContractCode(code: number, cause?: unknown): SubrailsError {
  const Ctor = CONTRACT_ERRORS[code];
  if (Ctor === undefined) {
    return new ContractCallError(`Contract call failed with unknown error code ${code}.`, cause);
  }
  return new Ctor(undefined, cause);
}

/**
 * Extracts a contract error code from an arbitrary thrown value.
 *
 * Looks for the code in, in order:
 * 1. a `contractCode` field (already a mapped error),
 * 2. a message of the form `ContractError(N)` (how the stellar-sdk surfaces
 *    contract traps),
 * 3. a message of the form `Contract error: N` (defensive),
 * 4. a string `error` field containing the above.
 */
export function extractContractErrorCode(cause: unknown): number | null {
  if (cause instanceof SubrailsError && cause.contractCode !== undefined) {
    return cause.contractCode;
  }
  const message = findErrorMessage(cause);
  if (message === null) {
    return null;
  }
  const direct = message.match(/ContractError\((\d+)\)/);
  if (direct !== null) {
    return Number(direct[1]);
  }
  const worded = message.match(/Contract error(?: code)?:?\s*(\d+)/i);
  if (worded !== null) {
    return Number(worded[1]);
  }
  return null;
}

/**
 * Maps an unknown thrown value from a contract call to a typed
 * {@link SubrailsError}. Known contract codes become their named error; any
 * other failure becomes a {@link ContractCallError} wrapping the cause.
 */
export function mapContractError(cause: unknown): SubrailsError {
  if (cause instanceof SubrailsError) {
    return cause;
  }
  const code = extractContractErrorCode(cause);
  if (code !== null) {
    return errorFromContractCode(code, cause);
  }
  return new ContractCallError(
    `Contract call failed${findErrorMessage(cause) === null ? "" : `: ${findErrorMessage(cause)}`}`,
    cause,
  );
}

function findErrorMessage(cause: unknown): string | null {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  if (typeof cause === "object" && cause !== null && "error" in cause) {
    const error = (cause as { error: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
  }
  return null;
}
