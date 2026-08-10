---
title: Merchant guide
description: How to check a mandate before charging, submit a charge, and understand why a charge fails.
section: guides
eyebrow: Guide for merchants
---

# You are the merchant

This guide is for the business collecting the payments. It describes, in plain language, how to check that a mandate is worth relying on, how to submit a charge, and what happens when a charge fails a rule.

## The deal you are charging against

A subscriber creates a mandate in your favor: you may pull up to a fixed cap per charge, at most once per interval, until an expiry. You submit charges as token transfers out of their smart account. You never need their signature, and you never hold their keys. The limits are set by them and enforced by the contract; you cannot charge outside them even if you try.

## Check the mandate before relying on it

Before you build anything on a subscriber's authorization, look it up through the indexer read API (or the demo board) and confirm:

- **It exists and is Active.** A revoked or expired mandate rejects every charge.
- **The token matches the one you plan to charge in.** A charge in any other token fails.
- **The expiry is ahead of the current ledger.** If the mandate has already passed its expiry, nothing you submit will authorize.
- **When the next charge is valid.** The mandate carries a `nextValidLedger`; a charge before it fails with a "too early" rejection. The first charge is valid immediately after creation.
- **Your address is the merchant on the mandate.** Only the listed merchant can charge.

Even if you skip these checks, the contract still enforces every one of them at charge time. Checking first just saves you a rejected transaction and lets you plan your billing cadence.

## Submitting a charge

In the demo, the merchant panel submits a charge by entering an amount. The amount must be positive and at or below the mandate cap, and the current ledger must be at or after the next valid ledger. Your wallet signs the transaction (you are the one moving funds in), and the protocol handles the rest.

## When a charge fails

A charge fails if any rule fails, and the whole transaction is rejected: the subscriber's account is not touched, and no partial charge lands. The rejection names the rule:

- **Too early:** the interval has not elapsed since the last charge (or the previous one is still pending). Wait for the next valid ledger.
- **Over the cap:** the amount exceeds the mandate's maximum. Charge at or below it, or ask the subscriber for a new mandate.
- **Expired or revoked:** the mandate is no longer Active. Do not keep retrying; the mandate is over.
- **Wrong token or wrong merchant:** the transfer does not match the mandate. Double-check the token contract id and the account you are charging from.

The SDK checks these rules in a pre-submit simulation, so a charge that would be rejected surfaces its reason before any fee is paid. On-chain, the same checks run inside the authorization and reject the transaction.

## Cadence and history

The interval is measured in ledgers (roughly 5 seconds each on the public networks), not calendar days. A successful charge advances the next valid ledger by the interval, and the indexer records the charge with its ledger and the new next valid ledger, so you can reconstruct exactly when each next charge becomes valid.

Charge history per mandate is available from the indexer read API, and the demo board shows it for the current account.

> [!warn] Revocation is theirs to make
>
> The subscriber can revoke at any time, and revocation takes effect on the ledger immediately. When it happens, your future charges stop authorizing: the status changes to Revoked, and every further attempt is rejected. Build your collection logic to treat a revoked or expired mandate as a lapsed agreement, not as something to retry. The contract, not the subscriber's word or yours, decides whether a charge authorizes.

## Before you rely on this for real money

- Everything here is testnet-only and not audited. No real funds.
- The guarantee is the cap, the interval, and the expiry, all enforced per charge. Do not assume behavior beyond those terms: in particular, there is no per-charge price negotiation, no refund mechanism, and no off-chain settlement logic in the protocol.
