<p align="center">
  <img src=".github/banner.svg" alt="Subrails" width="600">
</p>

# Subrails

Application layer: SDK, indexer, and reference app.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/Subrails/subrails-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Subrails/subrails-app/actions/workflows/ci.yml)

[Documentation](https://subrails-docs.vercel.app) | [Live demo](https://subrails-web-three.vercel.app/demo)

Recurring payments have no direct-debit equivalent on chain: a subscriber must
either sign every payment by hand, leave an open token allowance, or hand
custody of keys to a third party. Subrails fixes this with a delegated-signer
policy. A subscriber authorizes a merchant once, on chain, with hard limits: a
maximum amount per charge, a fixed interval, and an expiry. The merchant pulls
each payment when it is due, and the policy contract enforces every limit
inside a delegated signer's `__check_auth` on every pull, so no one can charge
more, charge early, or charge after the mandate ends.

The protocol is built on Stellar Protocol 27 (CAP-71) primitives using an
allowance-and-policy model. The Soroban contracts live in the sibling
`subrails-contract` repository; this repository is the application layer: a
TypeScript SDK, a Soroban event indexer with a read-only API, and a reference
Next.js frontend.

> **Security status:** this project is **not audited** and is deployed on
> **Stellar testnet only**. Do not use it on mainnet with real funds until an
> independent audit has been completed and published.

## Live deployments

| Component | URL | Notes |
| --- | --- | --- |
| Web app (landing) | https://subrails-web-three.vercel.app | Landing page at `/`, working demo at `/demo` |
| Indexer read API | https://subrails-indexer.onrender.com | Free tier: spins down after 15 minutes of inactivity. The first request after idle can take 30 to 50 seconds to respond |
| Database | Neon Postgres | Internal to the indexer, not publicly exposed |

The contracts backing the live demo are deployed on Stellar testnet; see
[Testnet deployment values](#testnet-deployment-values) below.

## Architecture

- `packages/sdk`: the TypeScript client (`@subrails/sdk`). Typed clients for
  the `mandate-policy`, `subrails-account`, and `mandate-registry` contracts,
  network configuration, and the CAP-71 delegated charge path (`charge` /
  `prepareChargeAuth`).
- `apps/web`: the reference frontend. A marketing landing page at `/` and a
  working demo at `/demo` that walks the full flow: deploy a smart account,
  create a mandate, charge against it, and revoke it. Reads come from the
  indexer; writes go through the SDK and the user's wallet.
- `indexer`: the event indexer. Polls Soroban RPC for contract events,
  stores them in Postgres, and serves a read-only HTTP API
  (`GET /health`, `GET /mandates`, `GET /mandates/:id`).
- `docs`: the documentation site. A standalone static site (Markdown
  content rendered by a zero-dependency Node script) covering protocol
  mechanics, contract reference, end-user guides, and developer reference.
  It deploys independently of the web app.

The contracts themselves form three layers in dependency order: `mandate-policy`
(the authorization rules), `subrails-account` (the smart account that delegates
to the policy), and `mandate-registry` (an index of mandates by party).
<!-- TODO: link to the subrails-contract repository once it is public. -->

## Quick start

Prerequisites: Node.js 22+ and pnpm (the workspace pins `pnpm@11.18.0`).

```sh
git clone https://github.com/Subrails/subrails-app.git
cd subrails-app
pnpm install
pnpm --filter @subrails/sdk build
```

The workspace scripts run across all packages:

```sh
pnpm typecheck   # tsc in every package
pnpm test        # node:test suites in the SDK and the indexer
pnpm lint        # eslint in every package
pnpm build       # build every package that has a build step
```

### Indexer

The indexer needs a Postgres database. Export the required environment
variables, then build and start it:

```sh
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/subrails
export MANDATE_POLICY_ID=CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ
export MANDATE_REGISTRY_ID=CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O
pnpm --filter indexer build
pnpm --filter indexer start
```

`DATABASE_URL` is the only required variable. The ingest filter matches
mandate-policy events, so export `MANDATE_POLICY_ID` for a live ingest;
`MANDATE_REGISTRY_ID` is exported for forward compatibility until the registry
events are consumed. The read API serves on port `8080` by default
(`INDEXER_API_PORT` to change). See `.env.example` at the workspace root for
the full list.

### Web app

The frontend reads its configuration from `apps/web/.env.local` at build time.
Next.js reads `.env.local` from the app directory, so the workspace-root
`.env.example` is copied there (the example's own header talks about a root
`.env`, which applies to the SDK and indexer instead). Fill in the
`NEXT_PUBLIC_` values, or use the deployed testnet values below:

```sh
cp .env.example apps/web/.env.local
# then set the NEXT_PUBLIC_ values, for example:
#   NEXT_PUBLIC_SUBRAILS_NETWORK=testnet
#   NEXT_PUBLIC_MANDATE_POLICY_ID=CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ
#   NEXT_PUBLIC_MANDATE_REGISTRY_ID=CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O
#   NEXT_PUBLIC_SUBRAILS_ACCOUNT_WASM_HASH=12d8e61efa33b3d051d04e012c1d24b26f68a16f984faca41e68c6686eab0c71
#   NEXT_PUBLIC_INDEXER_API_URL=https://subrails-indexer.onrender.com
```

Run it:

```sh
pnpm --filter @subrails/web build
pnpm --filter @subrails/web start
```

For local development with hot reload:

```sh
pnpm --filter @subrails/web dev
```

**Platform quirk:** on some platforms the native Turbopack binary is not
available, and `next build` (which defaults to Turbopack in Next.js 16) fails
to load it. This is a known platform quirk, not a bug. Build with webpack
instead by passing the flag through:

```sh
pnpm --filter @subrails/web build -- --webpack
```

### Testnet deployment values

The contracts are deployed and verified on Stellar testnet:

| Contract | Contract id |
| --- | --- |
| mandate-policy | `CCXWO6DITIGMSKOILIZGKISTIIZ3ITJSG5YR3XVMBCV4SQWFOZUP4QEQ` |
| subrails-account (reference instance) | `CAP6XKRZTYYYOOFIE5X4MVHY6OOJZCTMYFFV2MCCYGLBMFBUS2FBNT4E` |
| mandate-registry | `CAHHVUCYAQ37IGVJ3FYPA5HYT5WWPOQBO7ZKFBMYONKV2YKOV3L7EC2O` |

| Artifact | Value |
| --- | --- |
| subrails-account wasm hash (for deploying new per-subscriber accounts) | `12d8e61efa33b3d051d04e012c1d24b26f68a16f984faca41e68c6686eab0c71` |

## How a charge is authorized

1. The subscriber creates a mandate naming one merchant, one token, a cap, an
   interval, and an expiry. The `mandate-policy` contract stores it and the
   smart account registers it.
2. When a charge is due, the merchant submits a transaction that moves the
   exact amount. Authorization is not an inline signature: the smart account
   delegates the decision to the policy contract.
3. Inside `__check_auth`, the policy verifies the token, the merchant, the
   amount against the cap, the interval since the last charge, and the expiry.
   Any failure rejects the whole transaction. On success it advances the next
   valid ledger and lets the transfer settle.
4. The subscriber can revoke. After revocation no further charge authorizes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev environment setup, git
workflow, and how to propose a change.

## Community

<!-- TODO: add a community link (for example a Telegram or Discord group) here. -->

## Maintainers

| Role | Contact |
| --- | --- |
| Maintainer | [@Hollujay](https://github.com/Hollujay) |

## Contributors

[![Contributors](https://contrib.rocks/image?repo=Subrails/subrails-app)](https://github.com/Subrails/subrails-app/graphs/contributors)

## License

Apache-2.0. See [LICENSE](LICENSE).
