/**
 * Typed client for the indexer's read-only HTTP API. The indexer is the
 * reference frontend's source of truth for mandate state and charge
 * history; all reads in the UI go through here.
 */

import type { MandateStatus } from "@subrails/sdk";

/** A mandate as served by the indexer (amounts and ledgers are decimal strings). */
export interface IndexerMandate {
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

/** One authorized charge as served by the indexer. */
export interface IndexerCharge {
  txHash: string;
  eventIndex: number;
  mandateId: string;
  merchant: string;
  token: string;
  amount: string;
  ledger: number;
  nextValidLedger: string | null;
}

export interface IndexerMandateDetail {
  mandate: IndexerMandate;
  charges: IndexerCharge[];
}

/** Outcome of a read call, including a short failure reason when it fails. */
export type IndexerResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

async function getJson<T>(url: string): Promise<IndexerResult<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, reason: body?.error ?? `Indexer responded with status ${response.status}.` };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, reason: `Indexer unreachable: ${message}` };
  }
}

/** Lists mandates by account (or by merchant). */
export function fetchMandates(
  baseUrl: string,
  by: { account: string } | { merchant: string },
): Promise<IndexerResult<IndexerMandate[]>> {
  const key = "account" in by ? "account" : "merchant";
  const value = "account" in by ? by.account : by.merchant;
  return getJson<{ mandates: IndexerMandate[] }>(`${baseUrl}/mandates?${key}=${encodeURIComponent(value)}`).then(
    (result) =>
      result.ok ? { ok: true, data: result.data.mandates } : { ok: false, reason: result.reason },
  );
}

/** Fetches one mandate with its charge history. */
export function fetchMandateDetail(
  baseUrl: string,
  mandateId: bigint,
): Promise<IndexerResult<IndexerMandateDetail>> {
  return getJson<IndexerMandateDetail>(`${baseUrl}/mandates/${mandateId.toString()}`);
}

/** Fetches the indexer health status. */
export function fetchIndexerHealth(baseUrl: string): Promise<IndexerResult<{ ok: boolean; service: string }>> {
  return getJson<{ ok: boolean; service: string }>(`${baseUrl}/health`);
}
