---
title: Indexer API
description: The indexer's read-only HTTP API: endpoints, request parameters, and response shapes.
section: developers
eyebrow: Developer guide
---

# Indexer API

The indexer watches the mandate-policy contract on Stellar, decodes its events into Postgres, and serves a read-only HTTP API over the result. It never signs or submits transactions.

## How it works

On a poll (every 5 seconds by default), the indexer calls Soroban RPC `getEvents` filtered to the configured `MANDATE_POLICY_ID`, decodes five events (`mandate_created`, `charge_authorized`, `mandate_revoked`, `mandate_expired`, `mandate_registered`), and applies them with idempotent upserts:

- `mandates`: one row per mandate, tracking status, cap, cadence, and expiry. Upserted from the state events.
- `charges`: every authorized charge, keyed by `(tx_hash, event_index)` so re-ingesting a ledger range can never duplicate a row.
- `indexer_state`: the last fully ingested ledger, so a restart resumes from the ledger after it.

The write path is one-way: the API layer only reads the database. If you want the chain as the source of truth, call the policy contract directly with the SDK; the indexer exists so the demo and other consumers do not have to scan history themselves.

## Base URLs

| Environment | Base URL |
| --- | --- |
| Live (testnet) | `https://subrails-indexer.onrender.com` |
| Local | `http://localhost:8080` (default `INDEXER_API_PORT`) |

> [!warn] Cold starts
>
> The live indexer runs on a free hosting tier that spins down after about 15 minutes of inactivity. The first request after idle can take 30 to 50 seconds while it wakes up and re-ingests. Budget for it in health checks and clients.

## GET /health

Liveness check. Returns `200` with a fixed body:

``` title=GET /health
curl -s https://subrails-indexer.onrender.com/health

{
  "ok": true,
  "service": "subrails-indexer"
}
```

## GET /mandates

Lists mandates for one party. Exactly one of `account` or `merchant` is required:

``` title=requests
# all mandates where the given address is the subscriber account
curl -s "https://subrails-indexer.onrender.com/mandates?account=G7QF...3JHM"

# all mandates where the given address is the merchant
curl -s "https://subrails-indexer.onrender.com/mandates?merchant=GBRK...9WPA"
```

A request with both parameters, or neither, returns `400` with `{ "error": ... }`.

``` title=200 response
{
  "mandates": [
    {
      "mandateId": "1",
      "account": "C...",
      "merchant": "G7QF...3JHM",
      "token": "C...",
      "maxAmount": "10000000",
      "intervalLedgers": 1000,
      "nextValidLedger": "58123456",
      "expiryLedger": "58623456",
      "status": "Active",
      "createdLedger": "58122456",
      "updatedLedger": "58123456"
    }
  ]
}
```

## GET /mandates/:id

One mandate with its charge history. The id is the numeric mandate id:

``` title=request
curl -s "https://subrails-indexer.onrender.com/mandates/1"
```

``` title=200 response
{
  "mandate": {
    "mandateId": "1",
    "account": "C...",
    "merchant": "G7QF...3JHM",
    "token": "C...",
    "maxAmount": "10000000",
    "intervalLedgers": 1000,
    "nextValidLedger": "58623456",
    "expiryLedger": "58623456",
    "status": "Active",
    "createdLedger": "58122456",
    "updatedLedger": "58123456"
  },
  "charges": [
    {
      "txHash": "a3f09c...",
      "eventIndex": 0,
      "mandateId": "1",
      "merchant": "G7QF...3JHM",
      "token": "C...",
      "amount": "10000000",
      "ledger": 58123456,
      "nextValidLedger": "58623456"
    }
  ]
}
```

Errors: `400` when the id is not an integer, `404` when the mandate does not exist, `500` on internal failures, all with an `{ "error": ... }` body.

## Field reference

Amounts and ledger numbers are sent as **decimal strings**: token amounts are `i128` and ledgers are 64-bit, neither of which is safe as a JSON number. Parse them with `BigInt()` where you need arithmetic.

| Field | Type | Meaning |
| --- | --- | --- |
| `mandateId` | `string` | Mandate id, as a decimal string. |
| `account`, `merchant`, `token` | `string` | Addresses from the mandate. |
| `maxAmount` | `string` | Maximum per charge, token base units, decimal string. |
| `intervalLedgers` | `number` | Minimum ledgers between charges. |
| `nextValidLedger` | `string` | Earliest ledger at which the next charge may authorize. |
| `expiryLedger` | `string` | Ledger after which no charge is allowed. |
| `status` | `string` | `Active`, `Revoked`, or `Expired`. |
| `createdLedger`, `updatedLedger` | `string` | Ledger of the creating event and of the most recent state change. |
| `txHash` (charges) | `string` | Hash of the charge transaction. |
| `eventIndex` (charges) | `number` | Position of the event inside the transaction. |
| `amount` (charges) | `string` | Charged amount, token base units, decimal string. |
| `ledger` (charges) | `number` | Ledger the charge was applied in. |
| `nextValidLedger` (charges) | `string \| null` | Next valid ledger after this charge, when recorded. |

## Event coverage

Five events decode into the database. `mandate_registered` changes no mandate-level state (there is no per-account table), so it is logged for observability and skipped:

| Event | Effect |
| --- | --- |
| `mandate_created` | Upserts the mandate row as Active. |
| `charge_authorized` | Advances `next_valid_ledger` and inserts the charge row. |
| `mandate_revoked` | Marks the mandate Revoked. |
| `mandate_expired` | Marks the mandate Expired. |
| `mandate_registered` | Logged only. |

The filter watches the contract configured as `MANDATE_POLICY_ID` (currently `CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ` on testnet). Events from failed calls, and any event the decoder does not recognize, are skipped; the ingest cursor still advances so a range of undecodable events cannot stall it.
