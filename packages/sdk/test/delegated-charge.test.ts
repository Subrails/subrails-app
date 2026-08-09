import test from "node:test";
import assert from "node:assert/strict";

import {
  Keypair,
  Networks,
  buildAuthorizationEntryPreimage,
  inspectAuthEntry,
  xdr,
} from "@stellar/stellar-sdk";

import {
  buildOwnerAuthEntry,
  charge,
  prepareChargeAuth,
  requireProtocol27,
  wrapWithPolicyDelegate,
} from "../src/auth/delegated-charge.ts";
import { Protocol27RequiredError, TooEarlyError, ContractCallError } from "../src/errors.ts";
import {
  addressEntryFor,
  contractId,
  FakeServer,
  operationAuth,
  randomAddress,
  testConfig,
  transferInvocation,
} from "./helpers.ts";

const TOKEN = contractId(20);
const ACCOUNT = contractId(21);
const MERCHANT = randomAddress();

function invocation() {
  return transferInvocation({ token: TOKEN, from: ACCOUNT, to: MERCHANT, amount: 5_000_000n });
}

test("buildOwnerAuthEntry selects the credential path per network", async () => {
  const signer = Keypair.random();

  // Protocol 27: address-bound ADDRESS_V2 credentials and preimage.
  const v2 = await buildOwnerAuthEntry({
    invocation: invocation(),
    signer,
    validUntilLedgerSeq: 1000,
    networkPassphrase: Networks.TESTNET,
    protocol27: true,
  });
  assert.equal(inspectAuthEntry(v2).credentialType, "addressV2");
  assert.equal(
    buildAuthorizationEntryPreimage(v2, 1000, Networks.TESTNET).switch().value,
    xdr.EnvelopeType.envelopeTypeSorobanAuthorizationWithAddress().value,
  );

  // Legacy: plain ADDRESS credentials and the legacy preimage.
  const legacy = await buildOwnerAuthEntry({
    invocation: invocation(),
    signer,
    validUntilLedgerSeq: 1000,
    networkPassphrase: Networks.TESTNET,
    protocol27: false,
  });
  assert.equal(inspectAuthEntry(legacy).credentialType, "address");
  assert.equal(
    buildAuthorizationEntryPreimage(legacy, 1000, Networks.TESTNET).switch().value,
    xdr.EnvelopeType.envelopeTypeSorobanAuthorization().value,
  );
});

test("wrapWithPolicyDelegate builds ADDRESS_WITH_DELEGATES with the policy as sole delegate", () => {
  const policy = contractId(1);
  const base = addressEntryFor(ACCOUNT, invocation());
  const wrapped = wrapWithPolicyDelegate(base, {
    mandatePolicyId: policy,
    validUntilLedgerSeq: 1100,
    networkPassphrase: Networks.TESTNET,
  });
  const info = inspectAuthEntry(wrapped);
  assert.equal(info.credentialType, "addressWithDelegates");
  assert.equal(info.address, ACCOUNT);
  assert.deepEqual(info.signers.map((s) => s.address), [ACCOUNT, policy]);
  // Neither the contract account nor the contract delegate carries an
  // ed25519 signature: the host invokes __check_auth for both.
  assert.ok(info.signers.every((s) => !s.signed));
  // The wrapped entry produces the address-bound CAP-71 preimage.
  assert.equal(
    buildAuthorizationEntryPreimage(wrapped, 1100, Networks.TESTNET).switch().value,
    xdr.EnvelopeType.envelopeTypeSorobanAuthorizationWithAddress().value,
  );
});

test("wrapWithPolicyDelegate rejects source-account credentials", () => {
  const sourceAccountEntry = new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation(),
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  });
  assert.throws(
    () =>
      wrapWithPolicyDelegate(sourceAccountEntry, {
        mandatePolicyId: contractId(1),
        validUntilLedgerSeq: 1100,
        networkPassphrase: Networks.TESTNET,
      }),
    ContractCallError,
  );
});

test("prepareChargeAuth only wraps entries for the subrails-account", async () => {
  const policy = contractId(1);
  const otherAccount = contractId(22);
  const entries = [addressEntryFor(ACCOUNT, invocation()), addressEntryFor(otherAccount, invocation())];
  const prepared = await prepareChargeAuth(entries, {
    mandatePolicyId: policy,
    subrailsAccount: ACCOUNT,
    validUntilLedgerSeq: 1100,
    networkPassphrase: Networks.TESTNET,
    protocol27: true,
  });
  assert.equal(inspectAuthEntry(prepared[0]!).credentialType, "addressWithDelegates");
  assert.equal(inspectAuthEntry(prepared[1]!).credentialType, "address");
});

test("prepareChargeAuth requires Protocol 27", async () => {
  await assert.rejects(
    prepareChargeAuth([], {
      mandatePolicyId: contractId(1),
      subrailsAccount: ACCOUNT,
      validUntilLedgerSeq: 1100,
      networkPassphrase: Networks.TESTNET,
      protocol27: false,
    }),
    Protocol27RequiredError,
  );
  assert.throws(() => requireProtocol27(false), Protocol27RequiredError);
  assert.doesNotThrow(() => requireProtocol27(true));
});

test("charge submits a delegated transfer and reports the outcome", async () => {
  const fake = new FakeServer();
  fake.authEntries = [addressEntryFor(ACCOUNT, invocation())];
  const merchant = Keypair.random();

  const result = await charge({
    config: testConfig(),
    token: TOKEN,
    subrailsAccount: ACCOUNT,
    merchant: MERCHANT,
    amount: 5_000_000n,
    mandateId: 3n,
    signer: { publicKey: merchant.publicKey(), signTransaction: async (xdrStr) => ({ signedTxXdr: xdrStr }) },
    server: fake as never,
  });

  assert.equal(result.mandateId, 3n);
  assert.equal(result.amount, 5_000_000n);
  assert.equal(result.ledger, 1001);
  assert.equal(result.txHash.length, 64);

  // The submitted transaction's auth entry was wrapped with the policy
  // delegate and validated in enforce mode before submission.
  const submitted = fake.submitted;
  assert.ok(submitted !== null);
  const entries = operationAuth(submitted);
  assert.equal(entries.length, 1);
  const info = inspectAuthEntry(entries[0]!);
  assert.equal(info.credentialType, "addressWithDelegates");
  assert.deepEqual(info.signers.map((s) => s.address), [ACCOUNT, testConfig().mandatePolicyId]);
  // record first (to collect entries), then enforce (to validate them).
  assert.deepEqual(fake.simulateCalls.map((c) => c.authMode), ["record", "enforce"]);
  // Protocol 27 opts into upgraded credentials at simulation time.
  assert.equal(fake.simulateCalls[0]?.useUpgradedAuth, true);
});

test("charge surfaces mandate rule violations as typed errors before submission", async () => {
  const fake = new FakeServer();
  fake.authEntries = [addressEntryFor(ACCOUNT, invocation())];
  fake.enforceError = "HostError: ContractError(4)";
  const merchant = Keypair.random();

  await assert.rejects(
    charge({
      config: testConfig(),
      token: TOKEN,
      subrailsAccount: ACCOUNT,
      merchant: MERCHANT,
      amount: 5_000_000n,
      mandateId: 3n,
      signer: { publicKey: merchant.publicKey(), signTransaction: async (xdrStr) => ({ signedTxXdr: xdrStr }) },
      server: fake as never,
    }),
    (error: unknown) => error instanceof TooEarlyError,
  );
  assert.equal(fake.submitted, null, "a failed enforcement must not be submitted");
});

test("charge refuses to run without Protocol 27, before touching the network", async () => {
  const fake = new FakeServer();
  const merchant = Keypair.random();
  await assert.rejects(
    charge({
      config: testConfig({ protocol27: false }),
      token: TOKEN,
      subrailsAccount: ACCOUNT,
      merchant: MERCHANT,
      amount: 5_000_000n,
      mandateId: 3n,
      signer: { publicKey: merchant.publicKey(), signTransaction: async (xdrStr) => ({ signedTxXdr: xdrStr }) },
      server: fake as never,
    }),
    Protocol27RequiredError,
  );
  assert.equal(fake.simulateCalls.length, 0);
});

test("charge signs the envelope through the signer", async () => {
  const fake = new FakeServer();
  fake.authEntries = [addressEntryFor(ACCOUNT, invocation())];
  const merchant = Keypair.random();
  let signedCount = 0;
  const signer = {
    publicKey: merchant.publicKey(),
    signTransaction: async (txXdr: string) => {
      signedCount += 1;
      return { signedTxXdr: txXdr, signerAddress: merchant.publicKey() };
    },
  };

  await charge({
    config: testConfig(),
    token: TOKEN,
    subrailsAccount: ACCOUNT,
    merchant: MERCHANT,
    amount: 5_000_000n,
    mandateId: 3n,
    signer,
    server: fake as never,
  });
  assert.equal(signedCount, 1);
});
