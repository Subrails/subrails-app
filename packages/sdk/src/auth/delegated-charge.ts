/**
 * The CAP-71 delegated charge path.
 *
 * This is the one part of the SDK where guessing from older Stellar knowledge
 * is wrong, so it lives in one heavily-commented file.
 *
 * ## The problem
 *
 * A merchant wants to pull a recurring payment out of a subscriber's smart
 * account (the subrails-account contract). On the chain this is a token
 * `transfer(from = subrails_account, to = merchant, amount)`. The token
 * contract requires authorization from `from`, and `from` is a contract, not
 * a signing keypair. The subscriber is not present to sign, and must not be:
 * the whole point of Subrails is that the merchant can charge without the
 * subscriber's per-charge consent, within the on-chain mandate limits.
 *
 * Pre-CAP-71 Soroban had no way to express this: address credentials could
 * only be signed by an ed25519 keypair, and a contract cannot hold one.
 * Protocol 27 (CAP-71) adds `ADDRESS_V2` (address-bound payloads) and
 * `ADDRESS_WITH_DELEGATES` (delegated signers) credentials. The
 * subrails-account contract implements `__check_auth` (a custom account) and
 * accepts charges when its authorization entry lists the mandate-policy
 * contract as a delegated signer: the host then forwards the transfer
 * context to the policy's `__check_auth`, which validates the charge against
 * the mandate rules (cap, cadence, expiry).
 *
 * ## What the SDK does
 *
 * 1. Build the token `transfer` transaction as the merchant (the submitting
 *    account).
 * 2. Simulate in "record" auth mode (no enforcement, because the
 *    authorization is not assembled yet), asking the host for upgraded
 *    address-bound (V2) credentials when `protocol27` is enabled.
 * 3. For the authorization entry authorizing the subrails-account, wrap its
 *    address credentials in `ADDRESS_WITH_DELEGATES` with the mandate-policy
 *    contract as the sole delegate, using
 *    {@link @stellar/stellar-sdk#buildWithDelegatesEntry}. Both the
 *    top-level account node and the policy delegate carry `scvVoid`
 *    signatures: neither is an ed25519 signer, and the host satisfies the
 *    authorization by invoking the contracts' `__check_auth` entry points.
 * 4. Build the signature preimage with
 *    {@link @stellar/stellar-sdk#buildAuthorizationEntryPreimage} and verify
 *    it selected the address-bound
 *    `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS` payload, which is the
 *    payload the account's owner-path and delegated verification actually use
 *    on a Protocol 27 network. The helper picks the payload from the entry's
 *    own credential type, so there is no hardcoded envelope type anywhere in
 *    this SDK.
 * 5. Sign the envelope with the merchant's wallet, submit, and confirm.
 *
 * On a network without Protocol 27 this path throws
 * {@link Protocol27RequiredError}: delegated authorization simply does not
 * exist there, and fabricating a legacy entry would fail on-chain.
 */

import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeInvocation,
  buildAuthorizationEntryPreimage,
  buildWithDelegatesEntry,
  inspectAuthEntry,
  rpc as SorobanRpc,
  xdr,
} from "@stellar/stellar-sdk";

import { requireFilled } from "../config.ts";
import type { SdkConfig } from "../config.ts";
import { ContractCallError, Protocol27RequiredError, mapContractError } from "../errors.ts";
import type { AddressString, ChargeResult } from "../types.ts";
import {
  addressScVal,
  assembleWithAuth,
  i128ScVal,
  requireSimulationSuccess,
} from "../clients/base.ts";
import type { Signer } from "../clients/base.ts";

/** Parameters for wrapping one authorization entry with the policy delegate. */
export interface DelegateWrapParams {
  /** The mandate-policy contract id that enforces the charge. */
  mandatePolicyId: AddressString;
  /** The ledger until which the entry's signatures are valid (exclusive). */
  validUntilLedgerSeq: number;
  /** The network passphrase, mixed into the signed payload. */
  networkPassphrase: string;
}

/**
 * Wraps a single simulated authorization entry for the subrails-account in
 * `ADDRESS_WITH_DELEGATES` credentials with the mandate-policy contract as
 * the sole delegate, and verifies the address-bound preimage that CAP-71
 * requires.
 *
 * This is the pure, unit-testable core of the charge path. `entry` must be
 * an address-credential entry (`ADDRESS` or `ADDRESS_V2`) whose address is
 * the subrails-account contract; anything else is a programming error and
 * throws {@link ContractCallError}.
 *
 * @returns the wrapped entry
 * @throws Protocol27RequiredError via {@link requireProtocol27} when the
 *   caller has not opted into Protocol 27
 */
export function wrapWithPolicyDelegate(
  entry: xdr.SorobanAuthorizationEntry,
  params: DelegateWrapParams,
): xdr.SorobanAuthorizationEntry {
  const info = inspectAuthEntry(entry);
  if (info.credentialType === "sourceAccount" || info.address === null) {
    throw new ContractCallError(
      "Expected an address-credential authorization entry for the subrails-account, got source-account credentials.",
    );
  }
  const wrapped = buildWithDelegatesEntry({
    entry,
    validUntilLedgerSeq: params.validUntilLedgerSeq,
    // The mandate-policy contract is the delegated signer. Its signature node
    // stays scvVoid: the host invokes its `__check_auth` during the account's
    // authorization, and the policy enforces the mandate rules there.
    delegates: [{ address: params.mandatePolicyId }],
  });
  // Verify the entry carries the CAP-71 address-bound payload that the
  // account's delegated authorization expects. buildAuthorizationEntryPreimage
  // selects the payload from the entry's own credential type; we assert the
  // result rather than assuming an envelope type.
  const preimage = buildAuthorizationEntryPreimage(
    wrapped,
    params.validUntilLedgerSeq,
    params.networkPassphrase,
  );
  if (
    preimage.switch().value !==
    xdr.EnvelopeType.envelopeTypeSorobanAuthorizationWithAddress().value
  ) {
    throw new ContractCallError(
      `Delegated charge produced the wrong preimage type: ${preimage.switch().name}.`,
    );
  }
  return wrapped;
}

/** Parameters for {@link prepareChargeAuth}. */
export interface PrepareChargeAuthParams {
  /** The mandate-policy contract id that enforces the charge. */
  mandatePolicyId: AddressString;
  /** The subrails-account contract id being charged. */
  subrailsAccount: AddressString;
  /** The ledger until which the entries' signatures are valid (exclusive). */
  validUntilLedgerSeq: number;
  /** The network passphrase, mixed into the signed payload. */
  networkPassphrase: string;
  /** Whether CAP-71 delegated credentials are enabled for this network. */
  protocol27: boolean;
}

/**
 * Prepares the authorization entries of a charge transaction.
 *
 * Every address-credential entry belonging to the subrails-account is wrapped
 * with the policy delegate via {@link wrapWithPolicyDelegate}. Other entries
 * (e.g. the merchant's own, when present) are passed through untouched.
 *
 * Throws {@link Protocol27RequiredError} when `protocol27` is false.
 */
export async function prepareChargeAuth(
  entries: xdr.SorobanAuthorizationEntry[],
  params: PrepareChargeAuthParams,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  requireProtocol27(params.protocol27);
  const prepared: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of entries) {
    const info = inspectAuthEntry(entry);
    if (info.credentialType !== "sourceAccount" && info.address === params.subrailsAccount) {
      prepared.push(
        wrapWithPolicyDelegate(entry, {
          mandatePolicyId: params.mandatePolicyId,
          validUntilLedgerSeq: params.validUntilLedgerSeq,
          networkPassphrase: params.networkPassphrase,
        }),
      );
    } else {
      prepared.push(entry);
    }
  }
  return prepared;
}

/** Parameters for the full merchant charge flow, {@link charge}. */
export interface ChargeParams {
  /** SDK configuration (RPC, network, protocol27, contract ids). */
  config: SdkConfig;
  /** The token contract id the charge is denominated in. */
  token: AddressString;
  /** The subrails-account contract id being charged. */
  subrailsAccount: AddressString;
  /** The merchant account receiving the payment. */
  merchant: AddressString;
  /** The amount to charge, in token base units. */
  amount: bigint;
  /** The mandate this charge is intended under (used for the result and display). */
  mandateId: bigint;
  /** The merchant's wallet; signs the transaction envelope. */
  signer: Signer;
  /** Ledger at which the prepared auth entries expire; defaults to latest + 100. */
  validUntilLedger?: number;
  /** How long to wait for confirmation; defaults to 60 s. */
  timeoutMs?: number;
  /** Test seam: inject a fake RPC server instead of the real one. */
  server?: SorobanRpc.Server;
}

/**
 * Runs the merchant charge flow end to end: builds the token `transfer` from
 * the subrails-account, prepares the CAP-71 delegated authorization, signs
 * the envelope with the merchant's wallet, submits, and waits for
 * confirmation.
 *
 * Maps to a token `transfer` invoked by the merchant, authorized by the
 * subrails-account's CAP-71 delegation to the mandate-policy contract (see
 * the module docs). The charge amount is `bigint` in token base units.
 *
 * @throws {@link Protocol27RequiredError} if `config.protocol27` is false,
 *   or typed contract errors (TooEarly, AmountTooHigh, Expired, ...) mapped
 *   from the authorization check
 */
export async function charge(params: ChargeParams): Promise<ChargeResult> {
  requireProtocol27(params.config.protocol27);
  requireFilled(params.config.mandatePolicyId, "MANDATE_POLICY_ID");

  const server =
    params.server ??
    new SorobanRpc.Server(params.config.rpcUrl, {
      allowHttp: params.config.rpcUrl.startsWith("http://"),
    });

  // 1. Build the transfer transaction as the merchant.
  const merchantAccount = await server.getAccount(params.signer.publicKey);
  const tx = new TransactionBuilder(merchantAccount, {
    fee: BASE_FEE,
    networkPassphrase: params.config.networkPassphrase,
  })
    .setTimeout(300)
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(params.token).toScAddress(),
            functionName: "transfer",
            args: [
              addressScVal(params.subrailsAccount),
              addressScVal(params.merchant),
              i128ScVal(params.amount),
            ],
          }),
        ),
        auth: [],
      }),
    )
    .build();

  // 2. Simulate in record mode with Protocol 27 upgraded credentials.
  let sim;
  try {
    sim = await server.simulateTransaction(tx, undefined, "record", params.config.protocol27);
  } catch (cause) {
    throw mapContractError(cause);
  }
  const success = requireSimulationSuccess(sim);

  // 3. Assemble with the simulation data, wrapping the account's entries with
  //    the policy delegate before they are baked into the transaction.
  const validUntilLedger = params.validUntilLedger ?? (await server.getLatestLedger()).sequence + 100;
  const prepared = await prepareChargeAuth(success.result?.auth ?? [], {
    mandatePolicyId: params.config.mandatePolicyId,
    subrailsAccount: params.subrailsAccount,
    validUntilLedgerSeq: validUntilLedger,
    networkPassphrase: params.config.networkPassphrase,
    protocol27: params.config.protocol27,
  });
  const assembled = assembleWithAuth(tx, success, prepared);

  // Re-simulate in enforce mode so the host actually runs the account's
  // `__check_auth` and the policy delegate against the prepared entries.
  // Mandate rule violations (TooEarly, AmountTooHigh, Expired, ...) surface
  // as typed errors here, before any fee is paid or the tx is submitted.
  await validatePreparedAuthFor(server, assembled, params.config);

  // 4. Sign the envelope with the merchant's wallet and submit.
  const { signedTxXdr } = await params.signer.signTransaction(assembled.toXDR(), {
    networkPassphrase: params.config.networkPassphrase,
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, params.config.networkPassphrase) as Transaction;
  const send = await server.sendTransaction(signedTx);
  if (send.status === "ERROR") {
    throw mapContractError(new Error("Charge transaction submission failed."));
  }

  // 5. Wait for confirmation.
  const deadline = Date.now() + (params.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const result = await server.getTransaction(send.hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        mandateId: params.mandateId,
        amount: params.amount,
        txHash: send.hash,
        ledger: result.ledger,
      };
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw mapContractError(
        new Error(`Charge transaction failed on ledger ${result.ledger}.`),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new ContractCallError(`Charge transaction ${send.hash} was not confirmed within the timeout.`);
}

/**
 * Builds and signs an owner authorization entry from an invocation tree,
 * opting into `ADDRESS_V2` (address-bound, CAP-71) credentials when
 * `protocol27` is true and legacy `ADDRESS` credentials otherwise.
 *
 * This is the SDK's explicit expression of the "authV2 path on the authorize
 * params": {@link @stellar/stellar-sdk#authorizeInvocation} with
 * `authV2: protocol27`. It is used by advanced/server-side flows that build
 * authorization entries offline and by the tests that assert the credential
 * path selection per network.
 *
 * @param params.invocation - the invocation tree being authorized
 * @param params.signer - the keypair that signs (e.g. the account owner)
 * @param params.validUntilLedgerSeq - the ledger until which the entry is valid
 */
export async function buildOwnerAuthEntry(params: {
  invocation: xdr.SorobanAuthorizedInvocation;
  signer: Keypair;
  validUntilLedgerSeq: number;
  networkPassphrase: string;
  protocol27: boolean;
}): Promise<xdr.SorobanAuthorizationEntry> {
  return authorizeInvocation({
    signer: params.signer,
    validUntilLedgerSeq: params.validUntilLedgerSeq,
    invocation: params.invocation,
    networkPassphrase: params.networkPassphrase,
    authV2: params.protocol27,
  });
}

/** Builds the invocation tree for a token `transfer` (used in tests and offline flows). */
export function buildTransferInvocation(params: {
  token: AddressString;
  from: AddressString;
  to: AddressString;
  amount: bigint;
}): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(params.token).toScAddress(),
        functionName: "transfer",
        args: [addressScVal(params.from), addressScVal(params.to), i128ScVal(params.amount)],
      }),
    ),
    subInvocations: [],
  });
}

/** Throws {@link Protocol27RequiredError} when CAP-71 is not enabled. */
export function requireProtocol27(protocol27: boolean): void {
  if (!protocol27) {
    throw new Protocol27RequiredError(
      "Delegated charges require Protocol 27 (CAP-71). Enable SUBRAILS_PROTOCOL27 on a Protocol 27 network.",
    );
  }
}

/**
 * Enforce-mode re-simulation that runs the prepared authorization against
 * the account's `__check_auth` (and the policy delegate). Kept as a thin
 * local wrapper so `charge` can validate without a full ClientContext.
 */
async function validatePreparedAuthFor(
  server: SorobanRpc.Server,
  tx: Transaction,
  config: SdkConfig,
): Promise<void> {
  try {
    const check = await server.simulateTransaction(tx, undefined, "enforce", config.protocol27);
    requireSimulationSuccess(check);
  } catch (cause) {
    throw mapContractError(cause);
  }
}
