---
title: mandate-registry
description: Full reference for the mandate-registry contract: functions, error codes, and events.
section: contracts
eyebrow: Smart contract reference
---

# mandate-registry

A thin lookup layer over mandates created in the mandate-policy contract. It maintains per-subscriber and per-merchant lists of mandate ids so the app layer can enumerate a party's mandates without scanning the chain. Heavy history stays off-chain in the indexer. Deployed on testnet at `CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O`.

## Public functions

### initialize

One-time setup: records the admin and the policy contract this registry serves.

``` title=signature lang=rust
pub fn initialize(env: Env, admin: Address, policy_contract: Address) -> Result<(), Error>
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `admin` | `Address` | The address authorized to index mandates. |
| `policy_contract` | `Address` | The mandate-policy contract this registry serves, recorded for off-chain discovery. |

**Returns:** `Ok(())`.

**Auth:** none; the one-time `Initialized` flag is the guard.

**Errors:** `AlreadyInitialized`.

**Emits:** `registry_initialized`.

### index_mandate

Appends a mandate id to the account's and the merchant's index lists.

``` title=signature lang=rust
pub fn index_mandate(
    env: Env,
    mandate_id: u64,
    account: Address,
    merchant: Address,
) -> Result<(), Error>
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `mandate_id` | `u64` | The id returned by the policy's `create_mandate`. |
| `account` | `Address` | The mandate's subscriber account. |
| `merchant` | `Address` | The mandate's merchant. |

**Returns:** `Ok(())`. Re-indexing an already-indexed id is a no-op success (idempotent, so lookups never duplicate).

**Auth:** <span class="pill pill-accent">admin</span> must authorize.

**Errors:** `NotInitialized` if the registry was never initialized.

**Emits:** `mandate_indexed` when a new id is recorded for either list.

### list_by_account

Lists the mandate ids indexed for an account, in insertion order. A pure view, no auth, no events.

``` title=signature lang=rust
pub fn list_by_account(env: Env, account: Address) -> Vec<u64>
```

**Returns:** the indexed mandate ids, or an empty list when there are none (including when the registry is uninitialized).

### list_by_merchant

Lists the mandate ids indexed for a merchant, in insertion order. A pure view, no auth, no events.

``` title=signature lang=rust
pub fn list_by_merchant(env: Env, merchant: Address) -> Vec<u64>
```

**Returns:** the indexed mandate ids, or an empty list when there are none.

## Error codes

| Code | Variant | Meaning |
| --- | --- | --- |
| <span class="pill pill-flag">1</span> | `AlreadyInitialized` | `initialize` was already called; the registry is set up once. |
| <span class="pill pill-flag">2</span> | `NotInitialized` | The registry has not been initialized. |
| <span class="pill pill-flag">3</span> | `Unauthorized` | The caller is not the admin. |

## Events

| Event | Topics | Data |
| --- | --- | --- |
| `registry_initialized` | `("registry_initialized",)` | `(admin, policy_contract)` |
| `mandate_indexed` | `("mandate_indexed", mandate_id)` | `(account, merchant)` |
