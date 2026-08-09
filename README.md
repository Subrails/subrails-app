# Subrails App

Reference application for Subrails, a recurring-authorization protocol on Stellar.

This workspace contains the TypeScript SDK (`@subrails/sdk`), a Soroban event
indexer with a read-only API, and a reference Next.js frontend that demonstrates
the full protocol flow. The smart contracts themselves live in the sibling
`sublink` repo.

## Layout

- `packages/sdk`: typed client for the Subrails contracts, including the CAP-71 delegated charge path.
- `indexer`: polls Soroban RPC for contract events, stores them in Postgres, and serves a read-only API.
- `apps/web`: Next.js reference frontend.
- `docs`: documentation site (built in a later phase).

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
```

Copy `.env.example` to `.env` and fill in the values. Contract IDs are populated
after the contracts are deployed.
