/**
 * Read-only HTTP API over the indexer database.
 *
 * The API never signs or submits transactions. Endpoints:
 * - GET /health
 * - GET /mandates?account=G...  or  ?merchant=G...
 * - GET /mandates/:id  (mandate detail with charge history)
 */

import { Hono } from "hono";

import type { MandateStatus } from "@subrails/sdk";
import { Db } from "../db/client.ts";
import type { ChargeRow, MandateRow } from "../db/client.ts";
import { logger } from "../logging.ts";

/**
 * JSON-safe mandate shape. Amounts and ledger numbers are bigint in the
 * database and are sent as decimal strings, since JSON has no integer type
 * wide enough for i128 token amounts.
 */
export interface MandateJson {
  mandateId: string;
  account: string;
  merchant: string;
  token: string;
  maxAmount: string;
  intervalLedgers: number;
  nextValidLedger: string;
  expiryLedger: string;
  status: MandateStatus;
  createdLedger: string;
  updatedLedger: string;
}

/** JSON-safe charge shape (amounts and ledgers as decimal strings). */
export interface ChargeJson {
  txHash: string;
  eventIndex: number;
  mandateId: string;
  merchant: string;
  token: string;
  amount: string;
  ledger: number;
  nextValidLedger: string | null;
}

function mandateToJson(m: MandateRow): MandateJson {
  return {
    mandateId: m.mandateId.toString(),
    account: m.account,
    merchant: m.merchant,
    token: m.token,
    maxAmount: m.maxAmount.toString(),
    intervalLedgers: m.intervalLedgers,
    nextValidLedger: m.nextValidLedger.toString(),
    expiryLedger: m.expiryLedger.toString(),
    status: m.status,
    createdLedger: m.createdLedger.toString(),
    updatedLedger: m.updatedLedger.toString(),
  };
}

function chargeToJson(c: ChargeRow): ChargeJson {
  return {
    txHash: c.txHash,
    eventIndex: c.eventIndex,
    mandateId: c.mandateId.toString(),
    merchant: c.merchant,
    token: c.token,
    amount: c.amount.toString(),
    ledger: c.ledger,
    nextValidLedger: c.nextValidLedger === null ? null : c.nextValidLedger.toString(),
  };
}

/** Builds the read-only API over the given database. */
export function createApi(db: Db): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "subrails-indexer" }));

  app.get("/mandates", async (c) => {
    const account = c.req.query("account");
    const merchant = c.req.query("merchant");
    if (account !== undefined && merchant !== undefined) {
      return c.json({ error: "Specify either account or merchant, not both." }, 400);
    }
    try {
      if (account !== undefined) {
        return c.json({ mandates: (await db.listMandatesByAccount(account)).map(mandateToJson) });
      }
      if (merchant !== undefined) {
        return c.json({ mandates: (await db.listMandatesByMerchant(merchant)).map(mandateToJson) });
      }
      return c.json({ error: "Missing account or merchant query parameter." }, 400);
    } catch (cause) {
      logger.error({ err: cause }, "mandate listing failed");
      return c.json({ error: "Internal error." }, 500);
    }
  });

  app.get("/mandates/:id", async (c) => {
    const raw = c.req.param("id");
    let mandateId: bigint;
    try {
      mandateId = BigInt(raw);
    } catch {
      return c.json({ error: "Mandate id must be an integer." }, 400);
    }
    try {
      const mandate = await db.getMandate(mandateId);
      if (mandate === null) {
        return c.json({ error: "Mandate not found." }, 404);
      }
      const charges = (await db.listCharges(mandateId)).map(chargeToJson);
      return c.json({ mandate: mandateToJson(mandate), charges });
    } catch (cause) {
      logger.error({ err: cause, mandateId: raw }, "mandate detail failed");
      return c.json({ error: "Internal error." }, 500);
    }
  });

  app.notFound((c) => c.json({ error: "Not found." }, 404));

  return app;
}
