---
title: Setup and environment
description: Repository layout, local setup pointers, and the full environment variable reference.
section: developers
eyebrow: Developer guide
---

# Setup and environment

How to run the pieces locally and what every environment variable means. The quick start stays in the repository README; this page is the reference behind it.

## Repository layout

The application layer is a pnpm workspace: the SDK, the indexer, the reference web app, and this documentation site. The Soroban contracts live in the sibling `subrails-contract` repository.

``` title=workspace
subrails-app/
  packages/sdk/     # @subrails/sdk: typed contract clients and the CAP-71 charge path
  indexer/          # event indexer: polls Soroban RPC, writes Postgres, read-only API
  apps/web/         # reference frontend: landing page and the live demo
  docs/             # this site (standalone static site, zero dependencies)

subrails-contract/
  contracts/mandate-policy/
  contracts/subrails-account/
  contracts/mandate-registry/
```

## Local setup

Prerequisites are Node.js 22+ and pnpm (the workspace pins `pnpm@11.18.0`). Clone, install, build the SDK, and run the workspace checks by following the [Quick start in the README](https://github.com/Subrails/subrails-app#quick-start). The README also covers starting the indexer against Postgres and running the web app.

From the workspace root, the shared scripts run across every package:

``` title=workspace scripts
pnpm install
pnpm --filter @subrails/sdk build
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## Environment variables

The authoritative list lives in `.env.example` at the workspace root. The table below reproduces it, with which component reads each variable:

| Variable | Read by | Meaning |
| --- | --- | --- |
| `SUBRAILS_NETWORK` | SDK, indexer | `testnet` or `mainnet`. |
| `SUBRAILS_RPC_URL` | SDK, indexer | Soroban RPC endpoint. Defaults to the network's built-in endpoint when unset. |
| `SUBRAILS_NETWORK_PASSPHRASE` | SDK, indexer | Stellar network passphrase. Defaults to the network's built-in value when unset. |
| `SUBRAILS_PROTOCOL27` | SDK | `true` enables CAP-71 delegated credentials (Protocol 27). Testnet defaults to true; mainnet to false. |
| `MANDATE_POLICY_ID` | SDK, indexer | The mandate-policy contract id. The indexer needs it to filter events. |
| `SUBRAILS_ACCOUNT_WASM_HASH` | SDK | The installed subrails-account wasm hash, used to deploy new smart accounts. |
| `MANDATE_REGISTRY_ID` | SDK, indexer | The mandate-registry contract id. Kept for forward compatibility until the registry events are consumed. |
| `DATABASE_URL` | Indexer | Postgres connection string. The only required indexer variable. |
| `INDEXER_START_LEDGER` | Indexer | Ledger to begin ingesting from. Blank starts at the current ledger on first run. |
| `INDEXER_API_PORT` | Indexer | Port for the read API. Default 8080. |
| `NEXT_PUBLIC_SUBRAILS_NETWORK` | Web app | Network shown by the frontend, inlined at build time. |
| `NEXT_PUBLIC_SUBRAILS_RPC_URL` | Web app | Optional override for the RPC endpoint the frontend talks to. |
| `NEXT_PUBLIC_MANDATE_POLICY_ID` | Web app | mandate-policy contract id, inlined at build time. |
| `NEXT_PUBLIC_MANDATE_REGISTRY_ID` | Web app | mandate-registry contract id, inlined at build time. |
| `NEXT_PUBLIC_SUBRAILS_ACCOUNT_WASM_HASH` | Web app | subrails-account wasm hash, used to deploy smart accounts from the demo. |
| `NEXT_PUBLIC_INDEXER_API_URL` | Web app | Base URL of the indexer read API the demo reads from. |

> [!note] Where the frontend reads its config
>
> Next.js reads `.env.local` from the app directory, so the frontend keeps its own copy at `apps/web/.env.local` with the `NEXT_PUBLIC_` values filled in (the README shows the copy command). The SDK and the indexer read the workspace-root `.env`.

## Deployed testnet values

These are the current testnet deployments, used by the live demo:

| Artifact | Value |
| --- | --- |
| `mandate-policy` contract id | `CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ` |
| `subrails-account` reference instance | `CAP6XKRZTYYYOOFIE5X4MVHY6OOJZCTMYFFV2MCCYGLBMFBUS2FBNT4E` |
| `mandate-registry` contract id | `CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O` |
| `subrails-account` wasm hash (for deploying new accounts) | `12d8e61efa33b3d051d04e012c1d24b26f68a16f984faca41e68c6686eab0c71` |

## Live services

| Service | URL |
| --- | --- |
| Web app (landing and demo) | `https://subrails-web-three.vercel.app` |
| Indexer read API | `https://subrails-indexer.onrender.com` |

The indexer runs on a free hosting tier and spins down after inactivity; the first request after idle can take 30 to 50 seconds to respond. See the [indexer API reference](/developers/indexer) for the endpoints.
