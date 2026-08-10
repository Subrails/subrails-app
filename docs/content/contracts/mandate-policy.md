---
title: mandate-policy
description: Full reference for the mandate-policy contract: functions, error codes, and events.
section: contracts
eyebrow: Smart contract reference
---

# mandate-policy

The core contract. It stores each mandate and enforces the cap, the interval, and the expiry inside `__check_auth` as a Protocol 27 delegated signer, so the rules are re-checked by the network on every charge. Deployed on testnet at `CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ`.

## Public functions

### create_mandate

Creates an Active mandate authorizing `merchant` to charge `account` for `token`.

``` title=signature lang=rust
pub fn create_mandate(
    env: Env,
    account: Address,
    merchant: Address,
    token: Address,
    max_amount: i128,
    interval_ledgers: u32,
    expiry_ledger: u32,
) -> Result<u64, Error>
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `account` | `Address` | The account being charged, typically a subrails-account. |
| `merchant` | `Address` | The only party authorized to charge. |
| `token` | `Address` | The token the charges are denominated in. |
| `max_amount` | `i128` | Maximum per charge, in token base units. Must be positive. |
| `interval_ledgers` | `u32` | Minimum ledgers between charges. Must be positive. |
| `expiry_ledger` | `u32` | Ledger after which no charge is allowed. Must be after the current ledger. |

**Returns:** the new `mandate_id`, starting at 1 and increasing monotonically.

**Auth:** <span class="pill pill-accent">account</span> must authorize. For a subrails-account this runs its `__check_auth`, which means the owner's ed25519 signature.

**Errors:** `InvalidAmount`, `InvalidInterval`, `InvalidExpiry`, `DuplicateMandate`, `Overflow`.

**Emits:** `mandate_created`.

### revoke_mandate

Revokes an Active mandate. Takes effect immediately: no further charge authorizes.

``` title=signature lang=rust
pub fn revoke_mandate(env: Env, mandate_id: u64) -> Result<(), Error>
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `mandate_id` | `u64` | The id returned by `create_mandate`. |

**Returns:** `Ok(())`.

**Auth:** <span class="pill pill-accent">mandate.account</span> must authorize (the subscriber). See the deviation note below: the original design allowed either party to revoke, but the contract requires the account.

**Errors:** `MandateNotFound`, `AlreadyResolved` (not Active).

**Emits:** `mandate_revoked`, and removes the `(account, merchant, token)` lookup entry so the pair can be re-authorized later.

### get_mandate

Reads a mandate back. A pure view, no auth, no events.

``` title=signature lang=rust
pub fn get_mandate(env: Env, mandate_id: u64) -> Result<Mandate, Error>
```

**Returns:** the full `Mandate` record (see the struct below).

**Auth:** none.

**Errors:** `MandateNotFound` if no mandate has that id.

## The Mandate record

The struct returned by `get_mandate` and stored at creation:

``` title=struct lang=rust
pub struct Mandate {
    pub mandate_id: u64,
    pub account: Address,
    pub merchant: Address,
    pub token: Address,
    pub max_amount: i128,
    pub interval_ledgers: u32,
    pub next_valid_ledger: u32,
    pub expiry_ledger: u32,
    pub status: MandateStatus,   // Active | Revoked | Expired
}
```

The field-by-field meaning is on the [protocol mechanics](/protocol#the-mandate) page. Only `Active` mandates authorize charges.

## The delegated entry point: __check_auth

The policy also implements the Protocol 27 `CustomAccountInterface`. The host invokes `__check_auth` during `require_auth` on a subscriber's account whenever the account's authorization entry lists this contract as a delegated signer:

``` title=signature lang=rust
fn __check_auth(
    env: Env,
    _signature_payload: Hash<32>,
    _signature: (),
    auth_contexts: Vec<Context>,
) -> Result<(), Error>
```

It receives the same authorization context as the account, scans for token `transfer` contexts, resolves each transfer's mandate through the `(account, merchant, token)` index, and runs `check_charge` against it. The `signature` argument is intentionally not verified: the enforcement is the mandate rules themselves, and the host guarantees this function only runs inside a real authorization check. A delegation with no transfer context to enforce is rejected with `Unauthorized` rather than silently approved.

`check_charge` itself is not a public entry point. Keeping it internal prevents anyone from advancing `next_valid_ledger` without an actual transfer, which would otherwise be a griefing vector against a merchant's future charges.

## Error codes

All values are from the contract's `Error` enum, reproduced in order:

| Code | Variant | Meaning |
| --- | --- | --- |
| <span class="pill pill-flag">1</span> | `MandateNotFound` | No mandate exists with the given id. |
| <span class="pill pill-flag">2</span> | `NotActive` | The mandate is not Active (it is revoked). |
| <span class="pill pill-flag">3</span> | `Expired` | The mandate has reached its expiry ledger. |
| <span class="pill pill-flag">4</span> | `TooEarly` | The current ledger is before `next_valid_ledger`. |
| <span class="pill pill-flag">5</span> | `AmountTooHigh` | The charge exceeds `max_amount`. |
| <span class="pill pill-flag">6</span> | `WrongMerchant` | The charging party is not the mandate merchant. |
| <span class="pill pill-flag">7</span> | `WrongToken` | The token does not match the mandate token. |
| <span class="pill pill-flag">8</span> | `Unauthorized` | Authorization failed: no matching mandate for the transfer, or nothing to enforce. |
| <span class="pill pill-flag">9</span> | `InvalidAmount` | The amount or `max_amount` is not positive. |
| <span class="pill pill-flag">10</span> | `InvalidInterval` | The interval is zero. |
| <span class="pill pill-flag">11</span> | `InvalidExpiry` | The expiry ledger is not in the future. |
| <span class="pill pill-flag">12</span> | `AlreadyResolved` | The mandate is already revoked or expired. |
| <span class="pill pill-flag">13</span> | `DuplicateMandate` | A mandate already exists for this account, merchant, and token. Added during implementation. |
| <span class="pill pill-flag">14</span> | `Overflow` | Checked arithmetic overflowed (id counter or `next_valid_ledger`). Added during implementation. |

## Events

Every state change emits exactly one event. Consumers should rely on the event name in topic position 0.

| Event | Topics | Data |
| --- | --- | --- |
| `mandate_created` | `("mandate_created", mandate_id)` | `(account, merchant, token, max_amount, interval_ledgers, expiry_ledger)` |
| `charge_authorized` | `("charge_authorized", mandate_id)` | `(merchant, token, amount, current_ledger, next_valid_ledger)` |
| `mandate_revoked` | `("mandate_revoked", mandate_id)` | `(revoker)` |
| `mandate_expired` | `("mandate_expired", mandate_id)` | `(expiry_ledger)` |

## Where the implementation deviates from the original design

> [!note] Changes that landed during the build
>
> **Duplicate-pair guard:** exactly one mandate per `(account, merchant, token)` triple, enforced at creation with `DuplicateMandate`. This keeps the delegated charge lookup unambiguous, since CAP-71 delegation carries no mandate id.
>
> **Overflow handling:** the id counter and the `next_valid_ledger` advancement use checked arithmetic and fail with `Overflow`.
>
> **Revocation is account-only:** the account must authorize `revoke_mandate`; a merchant cannot revoke on their own (Protocol 27 cannot express an either-party check in one function).
