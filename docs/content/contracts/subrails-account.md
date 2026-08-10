---
title: subrails-account
description: Full reference for the subrails-account contract: functions, error codes, and events.
section: contracts
eyebrow: Smart contract reference
---

# subrails-account

A Protocol 27 custom smart account, one instance per subscriber. The owner (an ed25519 keypair, the subscriber's wallet) controls it. Recurring charges for a registered mandate are authorized without the owner's signature through delegation to the policy contract; every other operation requires the owner's signature.

## Public functions

### initialize

One-time setup: records the controlling owner and the policy contract.

``` title=signature lang=rust
pub fn initialize(
    env: Env,
    owner: BytesN<32>,
    policy_contract: Address,
) -> Result<(), Error>
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `owner` | `BytesN<32>` | The raw 32-byte ed25519 public key of the controlling signer. |
| `policy_contract` | `Address` | The mandate-policy contract that enforces recurring-charge rules for this account. |

**Returns:** `Ok(())`.

**Auth:** none. The guard is the one-time `Initialized` flag itself, so the first caller wins. Deployers must call `initialize` in the same transaction as deployment so a front-runner cannot claim the account with their own owner key; there is no re-initialization path.

**Errors:** `AlreadyInitialized`.

**Emits:** `account_initialized`.

### register_mandate

Registers a mandate id on the account so its charges can be delegated to the policy contract.

``` title=signature lang=rust
pub fn register_mandate(env: Env, mandate_id: u64) -> Result<(), Error>
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `mandate_id` | `u64` | The id returned by the policy's `create_mandate`. |

**Returns:** `Ok(())`. Re-registering an already-registered id is a no-op success (idempotent).

**Auth:** the account's own authorization, which routes through this contract's `__check_auth` and requires the owner's ed25519 signature.

**Errors:** `NotInitialized` if the account was never initialized.

**Emits:** `mandate_registered` when a new id is recorded.

## The routing entry point: __check_auth

The account implements the Protocol 27 `CustomAccountInterface` with `Signature = Option<BytesN<64>>`: an ed25519 signature when the owner signed the authorization, and `None` when a Void credential carries no signature.

``` title=signature lang=rust
fn __check_auth(
    env: Env,
    signature_payload: Hash<32>,
    signature: Option<BytesN<64>>,
    auth_contexts: Vec<Context>,
) -> Result<(), Error>
```

The routing, in order:

1. **Mandate charge path.** If the authorization includes a token `transfer` context and the registered policy contract is attached as a delegated signer, the account delegates the authorization to the policy, which enforces the mandate rules. No owner signature is required for this path.
2. **Owner path.** Every other authorization (a direct transfer without the policy delegate, any mixed authorization containing a non-transfer context, and all non-transfer operations) requires the owner's ed25519 signature over the signature payload. A missing signature is rejected with `Unauthorized`; an invalid signature fails through the host's crypto error.
3. **Unknown delegates.** Any delegated signer other than the registered policy contract is rejected with `Unauthorized` (fail-closed).
4. **Uninitialized account.** Any authorization on an account with no owner stored is rejected with `NotInitialized`.

## Error codes

| Code | Variant | Meaning |
| --- | --- | --- |
| <span class="pill pill-flag">1</span> | `AlreadyInitialized` | `initialize` was already called; the account is set up once. |
| <span class="pill pill-flag">2</span> | `NotInitialized` | The account has not been initialized. |
| <span class="pill pill-flag">3</span> | `Unauthorized` | Bad or missing owner signature, an unknown delegated signer, or an unauthorized caller. |

## Events

| Event | Topics | Data |
| --- | --- | --- |
| `account_initialized` | `("account_initialized",)` | `(owner, policy_contract)` |
| `mandate_registered` | `("mandate_registered", mandate_id)` | `()` |

> [!note] One account per subscriber
>
> The account contract id is not a workspace constant. Each subscriber deploys their own instance from the installed wasm (the wasm hash is listed on the [setup and environment](/developers) page), and the new id comes back from the deployment transaction. The SDK currently exposes deployment and initialization as two separate calls; deploying and initializing in the same transaction is a future enhancement once multi-operation Soroban transactions are uniformly supported by the RPC tooling the SDK builds on.
