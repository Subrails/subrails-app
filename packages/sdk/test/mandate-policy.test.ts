import test from "node:test";
import assert from "node:assert/strict";

import { Keypair, Networks, inspectAuthEntry } from "@stellar/stellar-sdk";

import { MandatePolicyClient } from "../src/clients/mandate-policy.ts";
import { KeypairSigner, u64ScVal } from "../src/clients/base.ts";
import { InvalidExpiryError, MandateNotFoundError } from "../src/errors.ts";
import {
  addressEntryFor,
  contractId,
  FakeServer,
  mandateScVal,
  operationAuth,
  randomAddress,
  testConfig,
  transferInvocation,
} from "./helpers.ts";

const ACCOUNT = contractId(21);
const TOKEN = contractId(20);

test("getMandate parses the contract Mandate struct", async () => {
  const fake = new FakeServer();
  fake.retval = mandateScVal({
    mandateId: 7n,
    maxAmount: 250_000n,
    intervalLedgers: 144,
    nextValidLedger: 1234,
    expiryLedger: 5000,
    status: "Active",
  });
  const client = new MandatePolicyClient(testConfig(), { server: fake as never });

  const mandate = await client.getMandate(7n);
  assert.equal(mandate.mandateId, 7n);
  assert.equal(mandate.maxAmount, 250_000n);
  assert.equal(mandate.intervalLedgers, 144);
  assert.equal(mandate.nextValidLedger, 1234);
  assert.equal(mandate.expiryLedger, 5000);
  assert.equal(mandate.status, "Active");
  assert.equal(typeof mandate.account, "string");
  assert.equal(typeof mandate.merchant, "string");
  assert.equal(typeof mandate.token, "string");
});

test("getMandate maps a missing mandate to MandateNotFoundError", async () => {
  // A non-success simulation response carries the host error message.
  const failing = new FakeServer();
  failing.simulateTransaction = async () =>
    ({
      id: "1",
      latestLedger: 1000,
      error: "HostError: ContractError(1)",
      events: [],
      _parsed: true,
    }) as never;
  const failingClient = new MandatePolicyClient(testConfig(), { server: failing as never });
  await assert.rejects(failingClient.getMandate(99n), MandateNotFoundError);
});

test("createMandate returns the new mandate id from the simulated retval", async () => {
  const fake = new FakeServer();
  fake.retval = u64ScVal(12n);
  fake.authEntries = [addressEntryFor(ACCOUNT, transferInvocation({ token: TOKEN, from: ACCOUNT, to: randomAddress(), amount: 100n }))];
  const owner = Keypair.random();
  const client = new MandatePolicyClient(testConfig(), { server: fake as never });

  const result = await client.createMandate(
    {
      account: ACCOUNT,
      merchant: owner.publicKey(),
      token: TOKEN,
      maxAmount: 1_000_000n,
      intervalLedgers: 144,
      expiryLedger: 50_000,
    },
    { signer: new KeypairSigner(owner, Networks.TESTNET) },
  );

  assert.equal(result.mandateId, 12n);
  assert.equal(result.txHash.length, 64);
  assert.equal(result.ledger, 1001);

  // The account's authorization entry was signed by the owner.
  const submitted = fake.submitted;
  assert.ok(submitted !== null);
  const entry = operationAuth(submitted)[0];
  assert.ok(entry !== undefined);
  assert.equal(inspectAuthEntry(entry).signed, true);
  assert.equal(inspectAuthEntry(entry).signers[0]!.address, ACCOUNT);
});

test("createMandate maps a simulated contract error to a typed error", async () => {
  const fake = new FakeServer();
  fake.authEntries = [];
  fake.enforceError = "HostError: ContractError(11)";
  const owner = Keypair.random();
  const client = new MandatePolicyClient(testConfig(), { server: fake as never });

  await assert.rejects(
    client.createMandate(
      {
        account: ACCOUNT,
        merchant: owner.publicKey(),
        token: TOKEN,
        maxAmount: 1_000_000n,
        intervalLedgers: 144,
        expiryLedger: 50_000,
      },
      { signer: new KeypairSigner(owner, Networks.TESTNET) },
    ),
    InvalidExpiryError,
  );
  assert.equal(fake.submitted, null);
});


