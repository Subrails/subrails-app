import test from "node:test";
import assert from "node:assert/strict";

import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";

import { TokenClient } from "../src/clients/token.ts";
import { KeypairSigner } from "../src/clients/base.ts";
import { contractId, FakeServer, randomAddress, testConfig } from "./helpers.ts";

const TOKEN = contractId(20);

test("balance parses an i128 token balance as bigint", async () => {
  const fake = new FakeServer();
  fake.retval = xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: new xdr.Int64(123456789n), hi: new xdr.Int64(0n) }));
  const client = new TokenClient(testConfig(), { tokenId: TOKEN, server: fake as never });

  const balance = await client.balance(randomAddress());
  assert.equal(balance, 123456789n);
  assert.equal(typeof balance, "bigint");
});

test("decimals parses a u32", async () => {
  const fake = new FakeServer();
  fake.retval = xdr.ScVal.scvU32(7);
  const client = new TokenClient(testConfig(), { tokenId: TOKEN, server: fake as never });
  assert.equal(await client.decimals(), 7);
});

test("symbol parses a symbol", async () => {
  const fake = new FakeServer();
  fake.retval = xdr.ScVal.scvSymbol("USDC");
  const client = new TokenClient(testConfig(), { tokenId: TOKEN, server: fake as never });
  assert.equal(await client.symbol(), "USDC");
});

test("transfer submits when the sender is the signer", async () => {
  const fake = new FakeServer();
  const sender = Keypair.random();
  const client = new TokenClient(testConfig(), { tokenId: TOKEN, server: fake as never });

  const outcome = await client.transfer(
    { from: sender.publicKey(), to: randomAddress(), amount: 500n },
    { signer: new KeypairSigner(sender, Networks.TESTNET) },
  );
  assert.equal(outcome.txHash.length, 64);
  assert.equal(outcome.ledger, 1001);
  assert.ok(fake.submitted !== null);
});
