---
title: Contracts
description: The three Subrails Soroban contracts, their roles, and the deployed testnet ids.
section: contracts
eyebrow: Smart contract reference
---

# The contracts

Three Soroban contracts implement the protocol, in dependency order: the policy that holds and enforces the rules, the smart account that delegates to it, and a registry that indexes mandates for lookup. Their source lives in the sibling `subrails-contract` repository.

| Contract | Role | Detail page |
| --- | --- | --- |
| `mandate-policy` | The core. Stores mandates (cap, interval, expiry) and enforces every rule inside `__check_auth` as a delegated signer on every charge. | [reference](/contracts/mandate-policy) |
| `subrails-account` | A custom smart account, one per subscriber. Routes authorization to the owner's ed25519 signature, or, for a registered mandate, to the policy contract. | [reference](/contracts/subrails-account) |
| `mandate-registry` | A thin lookup index: which mandates exist for an account or a merchant. Admin-maintained; heavy history stays off-chain in the indexer. | [reference](/contracts/mandate-registry) |

## Deployed on testnet

These are the contract ids backing the live demo, deployed and verified on Stellar testnet:

| Contract | Contract id |
| --- | --- |
| `mandate-policy` | `CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ` |
| `subrails-account` (reference instance) | `CAP6XKRZTYYYOOFIE5X4MVHY6OOJZCTMYFFV2MCCYGLBMFBUS2FBNT4E` |
| `mandate-registry` | `CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O` |

Each subscriber deploys their own subrails-account instance from the installed wasm; the id above is one reference deployment. The wasm hash and the contract configuration are listed on the [setup and environment](/developers) page.

## Error codes

Every contract defines its errors as a `#[contracterror]` enum with explicit discriminant values. Codes are per-contract, so the same number means different things on different contracts. The mandate-policy enum has grown beyond the original design: the duplicate-pair guard and checked-arithmetic overflow were added during implementation, so it carries 14 codes while the account and the registry each carry 3.

## Events

Every state change emits exactly one event. Topics carry the event name plus identifiers; the data payload carries addresses, amounts, and ledger numbers. The indexer decodes five of them into its database. The full per-contract event tables are on each detail page.

| Event | Contract | Meaning |
| --- | --- | --- |
| `mandate_created` | mandate-policy | A mandate was created and is Active. |
| `charge_authorized` | mandate-policy | A charge passed every rule and was authorized. |
| `mandate_revoked` | mandate-policy | An Active mandate was revoked. |
| `mandate_expired` | mandate-policy | A charge attempt found the mandate past its expiry; it is now Expired. |
| `account_initialized` | subrails-account | The account was set up with its owner and policy. |
| `mandate_registered` | subrails-account | A mandate id was registered on the account. |
| `registry_initialized` | mandate-registry | The registry was set up with its admin and policy. |
| `mandate_indexed` | mandate-registry | A mandate id was indexed for an account and a merchant. |
