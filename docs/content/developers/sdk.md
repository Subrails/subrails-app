---
title: SDK reference
description: The @subrails/sdk TypeScript client: configuration, clients, and working code examples.
section: developers
eyebrow: Developer guide
---

# SDK reference

`@subrails/sdk` is the TypeScript client for the three contracts, including the CAP-71 delegated charge path. Everything below uses the real exported names and signatures from the package source, and the examples are written to compile against them.

## Setup

The SDK is the `packages/sdk` package in this workspace, published as `@subrails/sdk`. Build it from the workspace root and import it like any other package:

``` title=workspace install
pnpm install
pnpm --filter @subrails/sdk build

# then, from another package in the workspace:
import {
  loadConfigFromEnv,
  MandatePolicyClient,
  SubrailsAccountClient,
  MandateRegistryClient,
  TokenClient,
  charge,
  KeypairSigner,
} from "@subrails/sdk";
```

It depends on `@stellar/stellar-sdk` (16.x) and targets Node.js 22+. Everything is typed: addresses are strkeys (`G...` accounts, `C...` contracts), amounts are `bigint` in token base units end to end, and ledger numbers are numbers.

## Configuration

Build an `SdkConfig` with `loadConfigFromEnv()`, which reads the `SUBRAILS_*` variables (see the [environment reference](/developers)). Contract ids are validated at the point of use, not load:

``` title=config.ts
import { loadConfigFromEnv } from "@subrails/sdk";

const config = loadConfigFromEnv();
// config: {
//   network: "testnet",
//   rpcUrl: "https://soroban-testnet.stellar.org",
//   networkPassphrase: "Test SDF Network ; September 2015",
//   protocol27: true,
//   mandatePolicyId: "CCXWO6...4QEQ",
//   subrailsAccountWasmHash: "12d8e6...c71",
//   mandateRegistryId: "CAHHVU...7EC2O",
// }
```

`protocol27` gates CAP-71 delegated credentials. It defaults to `true` on testnet and `false` on mainnet, and can be overridden with `SUBRAILS_PROTOCOL27`. The merchant charge path refuses to run without it.

## Signers

Every write takes a `Signer`. Server-side code uses `KeypairSigner`; in the browser you pass a wallet adapter (for example Freighter) that implements the same interface. The wallet only signs what the SDK hands it, and never exposes a secret key to the SDK:

``` title=signers
import { Keypair } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@subrails/sdk";

const ownerKeypair = Keypair.fromSecret(process.env.SUBSCRIBER_SECRET!);
const merchantKeypair = Keypair.fromSecret(process.env.MERCHANT_SECRET!);

const ownerSigner = new KeypairSigner(ownerKeypair, config.networkPassphrase);
const merchantSigner = new KeypairSigner(merchantKeypair, config.networkPassphrase);
```

## Clients

| Export | Methods | Maps to |
| --- | --- | --- |
| `MandatePolicyClient` | `createMandate`, `revokeMandate`, `getMandate`, `ledger` | `create_mandate`, `revoke_mandate`, `get_mandate` |
| `SubrailsAccountClient` | `deployAccount`, `initialize`, `registerMandate`, `ledger` | deployment, `initialize`, `register_mandate` |
| `MandateRegistryClient` | `indexMandate`, `listByAccount`, `listByMerchant`, `ledger` | `index_mandate`, `list_by_account`, `list_by_merchant` |
| `TokenClient` | `transfer`, `balance`, `symbol`, `decimals`, `ledger` | standard Soroban token interface |
| `charge` (function) | full merchant charge flow: build, prepare, validate, sign, submit | a token `transfer` authorized via CAP-71 delegation |

## Subscriber flow: account, mandate, register

The subscriber deploys a smart account, initializes it, creates a mandate, and registers it on the account so charges can be delegated:

``` title=subscriber-flow.ts
import { MandatePolicyClient, SubrailsAccountClient } from "@subrails/sdk";

const accounts = new SubrailsAccountClient(config);
const policy = new MandatePolicyClient(config);

// 1. Deploy a fresh smart account for the subscriber. The account id is
//    derived from the deployer, a salt, and the installed wasm hash.
const { accountId } = await accounts.deployAccount(
  {
    owner: ownerKeypair.publicKey(), // G... strkey
    policyContract: config.mandatePolicyId,
  },
  { signer: ownerSigner },
);

// 2. Initialize it. Deployment and initialization are separate calls today;
//    same-transaction deploy-and-initialize is a future enhancement.
await accounts.initialize(
  {
    accountId,
    owner: ownerKeypair.publicKey(),
    policyContract: config.mandatePolicyId,
  },
  { signer: ownerSigner },
);

// 3. Create the mandate: merchant, token, cap, interval, expiry.
const currentLedger = await policy.ledger();
const { mandateId } = await policy.createMandate(
  {
    account: accountId,
    merchant: merchantSigner.publicKey,
    token: tokenId,                 // the token contract id
    maxAmount: 10_000_000n,         // 10.000000 in a 6-decimal token
    intervalLedgers: 1_000,         // ~1.4 hours on the public networks
    expiryLedger: currentLedger + 500_000, // ~29 days out
  },
  { signer: ownerSigner }, // the account must authorize: the owner signs
);

// 4. Register the mandate on the account so its charges are delegated to
//    the policy contract. Also owner-signed.
await accounts.registerMandate({ accountId, mandateId }, { signer: ownerSigner });
```

## Merchant flow: charge

The merchant submits the charge with `charge`. The SDK builds the token `transfer`, wraps the account's authorization entry with the policy as the delegated signer (CAP-71), re-simulates in enforce mode so a rule violation surfaces as a typed error before any fee is paid, then signs with the merchant's wallet and submits:

``` title=merchant-charge.ts
import { charge } from "@subrails/sdk";

const result = await charge({
  config,
  token: tokenId,
  subrailsAccount: accountId,
  merchant: merchantSigner.publicKey,
  amount: 10_000_000n,
  mandateId,
  signer: merchantSigner, // the merchant signs the envelope
});

// result: {
//   mandateId: 1n,
//   amount: 10000000n,
//   txHash: "a3f0...",
//   ledger: 58123456,   // null until confirmed
// }
```

A charge before `nextValidLedger`, over the cap, after expiry, or on a revoked mandate throws the mapped error instead of submitting. The same checks run on-chain inside `__check_auth`, so a transaction that somehow reached the network would be rejected there too.

## Reads

``` title=reads.ts
import { MandateRegistryClient, TokenClient } from "@subrails/sdk";

// The full mandate record, straight from the policy contract.
const mandate = await policy.getMandate(mandateId);
// mandate: {
//   mandateId: 1n,
//   account: "C...", merchant: "G...", token: "C...",
//   maxAmount: 10000000n,
//   intervalLedgers: 1000,
//   nextValidLedger: 58123456,
//   expiryLedger: 58623456,
//   status: "Active",
// }

// Which mandates exist for a party, via the registry (ids only).
const registry = new MandateRegistryClient(config);
const accountIds = await registry.listByAccount(accountId);     // bigint[]
const merchantIds = await registry.listByMerchant(merchantSigner.publicKey);

// Token metadata and balances for display.
const token = new TokenClient(config, { tokenId });
const [symbol, decimals, balance] = await Promise.all([
  token.symbol(),      // "USDC"
  token.decimals(),    // 6
  token.balance(accountId), // bigint base units
]);

// Fund the account from a funded keypair.
await token.transfer(
  { from: funderSigner.publicKey, to: accountId, amount: 1_000_000_000n },
  { signer: funderSigner },
);
```

## Revocation

The subscriber revokes with their own wallet. Only the mandate's account can authorize revocation (see the contract reference for the deviation note):

``` title=revoke.ts
await policy.revokeMandate(mandateId, { signer: ownerSigner });
```

## Errors

Every contract failure surfaces as a typed `SubrailsError` subclass, mapped from the numeric code via `errorFromContractCode`. The codes match the mandate-policy `Error` enum:

| Code | Error class | code |
| --- | --- | --- |
| <span class="pill pill-flag">1</span> | `MandateNotFoundError` | `MANDATE_NOT_FOUND` |
| <span class="pill pill-flag">2</span> | `NotActiveError` | `MANDATE_NOT_ACTIVE` |
| <span class="pill pill-flag">3</span> | `ExpiredError` | `MANDATE_EXPIRED` |
| <span class="pill pill-flag">4</span> | `TooEarlyError` | `CHARGE_TOO_EARLY` |
| <span class="pill pill-flag">5</span> | `AmountTooHighError` | `AMOUNT_TOO_HIGH` |
| <span class="pill pill-flag">6</span> | `WrongMerchantError` | `WRONG_MERCHANT` |
| <span class="pill pill-flag">7</span> | `WrongTokenError` | `WRONG_TOKEN` |
| <span class="pill pill-flag">8</span> | `UnauthorizedError` | `UNAUTHORIZED` |
| <span class="pill pill-flag">9</span> | `InvalidAmountError` | `INVALID_AMOUNT` |
| <span class="pill pill-flag">10</span> | `InvalidIntervalError` | `INVALID_INTERVAL` |
| <span class="pill pill-flag">11</span> | `InvalidExpiryError` | `INVALID_EXPIRY` |
| <span class="pill pill-flag">12</span> | `AlreadyResolvedError` | `ALREADY_RESOLVED` |
| <span class="pill pill-flag">13</span> | `DuplicateMandateError` | `DUPLICATE_MANDATE` |
| <span class="pill pill-flag">14</span> | `OverflowError` | `OVERFLOW` |

Configuration, network, and mapping failures use `InvalidConfigError` (`INVALID_CONFIG`), `ContractCallError` (`CONTRACT_CALL_FAILED`), and `Protocol27RequiredError` (`PROTOCOL_27_REQUIRED`, thrown when a delegated charge is attempted with `protocol27` off). Use `mapContractError` to normalize anything thrown by a contract call into the typed hierarchy.

> [!note] How the charge authorization is assembled
>
> The SDK never hardcodes an authorization envelope type. It simulates in record mode, wraps the subrails-account's entry with the policy delegate, then selects the signature preimage with `buildAuthorizationEntryPreimage` from `@stellar/stellar-sdk`, which picks the payload from the entry's own credential type. The lower-level helpers (`prepareChargeAuth`, `wrapWithPolicyDelegate`, `requireProtocol27`, `buildOwnerAuthEntry`, `buildTransferInvocation`) are exported for tests and offline flows.
