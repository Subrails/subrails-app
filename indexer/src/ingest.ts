/**
 * Event ingestion: polls Soroban RPC `getEvents` forward from the last
 * committed ledger, decodes Subrails events, and applies them to Postgres
 * with idempotent upserts.
 *
 * Resumability: after every page the last seen ledger is persisted in
 * `indexer_state`. A restart resumes from the ledger after it. The whole
 * range is re-fetched from the start ledger on restart, which is safe
 * because every write is an upsert (state) or a `ON CONFLICT DO NOTHING`
 * insert (charges).
 *
 * Resilience: transient RPC failures are retried with exponential backoff;
 * a page that keeps failing aborts the run (preserving the last committed
 * ledger) and the caller's loop logs and retries on the next tick. One bad
 * page never corrupts state or crashes the process.
 */

import { rpc } from "@stellar/stellar-sdk";

import type { IndexerConfig } from "./config.ts";
import { Db } from "./db/client.ts";
import { decodeEvent } from "./events.ts";
import type { SubrailsEvent } from "./events.ts";
import { logger } from "./logging.ts";

/** The result of one ingest run. */
export interface IngestSummary {
  /** Ledger this run started from. */
  fromLedger: number;
  /** The latest ledger known when the run started. */
  toLedger: number;
  /** Number of decoded Subrails events applied. */
  processed: number;
}

/**
 * Polls `getEvents` and applies decoded events to the database.
 */
export class Ingester {
  private readonly server: rpc.Server;
  private readonly db: Db;
  private readonly config: IndexerConfig;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(
    server: rpc.Server,
    db: Db,
    config: IndexerConfig,
    opts: { maxAttempts?: number; baseDelayMs?: number } = {},
  ) {
    this.server = server;
    this.db = db;
    this.config = config;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
  }

  /**
   * Runs one ingest pass: from the last committed ledger (or
   * `config.startLedger`, or the current ledger on a cold start) up to the
   * latest ledger.
   *
   * @throws on persistent RPC failures; the last committed ledger is left
   *   untouched so the next run resumes from the same position
   */
  async runOnce(): Promise<IngestSummary> {
    if (this.config.mandatePolicyId.trim().length === 0) {
      throw new Error("MANDATE_POLICY_ID is not configured; the indexer cannot filter events.");
    }
    const latest = await this.server.getLatestLedger();
    const latestLedger = latest.sequence;

    let start = await this.db.getLastLedger();
    if (start === null) {
      start = this.config.startLedger === null ? BigInt(latestLedger) : BigInt(this.config.startLedger);
    } else {
      start += 1n;
    }
    const fromLedger = Number(start);
    if (start > BigInt(latestLedger)) {
      return { fromLedger, toLedger: latestLedger, processed: 0 };
    }

    const filters: rpc.Api.EventFilter[] = [
      { type: "contract", contractIds: [this.config.mandatePolicyId] },
    ];

    let cursor: string | undefined;
    let processed = 0;
    let lastSeenLedger = fromLedger - 1;
    const pageSize = this.config.pageSize;

    while (true) {
      const request: rpc.Api.GetEventsRequest = cursor === undefined
        ? { startLedger: fromLedger, endLedger: latestLedger, filters, limit: pageSize }
        : { cursor, filters, limit: pageSize };

      const page = await this.getEventsWithRetry(request);

      if (page.events.length > 0) {
        await this.db.transaction(async (q) => {
          for (const event of page.events) {
            const decoded = decodeEvent(event);
            if (decoded === null) {
              continue;
            }
            await this.apply(decoded, q);
            processed += 1;
          }
        });
        // Advance the committed cursor to the last event ledger in the page
        // even when nothing in it decoded. Once the loop terminates, the
        // whole page is behind us; without this, a range containing only
        // undecodable events would stall the cursor and every poll would
        // re-fetch the same range. Idempotent writes make this safe.
        const pageEnd = page.events[page.events.length - 1];
        if (pageEnd !== undefined && pageEnd.ledger > lastSeenLedger) {
          lastSeenLedger = pageEnd.ledger;
        }
      }

      // Persist progress before the next page so a crash mid-range resumes
      // cleanly (idempotent writes make re-applying a page safe).
      await this.db.setLastLedger(BigInt(Math.max(lastSeenLedger, fromLedger - 1)));
      if (page.events.length < pageSize) {
        break;
      }
      cursor = page.cursor;
      if (cursor === undefined || cursor === "") {
        break;
      }
      // Cursor pages cannot carry an endLedger, so the loop keeps paging
      // while pages are full, even across multiple pages within the final
      // ledger. It only stops once an event is seen past the snapshot
      // ledger; events beyond it are still ingested (state follows the
      // highest event ledger, so nothing is skipped) and the next poll tick
      // resumes cleanly after them.
      const pageEnd = page.events[page.events.length - 1];
      if (pageEnd !== undefined && pageEnd.ledger > latestLedger) {
        break;
      }
    }

    return { fromLedger, toLedger: latestLedger, processed };
  }

  /** Fetches one page of events, retrying transient failures with backoff. */
  private async getEventsWithRetry(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.server.getEvents(request);
      } catch (cause) {
        attempt += 1;
        if (attempt >= this.maxAttempts) {
          logger.error({ err: cause, attempt, page: summarizeRequest(request) }, "getEvents failed after retries; keeping last committed ledger");
          throw cause;
        }
        const delayMs = Math.min(this.baseDelayMs * 2 ** attempt, 10_000);
        logger.warn({ err: cause, attempt, delayMs }, "getEvents failed; retrying with backoff");
        await sleep(delayMs);
      }
    }
  }

  /** Applies one decoded event to the database. */
  private async apply(event: SubrailsEvent, q: import("./db/client.ts").Queryable): Promise<void> {
    switch (event.type) {
      case "mandate_created":
        await this.db.upsertMandate(
          {
            mandateId: event.mandateId,
            account: event.account,
            merchant: event.merchant,
            token: event.token,
            maxAmount: event.maxAmount,
            intervalLedgers: event.intervalLedgers,
            nextValidLedger: BigInt(event.ledger),
            expiryLedger: BigInt(event.expiryLedger),
            ledger: BigInt(event.ledger),
          },
          q,
        );
        break;
      case "charge_authorized": {
        await this.db.advanceMandate(event.mandateId, BigInt(event.nextValidLedger), BigInt(event.ledger), q);
        await this.db.insertCharge(
          {
            txHash: event.txHash,
            eventIndex: event.eventIndex,
            mandateId: event.mandateId,
            merchant: event.merchant,
            token: event.token,
            amount: event.amount,
            ledger: event.ledger,
            nextValidLedger: BigInt(event.nextValidLedger),
          },
          q,
        );
        break;
      }
      case "mandate_revoked":
        await this.db.markRevoked(event.mandateId, BigInt(event.ledger), q);
        break;
      case "mandate_expired":
        await this.db.markExpired(event.mandateId, BigInt(event.ledger), q);
        break;
      case "mandate_registered":
        // Account-local registration; it does not change mandate state and
        // there is no per-account table. Logged for observability.
        logger.debug({ mandateId: event.mandateId, ledger: event.ledger }, "mandate registered on account");
        break;
    }
  }
}

function summarizeRequest(request: rpc.Api.GetEventsRequest): string {
  if ("cursor" in request) {
    return `cursor=${request.cursor}`;
  }
  return `startLedger=${request.startLedger}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
