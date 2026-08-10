---
title: Introduction
description: What Subrails is, the problem it solves, and how it works at a high level.
section: overview
eyebrow: Subrails documentation
---

# Recurring authorization on Stellar

Crypto has no direct debit. Subrails is the missing rail: a protocol where a subscriber authorizes a merchant once, on chain, with hard limits, and the merchant pulls each payment when it is due. The limits are enforced by the network on every pull, not promised by anyone.

> [!security] Read this first
>
> Subrails is **not audited** and runs on **Stellar testnet only**. Nothing here should be used on mainnet with real funds until an independent audit has been completed and published. Every charge in the live demo moves testnet tokens, not money.

## The problem, in plain terms

A subscription needs to move a fixed amount from a customer to a business at a regular cadence, with a clear endpoint. On-chain, there is no direct-debit equivalent. The options today all ask you to trade away something:

- **Sign every payment by hand.** You are present for every charge, forever. A subscription with that friction does not feel like a subscription.
- **Leave an open token allowance.** You approve a spender once and trust them to take no more than agreed. There is nothing stopping them from taking more, and nothing stops a compromised key from doing the same.
- **Hand custody of keys to a third party.** A custodian holds your keys and honors your cancellation because you asked. Cancellation becomes a promise, not a guarantee.

Subrails replaces all three with a single on-chain authorization that carries its own limits. The rules are data on the ledger, checked by a smart contract on every charge attempt.

## What Subrails is

A subscriber deploys a smart account (a contract, not a keypair, controlled by their wallet) and creates a **mandate**: a standing authorization naming one merchant, one token, a maximum amount per charge, a minimum interval between charges, and an expiry. The mandate is stored by the `mandate-policy` contract.

When the merchant charges, they submit a token transfer out of the subscriber's account. The account delegates the authorization decision to the policy contract, which re-checks every limit inside the authorization itself: the mandate must exist and be active, the ledger must be before expiry, the interval must have elapsed, the token and merchant must match, and the amount must not exceed the cap. Any failure rejects the whole transaction. On success the transfer settles and the account advances the next valid ledger.

Revocation works the same way: it is a contract state change, so it takes effect immediately and there is no window in which a cancelled mandate keeps drawing funds. Expiry is automatic once the ledger passes the expiry ledger.

## Built on Protocol 27

The mechanism that makes this possible is Stellar Protocol 27 (CAP-71) delegated signer authorization. The smart account lists the policy contract as a delegated signer in its authorization entry, and the host forwards the transfer context to the policy during `__check_auth`. The subscriber's key never leaves their wallet, and the merchant never needs the subscriber to sign a charge.

## The pieces

The protocol is open and split across two repositories. The application layer in this repository:

- **Contracts** (in the sibling `subrails-contract` repository): `mandate-policy` (the rules), `subrails-account` (the subscriber's smart account), and `mandate-registry` (a lookup index by account or merchant). See the [smart contract reference](/contracts).
- **SDK**: `@subrails/sdk`, a typed TypeScript client for all three contracts plus the CAP-71 delegated charge path. See the [SDK reference](/developers/sdk).
- **Indexer**: polls Soroban RPC for contract events and serves a read-only API over the decoded state. See the [indexer API reference](/developers/indexer).
- **Reference app**: a working demo of the whole flow, from deploying a smart account to revoking a mandate.

## Try it live

The demo at the link below runs on the deployed testnet contracts. It walks the full flow: deploy a smart account, fund it with testnet tokens, create a mandate, charge against it, and revoke it.

[Open the live demo](https://subrails-web-three.vercel.app/demo)

The demo reads mandate state and charge history from the live indexer read API at `https://subrails-indexer.onrender.com`. The indexer runs on a free hosting tier and can take 30 to 50 seconds to wake up after a period of inactivity; the first request after idle is the slow one.

## Deployed on testnet

The contracts backing the live demo are deployed and verified on Stellar testnet:

| Contract | Contract id |
| --- | --- |
| `mandate-policy` | `CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ` |
| `mandate-registry` | `CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O` |

The full list, including the subrails-account wasm hash used to deploy new per-subscriber accounts, is on the [setup and environment](/developers) page.

## From zero to a charge

The repository README is the quick start: clone, install, build, and run the pieces locally. This site is the reference that goes deeper. If you are here to write code, start with the [SDK reference](/developers/sdk).

``` title=workspace layout
subrails-app/
  packages/sdk/     # @subrails/sdk: typed contract clients and the charge path
  indexer/          # event indexer with a read-only HTTP API
  apps/web/         # reference frontend (landing page + live demo)
  docs/             # this site

subrails-contract/  # sibling repo: the Soroban contracts
  contracts/mandate-policy/      # the authorization rules
  contracts/subrails-account/    # the subscriber smart account
  contracts/mandate-registry/    # lookup index by account or merchant
```
