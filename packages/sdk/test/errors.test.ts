import test from "node:test";
import assert from "node:assert/strict";

import {
  AlreadyResolvedError,
  AmountTooHighError,
  ContractCallError,
  DuplicateMandateError,
  ExpiredError,
  InvalidAmountError,
  InvalidExpiryError,
  InvalidIntervalError,
  MandateNotFoundError,
  NotActiveError,
  OverflowError,
  SubrailsError,
  TooEarlyError,
  UnauthorizedError,
  WrongMerchantError,
  WrongTokenError,
  errorFromContractCode,
  extractContractErrorCode,
  mapContractError,
} from "../src/errors.ts";

test("every contract error code maps to its named error class", () => {
  const cases: Array<[number, new (message?: string, cause?: unknown) => SubrailsError, string]> = [
    [1, MandateNotFoundError, "MANDATE_NOT_FOUND"],
    [2, NotActiveError, "MANDATE_NOT_ACTIVE"],
    [3, ExpiredError, "MANDATE_EXPIRED"],
    [4, TooEarlyError, "CHARGE_TOO_EARLY"],
    [5, AmountTooHighError, "AMOUNT_TOO_HIGH"],
    [6, WrongMerchantError, "WRONG_MERCHANT"],
    [7, WrongTokenError, "WRONG_TOKEN"],
    [8, UnauthorizedError, "UNAUTHORIZED"],
    [9, InvalidAmountError, "INVALID_AMOUNT"],
    [10, InvalidIntervalError, "INVALID_INTERVAL"],
    [11, InvalidExpiryError, "INVALID_EXPIRY"],
    [12, AlreadyResolvedError, "ALREADY_RESOLVED"],
    [13, DuplicateMandateError, "DUPLICATE_MANDATE"],
    [14, OverflowError, "OVERFLOW"],
  ];
  for (const [code, Ctor, errorCode] of cases) {
    const error = errorFromContractCode(code, new Error("cause"));
    assert.ok(error instanceof Ctor, `code ${code} should map to ${Ctor.name}`);
    assert.equal(error.code, errorCode);
    assert.equal(error.contractCode, code);
    assert.ok(error instanceof SubrailsError);
    assert.ok(error.cause instanceof Error);
  }
});

test("unknown contract codes map to a generic ContractCallError", () => {
  const error = errorFromContractCode(99);
  assert.ok(error instanceof ContractCallError);
});

test("extractContractErrorCode finds codes in host error messages", () => {
  assert.equal(extractContractErrorCode(new Error("HostError: ContractError(5)")), 5);
  assert.equal(extractContractErrorCode("ContractError(11)"), 11);
  assert.equal(extractContractErrorCode(new Error("something else entirely")), null);
  assert.equal(extractContractErrorCode(42), null);
  assert.equal(extractContractErrorCode(undefined), null);
});

test("extractContractErrorCode reads the contractCode off an existing SDK error", () => {
  assert.equal(extractContractErrorCode(new TooEarlyError()), 4);
});

test("mapContractError returns typed errors for contract codes in messages", () => {
  const mapped = mapContractError(new Error("invokeHostFunction failed: ContractError(3)"));
  assert.ok(mapped instanceof ExpiredError);
  assert.equal(mapped.contractCode, 3);
});

test("mapContractError passes through SDK errors unchanged", () => {
  const original = new WrongTokenError();
  assert.equal(mapContractError(original), original);
});

test("mapContractError wraps unrelated failures in ContractCallError", () => {
  const mapped = mapContractError(new Error("network hiccup"));
  assert.ok(mapped instanceof ContractCallError);
  assert.ok(mapped.cause instanceof Error);
});
