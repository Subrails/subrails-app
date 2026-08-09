import test from "node:test";
import assert from "node:assert/strict";

import { Keypair, Networks, inspectAuthEntry } from "@stellar/stellar-sdk";

import { SubrailsAccountClient } from "../src/clients/subrails-account.ts";
import { KeypairSigner, addressScVal } from "../src/clients/base.ts";
import { InvalidConfigError } from "../src/errors.ts";
import {
  addressEntryFor,
  contractId,
  FakeServer,
  operationAuth,
  randomAddress,
  testConfig,
  transferInvocation,
} from "./helpers.ts";

const POLICY = contractId(1);

test("deployAccount returns the new account id from the deployment retval", async () => {
  const fake = new FakeServer();
  const newAccountId = contractId(30);
  fake.retval = addressScVal(newAccountId);
  const deployer = Keypair.random();
  const client = new SubrailsAccountClient(testConfig(), { server: fake as never });

  const result = await client.deployAccount(
    { owner: deployer.publicKey(), policyContract: POLICY },
    { signer: new KeypairSigner(deployer, Networks.TESTNET) },
  );

  assert.equal(result.accountId, newAccountId);
  assert.equal(result.txHash.length, 64);
  assert.equal(result.ledger, 1001);

  // The submitted transaction is a createCustomContract invocation.
  const submitted = fake.submitted;
  assert.ok(submitted !== null);
  const op = submitted.operations[0]!;
  assert.equal(op.type, "invokeHostFunction");
  assert.equal(op.func.switch().name, "hostFunctionTypeCreateContractV2");
});

test("deployAccount refuses a missing wasm hash", async () => {
  const fake = new FakeServer();
  const deployer = Keypair.random();
  const client = new SubrailsAccountClient(
    testConfig({ subrailsAccountWasmHash: "" }),
    { server: fake as never },
  );
  await assert.rejects(
    client.deployAccount(
      { owner: deployer.publicKey(), policyContract: POLICY },
      { signer: new KeypairSigner(deployer, Networks.TESTNET) },
    ),
    InvalidConfigError,
  );
});

test("initialize runs without requiring auth entry signing", async () => {
  const fake = new FakeServer();
  const accountId = contractId(30);
  const owner = Keypair.random();
  const client = new SubrailsAccountClient(testConfig(), { server: fake as never });

  const outcome = await client.initialize(
    { accountId, owner: owner.publicKey(), policyContract: POLICY },
    { signer: new KeypairSigner(owner, Networks.TESTNET) },
  );
  assert.equal(outcome.txHash.length, 64);
});

test("registerMandate signs the account's authorization entry with the owner", async () => {
  const fake = new FakeServer();
  const accountId = contractId(30);
  fake.authEntries = [
    addressEntryFor(accountId, transferInvocation({ token: contractId(20), from: accountId, to: randomAddress(), amount: 1n })),
  ];
  const owner = Keypair.random();
  const client = new SubrailsAccountClient(testConfig(), { server: fake as never });

  const outcome = await client.registerMandate(
    { accountId, mandateId: 5n },
    { signer: new KeypairSigner(owner, Networks.TESTNET) },
  );
  assert.equal(outcome.txHash.length, 64);

  const submitted = fake.submitted;
  assert.ok(submitted !== null);
  const entry = operationAuth(submitted)[0];
  assert.ok(entry !== undefined);
  assert.equal(inspectAuthEntry(entry).signed, true);
  assert.equal(inspectAuthEntry(entry).address, accountId);
});

test("initialize encodes the owner as raw ed25519 bytes", async () => {
  const fake = new FakeServer();
  const owner = Keypair.random();
  const client = new SubrailsAccountClient(testConfig(), { server: fake as never });
  await client.initialize(
    { accountId: contractId(30), owner: owner.publicKey(), policyContract: POLICY },
    { signer: new KeypairSigner(owner, Networks.TESTNET) },
  );
  // The submitted invocation's first arg is an scvBytes with the raw key.
  const op = fake.submitted?.operations[0];
  assert.ok(op !== undefined && op.type === "invokeHostFunction");
  const args = op.func.invokeContract().args();
  const first = args[0];
  assert.ok(first !== undefined);
  assert.equal(first.switch().name, "scvBytes");
  const raw = first.bytes();
  assert.equal(raw.length, 32);
  assert.equal(Buffer.from(raw).toString("hex"), owner.rawPublicKey().toString("hex"));
});
