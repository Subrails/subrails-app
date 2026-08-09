import test from "node:test";
import assert from "node:assert/strict";

import { xdr } from "@stellar/stellar-sdk";

import { decodeEvent } from "../src/events.ts";
import {
  chargeAuthorizedEvent,
  contractId,
  mandateCreatedEvent,
  mandateExpiredEvent,
  mandateRegisteredEvent,
  mandateRevokedEvent,
  POLICY,
} from "./helpers.ts";

const ACCOUNT = contractId(10);
const MERCHANT = contractId(11);
const TOKEN = contractId(12);

test("decodes mandate_created", () => {
  const event = mandateCreatedEvent({
    ledger: 100,
    mandateId: 1n,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1_000_000n,
    intervalLedgers: 144,
    expiryLedger: 50_000,
    eventIndex: 2,
  });
  const decoded = decodeEvent(event);
  assert.deepEqual(decoded, {
    type: "mandate_created",
    mandateId: 1n,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1_000_000n,
    intervalLedgers: 144,
    expiryLedger: 50_000,
    ledger: 100,
    txHash: event.txHash,
    eventIndex: 2,
  });
});

test("decodes charge_authorized", () => {
  const event = chargeAuthorizedEvent({
    ledger: 250,
    mandateId: 1n,
    merchant: MERCHANT,
    token: TOKEN,
    amount: 25_000n,
    currentLedger: 250,
    nextValidLedger: 394,
  });
  const decoded = decodeEvent(event);
  assert.deepEqual(decoded, {
    type: "charge_authorized",
    mandateId: 1n,
    merchant: MERCHANT,
    token: TOKEN,
    amount: 25_000n,
    currentLedger: 250,
    nextValidLedger: 394,
    ledger: 250,
    txHash: event.txHash,
    eventIndex: 0,
  });
});

test("decodes mandate_revoked, mandate_expired, and mandate_registered", () => {
  const revoked = decodeEvent(mandateRevokedEvent({ ledger: 300, mandateId: 1n, revoker: ACCOUNT }));
  assert.equal(revoked?.type, "mandate_revoked");
  if (revoked?.type === "mandate_revoked") {
    assert.equal(revoked.revoker, ACCOUNT);
  }

  const expired = decodeEvent(mandateExpiredEvent({ ledger: 400, mandateId: 2n, expiryLedger: 400 }));
  assert.deepEqual(expired, {
    type: "mandate_expired",
    mandateId: 2n,
    expiryLedger: 400,
    ledger: 400,
    txHash: expired?.txHash,
    eventIndex: 0,
  });

  const registered = decodeEvent(mandateRegisteredEvent({ ledger: 100, mandateId: 3n }));
  assert.equal(registered?.type, "mandate_registered");
});

test("ignores unknown events and events from failed calls", () => {
  const unknown = mandateCreatedEvent({
    ledger: 100,
    mandateId: 1n,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1n,
    intervalLedgers: 1,
    expiryLedger: 2,
  });
  // Mutate the topic name to something the decoder does not track.
  unknown.topic = [xdr.ScVal.scvSymbol("account_initialized"), xdr.ScVal.scvU64(xdr.Uint64.fromString("1"))];
  assert.equal(decodeEvent(unknown), null);

  const failed = mandateCreatedEvent({
    ledger: 100,
    mandateId: 1n,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1n,
    intervalLedgers: 1,
    expiryLedger: 2,
  });
  failed.inSuccessfulContractCall = false;
  assert.equal(decodeEvent(failed), null);

  // Malformed data (wrong arity) decodes to null rather than throwing.
  const malformed = mandateCreatedEvent({
    ledger: 100,
    mandateId: 1n,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1n,
    intervalLedgers: 1,
    expiryLedger: 2,
  });
  malformed.value = xdr.ScVal.scvVec([]);
  assert.equal(decodeEvent(malformed), null);
});

void POLICY;
