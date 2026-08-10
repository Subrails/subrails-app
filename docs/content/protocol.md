---
title: Protocol mechanics
description: The full lifecycle of a Subrails mandate and the exact order in which the policy contract enforces its rules.
section: protocol
eyebrow: Protocol
---

# Protocol mechanics

A mandate is a standing authorization with hard limits, and those limits are enforced inside the authorization itself. This page walks the full lifecycle and the exact rule order the policy contract applies to every charge.

## The mandate

A mandate is a record stored by the `mandate-policy` contract. It grants `merchant` the right to pull `token` out of `account`, up to a fixed cap per charge, no more often than one charge per interval, until an expiry.

| Field | Type | Meaning |
| --- | --- | --- |
| `mandate_id` | `u64` | Unique id, assigned monotonically starting at 1. |
| `account` | `Address` | The subscriber. Normally a subrails-account contract, but any address can be charged. |
| `merchant` | `Address` | The only party allowed to charge. |
| `token` | `Address` | The token contract the charges are denominated in. |
| `max_amount` | `i128` | Maximum authorized per charge, in token base units. |
| `interval_ledgers` | `u32` | Minimum number of ledgers between charges. Ledgers close roughly every 5 seconds on the public networks. |
| `next_valid_ledger` | `u32` | Earliest ledger at which the next charge may be authorized. Advanced on every successful charge. |
| `expiry_ledger` | `u32` | The ledger after which no charge is allowed. |
| `status` | `MandateStatus` | <span class="pill pill-accent">Active</span>, <span class="pill">Revoked</span>, or <span class="pill">Expired</span>. Only Active mandates authorize charges. |

## Creation

The subscriber calls `create_mandate` with the merchant, the token, the cap, the interval, and the expiry. The contract requires the `account` to authorize: for a subrails-account that means the owner signs with their wallet, through the account's `__check_auth`.

Creation validates, in order:

1. The account authorizes the call.
2. `max_amount` is positive.
3. `interval_ledgers` is positive.
4. `expiry_ledger` is after the current ledger.
5. No mandate already exists for the same `(account, merchant, token)` triple. Exactly one mandate per triple is allowed, so the delegated charge lookup stays unambiguous.

The first charge is valid immediately: `next_valid_ledger` starts at the creation ledger. The contract emits `mandate_created` and returns the new id.

## The charge flow

When a charge is due, the merchant submits a token `transfer` from the subscriber's account to themselves. Authorization is not an inline signature. The account contract recognizes a transfer context with the policy contract attached as a delegated signer, and hands the authorization to the policy. The policy resolves the mandate from the transfer context: delegation does not carry a mandate id, so the policy looks the mandate up by the unique `(account, merchant, token)` triple. A transfer that maps to no mandate fails with `Unauthorized`.

Inside `check_charge`, the policy verifies every rule in this exact order, first failure wins:

| # | Rule | On failure |
| --- | --- | --- |
| 1 | The mandate exists. | `MandateNotFound` <span class="pill pill-flag">1</span> |
| 2 | The mandate is Active. | `NotActive` (revoked) <span class="pill pill-flag">2</span> or `Expired` <span class="pill pill-flag">3</span> |
| 3 | The current ledger is before `expiry_ledger`. | The mandate flips to Expired, `mandate_expired` is emitted, and the charge fails with `Expired` <span class="pill pill-flag">3</span> |
| 4 | The current ledger is at or after `next_valid_ledger`. | `TooEarly` <span class="pill pill-flag">4</span> |
| 5 | The transfer token matches the mandate token. | `WrongToken` <span class="pill pill-flag">7</span> |
| 6 | The transfer payee matches the mandate merchant. | `WrongMerchant` <span class="pill pill-flag">6</span> |
| 7 | The amount is positive. | `InvalidAmount` <span class="pill pill-flag">9</span> |
| 8 | The amount does not exceed `max_amount`. | `AmountTooHigh` <span class="pill pill-flag">5</span> |

Every rule passing, the policy advances `next_valid_ledger` to the current ledger plus the interval, persists the update, emits `charge_authorized`, and the transfer settles. The whole charge is one transaction: if any rule fails, the transfer never happens.

> [!note] Before anything is submitted
>
> The SDK re-simulates the prepared transaction in enforce mode before signing and submitting, so a rule violation (too early, over the cap, expired) surfaces as a typed error client-side and no fee is paid for a charge that would be rejected. On-chain, the same checks run inside `__check_auth` and would reject the transaction anyway.

## Revocation

`revoke_mandate` flips the mandate to Revoked and emits `mandate_revoked`. From that ledger on, every charge attempt fails the status check. Revocation is a contract state change, enforced by the network, not a promise by the merchant to stop charging.

> [!warn] Who can revoke
>
> The contract requires the mandate's `account` to authorize revocation. The original design called for either the account or the merchant to revoke; Protocol 27 exposes no way for a contract to probe which address authorized a call, so that check cannot be expressed in one function. Requiring the account keeps the primary flow intact: the subscriber can always revoke, immediately, with their own wallet. A merchant-initiated revocation therefore always happens through the subscriber's explicit consent. This is a deliberate, documented deviation from the original spec.

Revocation also removes the `(account, merchant, token)` lookup entry, so a fresh mandate can be created for the same pair afterward.

## Expiry

Expiry needs no transaction of its own. The first time a charge attempt sees the current ledger at or past `expiry_ledger`, the policy flips the mandate to Expired, emits `mandate_expired`, and rejects the charge. A charge can simply never be authorized after the expiry ledger.

## The economic model

Subrails enforces a **fixed cap per charge**: the merchant may pull up to `max_amount` of the mandate token, and no more, ever. There is no percentage of a balance, no dynamic limit, and nothing that scales with time or usage. The cadence is a minimum interval in ledgers, not a calendar schedule, so a merchant can always charge at most once per interval and exactly at or after the next valid ledger. The mandate has a definite end.

There is no live transaction volume to cite yet: the protocol is new and testnet-only. The mechanism above is the guarantee, independent of scale.

## Why the rules cannot be bypassed

The enforcement routine `check_charge` is deliberately not a public contract entry point. The only path into it is `__check_auth` during a real authorization check on the subscriber's account. Nobody can call it directly to advance `next_valid_ledger` or otherwise shape the state without an actual transfer. An account with a registered mandate still requires the owner's signature for every authorization that is not a covered transfer, so nothing else on the account moves without the subscriber.

The registry and the indexer are read aids, not enforcement: the registry records which mandates exist for which parties, and the indexer keeps charge history for display. Neither one can authorize a charge. See the [contract reference](/contracts) for the full function and error listings.

``` title="the enforcement routine, from policy.rs" lang=rust
match mandate.status {
    MandateStatus::Active => {}
    MandateStatus::Revoked => return Err(Error::NotActive),
    MandateStatus::Expired => return Err(Error::Expired),
}

let current = env.ledger().sequence();

if current >= mandate.expiry_ledger {
    mandate.status = MandateStatus::Expired;
    // persist, extend TTL, emit mandate_expired
    return Err(Error::Expired);
}
if current < mandate.next_valid_ledger {
    return Err(Error::TooEarly);
}
if token != mandate.token {
    return Err(Error::WrongToken);
}
if merchant != mandate.merchant {
    return Err(Error::WrongMerchant);
}
if amount <= 0 {
    return Err(Error::InvalidAmount);
}
if amount > mandate.max_amount {
    return Err(Error::AmountTooHigh);
}

mandate.next_valid_ledger = current.checked_add(mandate.interval_ledgers)
    .ok_or(Error::Overflow)?;
// persist, extend TTL, emit charge_authorized
Ok(())
```
