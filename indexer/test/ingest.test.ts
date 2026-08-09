import test from "node:test";
import assert from "node:assert/strict";

import { rpc, xdr } from "@stellar/stellar-sdk";

import type { IndexerConfig } from "../src/config.ts";
import { Db } from "../src/db/client.ts";
import { Ingester } from "../src/ingest.ts";
import {
  chargeAuthorizedEvent,
  contractId,
  createMemDb,
  FakeEventsServer,
  mandateCreatedEvent,
  mandateExpiredEvent,
  mandateRevokedEvent,
  POLICY,
} from "./helpers.ts";

const ACCOUNT = contractId(10);
const MERCHANT = contractId(11);
const TOKEN = contractId(12);

function testConfig(overrides: Partial<IndexerConfig> = {}): IndexerConfig {
  return {
    rpcUrl: "http://fake-rpc",
    networkPassphrase: "Test SDF Network ; September 2015",
    mandatePolicyId: POLICY,
    mandateRegistryId: "",
    databaseUrl: "postgres://in-memory",
    startLedger: 1,
    apiPort: 8080,
    pollIntervalMs: 1,
    pageSize: 200,
    ...overrides,
  };
}

interface Harness {
  db: Db;
  server: FakeEventsServer;
  ingester: Ingester;
}

async function setup(events: rpc.Api.EventResponse[], config: IndexerConfig = testConfig()): Promise<Harness> {
  const db = await createMemDb();
  const server = new FakeEventsServer(events);
  const ingester = new Ingester(server as unknown as rpc.Server, db, config, {
    maxAttempts: 3,
    baseDelayMs: 1,
  });
  return { db, server, ingester };
}

function createEvent(ledger: number, mandateId: bigint = 1n): rpc.Api.EventResponse {
  return mandateCreatedEvent({
    ledger,
    mandateId,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1_000_000n,
    intervalLedgers: 144,
    expiryLedger: 50_000,
  });
}

test("ingests a ledger range, applying events and persisting progress", async () => {
  const { db, ingester } = await setup([
    createEvent(100),
    chargeAuthorizedEvent({ ledger: 250, mandateId: 1n, merchant: MERCHANT, token: TOKEN, amount: 25_000n, currentLedger: 250, nextValidLedger: 394 }),
    mandateRevokedEvent({ ledger: 300, mandateId: 1n, revoker: ACCOUNT }),
  ]);

  const summary = await ingester.runOnce();

  assert.equal(summary.fromLedger, 1);
  assert.equal(summary.toLedger, 300);
  assert.equal(summary.processed, 3);

  const mandate = await db.getMandate(1n);
  assert.ok(mandate);
  assert.equal(mandate.status, "Revoked");
  assert.equal(mandate.account, ACCOUNT);
  assert.equal(mandate.merchant, MERCHANT);
  assert.equal(mandate.maxAmount, 1_000_000n);
  assert.equal(mandate.createdLedger, 100n);
  assert.equal(mandate.updatedLedger, 300n);

  const charges = await db.listCharges(1n);
  assert.equal(charges.length, 1);
  assert.equal(charges[0]?.amount, 25_000n);
  assert.equal(charges[0]?.nextValidLedger, 394n);

  assert.equal(await db.getLastLedger(), 300n);
});

test("charge_authorized advances next_valid_ledger", async () => {
  const { db, ingester } = await setup([
    createEvent(100),
    chargeAuthorizedEvent({ ledger: 250, mandateId: 1n, merchant: MERCHANT, token: TOKEN, amount: 25_000n, currentLedger: 250, nextValidLedger: 394 }),
  ]);

  await ingester.runOnce();

  const mandate = await db.getMandate(1n);
  assert.ok(mandate);
  assert.equal(mandate.nextValidLedger, 394n);
  assert.equal(mandate.status, "Active");
});

test("mandate_expired marks the mandate expired", async () => {
  const { db, ingester } = await setup([
    createEvent(100),
    mandateExpiredEvent({ ledger: 400, mandateId: 1n, expiryLedger: 400 }),
  ]);

  await ingester.runOnce();

  const mandate = await db.getMandate(1n);
  assert.ok(mandate);
  assert.equal(mandate.status, "Expired");
  assert.equal(mandate.updatedLedger, 400n);
});

test("re-ingesting the same range is idempotent", async () => {
  const events = [
    createEvent(100),
    chargeAuthorizedEvent({ ledger: 250, mandateId: 1n, merchant: MERCHANT, token: TOKEN, amount: 25_000n, currentLedger: 250, nextValidLedger: 394 }),
  ];
  const { db, ingester } = await setup(events);

  const first = await ingester.runOnce();
  const second = await ingester.runOnce();

  assert.equal(first.processed, 2);
  // Nothing new to ingest on the second pass.
  assert.equal(second.processed, 0);
  assert.equal((await db.listCharges(1n)).length, 1);
  assert.equal((await db.getMandate(1n))?.createdLedger, 100n);
  assert.equal(await db.getLastLedger(), 250n);
});

test("restart resumes from the last committed ledger", async () => {
  const { db, server, ingester } = await setup([
    createEvent(100),
    chargeAuthorizedEvent({ ledger: 150, mandateId: 1n, merchant: MERCHANT, token: TOKEN, amount: 25_000n, currentLedger: 150, nextValidLedger: 294 }),
  ]);

  const first = await ingester.runOnce();
  assert.equal(first.processed, 2);
  assert.equal(await db.getLastLedger(), 150n);

  // A later ledger closes while the indexer is down. The next run starts
  // from ledger 151 and only picks up the new event.
  server.events.push(mandateRevokedEvent({ ledger: 200, mandateId: 1n, revoker: MERCHANT }));

  const second = await ingester.runOnce();
  assert.equal(second.fromLedger, 151);
  assert.equal(second.processed, 1);
  assert.equal((await db.getMandate(1n))?.status, "Revoked");
  assert.equal(await db.getLastLedger(), 200n);
});

test("transient failures are retried with backoff and the run continues", async () => {
  const { server, ingester } = await setup([createEvent(100)]);

  server.failuresRemaining = 2;

  const summary = await ingester.runOnce();
  assert.equal(summary.processed, 1);
  // Initial call plus two retries on the same page.
  assert.ok(server.calls >= 3);
  assert.equal(server.failuresRemaining, 0);
});

test("persistent failure aborts the run without moving the committed ledger", async () => {
  const { db, server, ingester } = await setup([createEvent(100)]);
  await ingester.runOnce();
  assert.equal(await db.getLastLedger(), 100n);

  // A new ledger closes, so the next run has a range to fetch; the RPC then
  // fails on every attempt.
  server.events.push(mandateRevokedEvent({ ledger: 150, mandateId: 1n, revoker: MERCHANT }));
  server.failWith = new Error("rpc down");

  await assert.rejects(() => ingester.runOnce(), /rpc down/);
  // Progress from before the failure is preserved.
  assert.equal(await db.getLastLedger(), 100n);
});

test("cold start without a start ledger begins at the current ledger", async () => {
  // The current ledger (100) is in the past; events already in it are
  // ingested because the range is inclusive, which is safe: writes are
  // idempotent.
  const { db, ingester } = await setup([createEvent(100)], testConfig({ startLedger: null }));

  const summary = await ingester.runOnce();
  assert.equal(summary.fromLedger, 100);
  assert.equal(summary.processed, 1);
  assert.equal(await db.getLastLedger(), 100n);
  assert.equal((await db.getMandate(1n))?.account, ACCOUNT);
});

test("requires a configured mandate policy id", async () => {
  const db = await createMemDb();
  const server = new FakeEventsServer([]);
  const ingester = new Ingester(server as unknown as rpc.Server, db, testConfig({ mandatePolicyId: "" }), {
    maxAttempts: 3,
    baseDelayMs: 1,
  });
  await assert.rejects(() => ingester.runOnce(), /MANDATE_POLICY_ID is not configured/);
  await db.close();
});

test("committed cursor advances over pages with no decodable events", async () => {
  // An event the decoder does not recognize must not stall the committed
  // cursor: the whole page is behind us once the loop stops, and re-fetching
  // it on every poll would never make progress.
  const unknown = createEvent(100);
  unknown.topic = [xdr.ScVal.scvSymbol("future_event"), xdr.ScVal.scvU64(xdr.Uint64.fromString("1"))];
  const { db, ingester } = await setup([unknown, createEvent(200)]);

  const summary = await ingester.runOnce();
  assert.equal(summary.processed, 1);
  assert.equal(await db.getLastLedger(), 200n);
});

test("cursor advances even when every event in a range is undecodable", async () => {
  const unknown = (ledger: number): rpc.Api.EventResponse => {
    const event = createEvent(ledger);
    event.topic = [xdr.ScVal.scvSymbol("future_event"), xdr.ScVal.scvU64(xdr.Uint64.fromString("1"))];
    return event;
  };
  const { db, ingester } = await setup([unknown(100), unknown(101)]);

  const summary = await ingester.runOnce();
  assert.equal(summary.processed, 0);
  assert.equal(await db.getLastLedger(), 101n);
});

test("paged ingestion across multiple getEvents calls", async () => {
  const events = [
    createEvent(100),
    createEvent(110, 2n),
    createEvent(120, 3n),
    chargeAuthorizedEvent({ ledger: 130, mandateId: 1n, merchant: MERCHANT, token: TOKEN, amount: 1_000n, currentLedger: 130, nextValidLedger: 274 }),
  ];
  const { db, server, ingester } = await setup(events, testConfig({ pageSize: 2 }));

  const summary = await ingester.runOnce();
  assert.equal(summary.processed, 4);
  // Two full pages plus a short final page.
  assert.ok(server.calls >= 3);

  assert.equal((await db.listCharges(1n)).length, 1);
  assert.equal((await db.getMandate(2n))?.merchant, MERCHANT);
  assert.equal((await db.getMandate(3n))?.merchant, MERCHANT);
  assert.equal(await db.getLastLedger(), 130n);
});
