/**
 * Decodes Subrails contract events into typed objects.
 *
 * Event shapes (matching subrails-contract's `events.rs`):
 * - mandate_created: topics ("mandate_created", id), data (account, merchant,
 *   token, max_amount, interval_ledgers, expiry_ledger)
 * - charge_authorized: topics ("charge_authorized", id), data (merchant,
 *   token, amount, current_ledger, next_valid_ledger)
 * - mandate_revoked: topics ("mandate_revoked", id), data (revoker)
 * - mandate_expired: topics ("mandate_expired", id), data (expiry_ledger)
 * - mandate_registered: topics ("mandate_registered", id), data ()
 *
 * Topics carry identifiers; values carry the data payload. Unknown events
 * (e.g. `account_initialized`) and events from failed calls decode to null.
 */

import { rpc, xdr } from "@stellar/stellar-sdk";
import { parseAddress, parseI128, parseU32, parseU64 } from "@subrails/sdk";

/** A decoded Subrails event. */
export type SubrailsEvent =
  | {
      type: "mandate_created";
      mandateId: bigint;
      account: string;
      merchant: string;
      token: string;
      maxAmount: bigint;
      intervalLedgers: number;
      expiryLedger: number;
      ledger: number;
      txHash: string;
      eventIndex: number;
    }
  | {
      type: "charge_authorized";
      mandateId: bigint;
      merchant: string;
      token: string;
      amount: bigint;
      currentLedger: number;
      nextValidLedger: number;
      ledger: number;
      txHash: string;
      eventIndex: number;
    }
  | {
      type: "mandate_revoked";
      mandateId: bigint;
      revoker: string;
      ledger: number;
      txHash: string;
      eventIndex: number;
    }
  | {
      type: "mandate_expired";
      mandateId: bigint;
      expiryLedger: number;
      ledger: number;
      txHash: string;
      eventIndex: number;
    }
  | {
      type: "mandate_registered";
      mandateId: bigint;
      ledger: number;
      txHash: string;
      eventIndex: number;
    };

/**
 * Decodes one RPC event into a typed {@link SubrailsEvent}, or returns null
 * when the event is not one of the tracked Subrails events (including
 * events from failed contract calls).
 */
export function decodeEvent(event: rpc.Api.EventResponse): SubrailsEvent | null {
  if (!event.inSuccessfulContractCall) {
    return null;
  }
  const common = {
    ledger: event.ledger,
    txHash: event.txHash,
    eventIndex: eventIndexFromId(event.id),
  };

  const topics = event.topic;
  const nameTopic = topics[0];
  if (nameTopic === undefined || nameTopic.switch().name !== "scvSymbol") {
    return null;
  }
  const name = nameTopic.sym().toString();
  const idTopic = topics[1];
  if (idTopic === undefined) {
    return null;
  }

  try {
    const mandateId = parseU64(idTopic, "event mandate id");
    switch (name) {
      case "mandate_created": {
        const fields = dataVec(event.value);
        if (fields === null || fields.length < 6) {
          return null;
        }
        return {
          ...common,
          type: "mandate_created",
          mandateId,
          account: parseAddress(fields[0]!, "mandate_created.account"),
          merchant: parseAddress(fields[1]!, "mandate_created.merchant"),
          token: parseAddress(fields[2]!, "mandate_created.token"),
          maxAmount: parseI128(fields[3]!, "mandate_created.max_amount"),
          intervalLedgers: parseU32(fields[4]!, "mandate_created.interval_ledgers"),
          expiryLedger: parseU32(fields[5]!, "mandate_created.expiry_ledger"),
        };
      }
      case "charge_authorized": {
        const fields = dataVec(event.value);
        if (fields === null || fields.length < 5) {
          return null;
        }
        return {
          ...common,
          type: "charge_authorized",
          mandateId,
          merchant: parseAddress(fields[0]!, "charge_authorized.merchant"),
          token: parseAddress(fields[1]!, "charge_authorized.token"),
          amount: parseI128(fields[2]!, "charge_authorized.amount"),
          currentLedger: parseU32(fields[3]!, "charge_authorized.current_ledger"),
          nextValidLedger: parseU32(fields[4]!, "charge_authorized.next_valid_ledger"),
        };
      }
      case "mandate_revoked": {
        return {
          ...common,
          type: "mandate_revoked",
          mandateId,
          revoker: parseAddress(event.value, "mandate_revoked.revoker"),
        };
      }
      case "mandate_expired": {
        return {
          ...common,
          type: "mandate_expired",
          mandateId,
          expiryLedger: parseU32(event.value, "mandate_expired.expiry_ledger"),
        };
      }
      case "mandate_registered": {
        return { ...common, type: "mandate_registered", mandateId };
      }
      default:
        return null;
    }
  } catch {
    // A malformed event must not take the ingest loop down; it is skipped
    // and the page is still committed.
    return null;
  }
}

function dataVec(value: xdr.ScVal): xdr.ScVal[] | null {
  if (value.switch().name !== "scvVec") {
    return null;
  }
  return value.vec() ?? null;
}

function eventIndexFromId(id: string): number {
  // Event ids look like "<ledger>-<txIndex>-<eventIndex>".
  const parts = id.split("-");
  const last = parts[parts.length - 1];
  const parsed = last === undefined ? NaN : Number(last);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
