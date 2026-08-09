import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/server.ts";
import type { ChargeJson, MandateJson } from "../src/api/server.ts";
import { Db } from "../src/db/client.ts";
import { contractId, createMemDb } from "./helpers.ts";

const ACCOUNT = contractId(10);
const MERCHANT = contractId(11);
const TOKEN = contractId(12);

async function seed(db: Db): Promise<void> {
  await db.upsertMandate({
    mandateId: 1n,
    account: ACCOUNT,
    merchant: MERCHANT,
    token: TOKEN,
    maxAmount: 1_000_000n,
    intervalLedgers: 144,
    nextValidLedger: 100n,
    expiryLedger: 50_000n,
    ledger: 100n,
  });
  await db.insertCharge({
    txHash: "abc",
    eventIndex: 0,
    mandateId: 1n,
    merchant: MERCHANT,
    token: TOKEN,
    amount: 25_000n,
    ledger: 250,
    nextValidLedger: 394n,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

test("health endpoint", async () => {
  const db = await createMemDb();
  const app = createApi(db);
  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, service: "subrails-indexer" });
  await db.close();
});

test("lists mandates by account and by merchant", async () => {
  const db = await createMemDb();
  await seed(db);
  const app = createApi(db);

  const byAccount = await app.request(`/mandates?account=${ACCOUNT}`);
  assert.equal(byAccount.status, 200);
  const accountBody = await json(byAccount);
  const mandates = accountBody.mandates as MandateJson[];
  assert.equal(mandates.length, 1);
  assert.equal(mandates[0]?.mandateId, "1");
  assert.equal(mandates[0]?.maxAmount, "1000000");
  assert.equal(mandates[0]?.status, "Active");

  const byMerchant = await app.request(`/mandates?merchant=${MERCHANT}`);
  assert.equal(byMerchant.status, 200);
  assert.equal(((await json(byMerchant)).mandates as MandateJson[]).length, 1);

  // A different account sees nothing.
  const other = await app.request(`/mandates?account=${contractId(99)}`);
  assert.equal(other.status, 200);
  assert.deepEqual((await json(other)).mandates, []);

  await db.close();
});

test("mandate listing rejects missing or conflicting filters", async () => {
  const db = await createMemDb();
  const app = createApi(db);

  const missing = await app.request("/mandates");
  assert.equal(missing.status, 400);

  const both = await app.request(`/mandates?account=${ACCOUNT}&merchant=${MERCHANT}`);
  assert.equal(both.status, 400);

  await db.close();
});

test("mandate detail includes charge history", async () => {
  const db = await createMemDb();
  await seed(db);
  const app = createApi(db);

  const response = await app.request("/mandates/1");
  assert.equal(response.status, 200);
  const body = await json(response);
  const mandate = body.mandate as MandateJson;
  const charges = body.charges as ChargeJson[];
  assert.equal(mandate.mandateId, "1");
  assert.equal(mandate.nextValidLedger, "100");
  assert.equal(charges.length, 1);
  assert.equal(charges[0]?.txHash, "abc");
  assert.equal(charges[0]?.amount, "25000");
  assert.equal(charges[0]?.nextValidLedger, "394");

  await db.close();
});

test("mandate detail rejects bad ids and unknown mandates", async () => {
  const db = await createMemDb();
  await seed(db);
  const app = createApi(db);

  const invalid = await app.request("/mandates/not-a-number");
  assert.equal(invalid.status, 400);

  const missing = await app.request("/mandates/999");
  assert.equal(missing.status, 404);

  await db.close();
});

test("unknown routes return 404", async () => {
  const db = await createMemDb();
  const app = createApi(db);
  const response = await app.request("/nope");
  assert.equal(response.status, 404);
  await db.close();
});
