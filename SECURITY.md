# Security Policy

## Security status

Subrails has **not been audited**. It is deployed on **Stellar testnet only**.

Do not deploy the contracts or use the SDK on mainnet with real funds until an
independent audit has been completed and published. The contracts live in the
sibling `subrails-contract` repository and carry the same status.
<!-- TODO: link to the subrails-contract repository once it is public. -->

## Reporting a vulnerability

Do not open a public GitHub issue for a security vulnerability. Instead:

1. Use GitHub's private vulnerability reporting for this repository (Security tab, "Report a vulnerability"), if it is enabled.
2. If it is not enabled, reach out to the maintainer, [@Hollujay](https://github.com/Hollujay), directly through GitHub rather than filing a public issue.

Include, when you have it:

- The affected component (contract, SDK, indexer) and the version or commit.
- A description of the vulnerability and how to reproduce it.
- Your assessment of impact and any suggested fix.

You should receive an acknowledgement, and we ask that you give us time to
address the issue before publishing details.

## Scope

In scope:

- The Subrails Soroban contracts (in `subrails-contract`).
- The TypeScript SDK (`packages/sdk`) and the on-chain flows it drives.
- The indexer (`indexer/`) and its read API.

Out of scope:

- Third-party wallet extensions and libraries the reference frontend connects
  to; report issues with those to the respective projects.
- UI bugs in the reference frontend that do not touch funds.

## Bug bounty

There is currently no bug bounty program. Security researchers are welcome to
report findings under the disclosure policy above regardless.
