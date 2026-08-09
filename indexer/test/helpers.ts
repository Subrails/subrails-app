/**
 * Shared helpers for the indexer test suite: contract event factories, a
 * fake RPC server that pages `getEvents` the way Soroban RPC does, and an
 * in-memory Postgres (pg-mem) backed `Db`.
 */

import { readFileSync } from "node:fs";

import { StrKey, xdr } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import { addressScVal, i128ScVal, u32ScVal, u64ScVal } from "@subrails/sdk";
import { newDb } from "pg-mem";

import { Db } from "../src/db/client.ts";

/** The schema DDL, read from source (the tests run before dist is built). */
export const SCHEMA = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");

/**
 * Builds a `Db` over an in-memory Postgres. The connection string is
 * ignored; pg-mem replaces the pool entirely.
 */
export async function createMemDb(): Promise<Db> {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const db = new Db("postgres://in-memory", new Pool());
  await db.init(SCHEMA);
  return db;
}

/** A valid contract id strkey built from a single repeated byte. */
export function contractId(byte: number): string {
  return StrKey.encodeContract(Buffer.from(new Uint8Array(32).fill(byte)));
}

export const POLICY = contractId(1);

export interface EventOverrides {
  ledger: number;
  mandateId: bigint;
  txHash?: string;
  eventIndex?: number;
}

function baseEvent(overrides: EventOverrides, name: string, value: xdr.ScVal): rpc.Api.EventResponse {
  return {
    id: `${overrides.ledger}-0-${overrides.eventIndex ?? 0}`,
    type: "contract",
    ledger: overrides.ledger,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    contractId: POLICY as unknown as rpc.Api.EventResponse["contractId"],
    topic: [xdr.ScVal.scvSymbol(name), u64ScVal(overrides.mandateId)],
    value,
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: overrides.txHash ?? `tx-${overrides.ledger}-${overrides.mandateId}`,
  };
}

export function mandateCreatedEvent(overrides: EventOverrides & { account: string; merchant: string; token: string; maxAmount: bigint; intervalLedgers: number; expiryLedger: number }): rpc.Api.EventResponse {
  return baseEvent(overrides, "mandate_created",
    xdr.ScVal.scvVec([
      addressScVal(overrides.account),
      addressScVal(overrides.merchant),
      addressScVal(overrides.token),
      i128ScVal(overrides.maxAmount),
      u32ScVal(overrides.intervalLedgers),
      u32ScVal(overrides.expiryLedger),
    ]));
}

export function chargeAuthorizedEvent(overrides: EventOverrides & { merchant: string; token: string; amount: bigint; currentLedger: number; nextValidLedger: number }): rpc.Api.EventResponse {
  return baseEvent(overrides, "charge_authorized",
    xdr.ScVal.scvVec([
      addressScVal(overrides.merchant),
      addressScVal(overrides.token),
      i128ScVal(overrides.amount),
      u32ScVal(overrides.currentLedger),
      u32ScVal(overrides.nextValidLedger),
    ]));
}

export function mandateRevokedEvent(overrides: EventOverrides & { revoker: string }): rpc.Api.EventResponse {
  return baseEvent(overrides, "mandate_revoked", addressScVal(overrides.revoker));
}

export function mandateExpiredEvent(overrides: EventOverrides & { expiryLedger: number }): rpc.Api.EventResponse {
  return baseEvent(overrides, "mandate_expired", u32ScVal(overrides.expiryLedger));
}

export function mandateRegisteredEvent(overrides: EventOverrides): rpc.Api.EventResponse {
  return baseEvent(overrides, "mandate_registered", xdr.ScVal.scvVoid());
}

/**
 * A fake RPC server that serves `getEvents` pages from a fixed event list,
 * honoring startLedger, cursor, endLedger, and limit the way Soroban RPC
 * does. The cursor is the id of the last returned event.
 */
export class FakeEventsServer {
  events: rpc.Api.EventResponse[] = [];
  /** Set to throw from every getEvents call, to test retry/resilience. */
  failWith: Error | null = null;
  /** Number of upcoming getEvents calls that fail before recovering. */
  failuresRemaining: number = 0;
  calls: number = 0;

  constructor(events: rpc.Api.EventResponse[] = []) {
    this.events = [...events].sort((a, b) => a.ledger - b.ledger);
  }

  async getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    const maxLedger = this.events.reduce((max, e) => Math.max(max, e.ledger), 0);
    return { sequence: maxLedger } as rpc.Api.GetLatestLedgerResponse;
  }

  async getEvents(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    this.calls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw this.failWith ?? new Error("fake rpc failure");
    }
    if (this.failWith !== null) {
      throw this.failWith;
    }
    let candidates = this.events;
    if ("cursor" in request && request.cursor !== undefined) {
      candidates = candidates.filter((e) => e.id > (request.cursor as string));
    } else if ("startLedger" in request) {
      candidates = candidates.filter((e) => e.ledger >= request.startLedger);
    }
    const endLedger = request.endLedger;
    if (endLedger !== undefined) {
      candidates = candidates.filter((e) => e.ledger <= endLedger);
    }
    const page = candidates.slice(0, request.limit ?? 200);
    const last = page[page.length - 1];
    return {
      events: page,
      cursor: last === undefined ? "" : last.id,
      latestLedger: 0,
      latestLedgerCloseTime: "2026-01-01T00:00:00Z",
      oldestLedger: 1,
      oldestLedgerCloseTime: "2026-01-01T00:00:00Z",
    } as unknown as rpc.Api.GetEventsResponse;
  }
}
