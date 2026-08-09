/**
 * Typed Postgres query layer for the indexer.
 *
 * Wraps `pg` with row types and bigint/number conversion. Token amounts are
 * NUMERIC and become `bigint`; ledger numbers are BIGINT/INTEGER and become
 * `bigint`/`number`. All writes go through idempotent upserts keyed by
 * `(mandate_id)` for mandate state and `(tx_hash, event_index)` for charges,
 * so re-ingesting a ledger range never duplicates rows.
 */

import { readFileSync } from "node:fs";

import pg from "pg";

import type { MandateStatus } from "@subrails/sdk";
import { logger } from "../logging.ts";

/** A minimal queryable (either the pool or a checked-out client). */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** Current state of one mandate, as stored in the `mandates` table. */
export interface MandateRow {
  mandateId: bigint;
  account: string;
  merchant: string;
  token: string;
  maxAmount: bigint;
  intervalLedgers: number;
  nextValidLedger: bigint;
  expiryLedger: bigint;
  status: MandateStatus;
  createdLedger: bigint;
  updatedLedger: bigint;
}

/** One authorized charge, as stored in the `charges` table. */
export interface ChargeRow {
  txHash: string;
  eventIndex: number;
  mandateId: bigint;
  merchant: string;
  token: string;
  amount: bigint;
  ledger: number;
  nextValidLedger: bigint | null;
}

/**
 * Typed access to the indexer database. All methods are idempotent:
 * re-running them with the same inputs leaves the tables unchanged.
 */
export class Db {
  private readonly pool: pg.Pool;

  /**
   * @param databaseUrl - Postgres connection string
   * @param pool - optional pre-built pool (test seam for pg-mem)
   */
  constructor(databaseUrl: string, pool?: pg.Pool) {
    this.pool = pool ?? new pg.Pool({ connectionString: databaseUrl });
  }

  /**
   * Applies the schema. Idempotent: every statement is `CREATE ... IF NOT
   * EXISTS`. By default reads `schema.sql` next to this module (copied into
   * `dist/` at build time).
   */
  async init(schemaSql?: string): Promise<void> {
    const sql = schemaSql ?? readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Runs `fn` inside a transaction (rolls back on any thrown error). */
  async transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
  }

  // -- indexer state --------------------------------------------------------

  /** The last fully ingested ledger, or null when nothing has been ingested. */
  async getLastLedger(): Promise<bigint | null> {
    const { rows } = await this.pool.query<{ last_ledger: string }>(
      "SELECT last_ledger FROM indexer_state WHERE id = 1",
    );
    const row = rows[0];
    return row === undefined ? null : BigInt(row.last_ledger);
  }

  /** Records `ledger` as the last fully ingested ledger (idempotent). */
  async setLastLedger(ledger: bigint): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_state (id, last_ledger) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()`,
      [ledger.toString()],
    );
  }

  // -- mandate state --------------------------------------------------------

  /** Upserts the mandate row from a `mandate_created` event. */
  async upsertMandate(
    m: {
      mandateId: bigint;
      account: string;
      merchant: string;
      token: string;
      maxAmount: bigint;
      intervalLedgers: number;
      nextValidLedger: bigint;
      expiryLedger: bigint;
      ledger: bigint;
    },
    q?: Queryable,
  ): Promise<void> {
    await (q ?? this.pool).query(
      `INSERT INTO mandates (
         mandate_id, account, merchant, token, max_amount, interval_ledgers,
         next_valid_ledger, expiry_ledger, status, created_ledger, updated_ledger
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', $9, $9)
       ON CONFLICT (mandate_id) DO UPDATE SET
         account = EXCLUDED.account,
         merchant = EXCLUDED.merchant,
         token = EXCLUDED.token,
         max_amount = EXCLUDED.max_amount,
         interval_ledgers = EXCLUDED.interval_ledgers,
         next_valid_ledger = EXCLUDED.next_valid_ledger,
         expiry_ledger = EXCLUDED.expiry_ledger,
         status = 'Active',
         updated_ledger = EXCLUDED.updated_ledger,
         updated_at = now()`,
      [
        m.mandateId.toString(),
        m.account,
        m.merchant,
        m.token,
        m.maxAmount.toString(),
        m.intervalLedgers,
        m.nextValidLedger.toString(),
        m.expiryLedger.toString(),
        m.ledger.toString(),
      ],
    );
  }

  /** Advances `next_valid_ledger` after a `charge_authorized` event. */
  async advanceMandate(
    mandateId: bigint,
    nextValidLedger: bigint,
    ledger: bigint,
    q?: Queryable,
  ): Promise<number> {
    const result = await (q ?? this.pool).query(
      `UPDATE mandates
         SET next_valid_ledger = $2, updated_ledger = $3, updated_at = now()
       WHERE mandate_id = $1`,
      [mandateId.toString(), nextValidLedger.toString(), ledger.toString()],
    );
    return result.rowCount ?? 0;
  }

  /** Marks a mandate Revoked from a `mandate_revoked` event. */
  async markRevoked(mandateId: bigint, ledger: bigint, q?: Queryable): Promise<number> {
    return this.updateStatus(mandateId, "Revoked", ledger, q);
  }

  /** Marks a mandate Expired from a `mandate_expired` event. */
  async markExpired(mandateId: bigint, ledger: bigint, q?: Queryable): Promise<number> {
    return this.updateStatus(mandateId, "Expired", ledger, q);
  }

  private async updateStatus(
    mandateId: bigint,
    status: MandateStatus,
    ledger: bigint,
    q?: Queryable,
  ): Promise<number> {
    const result = await (q ?? this.pool).query(
      `UPDATE mandates SET status = $2, updated_ledger = $3, updated_at = now()
       WHERE mandate_id = $1`,
      [mandateId.toString(), status, ledger.toString()],
    );
    return result.rowCount ?? 0;
  }

  // -- charge history -------------------------------------------------------

  /** Inserts one authorized charge, keyed by (tx_hash, event_index). */
  async insertCharge(
    c: {
      txHash: string;
      eventIndex: number;
      mandateId: bigint;
      merchant: string;
      token: string;
      amount: bigint;
      ledger: number;
      nextValidLedger: bigint | null;
    },
    q?: Queryable,
  ): Promise<void> {
    await (q ?? this.pool).query(
      `INSERT INTO charges (tx_hash, event_index, mandate_id, merchant, token, amount, ledger, next_valid_ledger)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tx_hash, event_index) DO NOTHING`,
      [
        c.txHash,
        c.eventIndex,
        c.mandateId.toString(),
        c.merchant,
        c.token,
        c.amount.toString(),
        c.ledger,
        c.nextValidLedger === null ? null : c.nextValidLedger.toString(),
      ],
    );
  }

  // -- reads (for the read-only API) ----------------------------------------

  async listMandatesByAccount(account: string): Promise<MandateRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM mandates WHERE account = $1 ORDER BY mandate_id",
      [account],
    );
    return rows.map(mandateRowFromDb);
  }

  async listMandatesByMerchant(merchant: string): Promise<MandateRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM mandates WHERE merchant = $1 ORDER BY mandate_id",
      [merchant],
    );
    return rows.map(mandateRowFromDb);
  }

  async getMandate(mandateId: bigint): Promise<MandateRow | null> {
    const { rows } = await this.pool.query("SELECT * FROM mandates WHERE mandate_id = $1", [
      mandateId.toString(),
    ]);
    const row = rows[0];
    return row === undefined ? null : mandateRowFromDb(row);
  }

  async listCharges(mandateId: bigint): Promise<ChargeRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM charges WHERE mandate_id = $1 ORDER BY ledger, event_index",
      [mandateId.toString()],
    );
    return rows.map(chargeRowFromDb);
  }
}

interface MandateDbRow {
  mandate_id: string;
  account: string;
  merchant: string;
  token: string;
  max_amount: string;
  interval_ledgers: number;
  next_valid_ledger: string;
  expiry_ledger: string;
  status: string;
  created_ledger: string;
  updated_ledger: string;
}

interface ChargeDbRow {
  tx_hash: string;
  event_index: number;
  mandate_id: string;
  merchant: string;
  token: string;
  amount: string;
  ledger: number;
  next_valid_ledger: string | null;
}

function mandateRowFromDb(row: MandateDbRow): MandateRow {
  const status = row.status;
  if (status !== "Active" && status !== "Revoked" && status !== "Expired") {
    logger.warn({ status, mandateId: row.mandate_id }, "unknown mandate status in db; treating as revoked");
  }
  return {
    mandateId: BigInt(row.mandate_id),
    account: row.account,
    merchant: row.merchant,
    token: row.token,
    maxAmount: BigInt(row.max_amount),
    intervalLedgers: row.interval_ledgers,
    nextValidLedger: BigInt(row.next_valid_ledger),
    expiryLedger: BigInt(row.expiry_ledger),
    status: (status === "Active" || status === "Expired" ? status : "Revoked") as MandateStatus,
    createdLedger: BigInt(row.created_ledger),
    updatedLedger: BigInt(row.updated_ledger),
  };
}

function chargeRowFromDb(row: ChargeDbRow): ChargeRow {
  return {
    txHash: row.tx_hash,
    eventIndex: row.event_index,
    mandateId: BigInt(row.mandate_id),
    merchant: row.merchant,
    token: row.token,
    amount: BigInt(row.amount),
    ledger: row.ledger,
    nextValidLedger: row.next_valid_ledger === null ? null : BigInt(row.next_valid_ledger),
  };
}
