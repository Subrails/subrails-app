/**
 * Shared machinery for the Subrails contract clients.
 *
 * Every write flow follows the same shape:
 *   1. build the invocation transaction (sequence number from the network),
 *   2. simulate in "record" auth mode so the SDK can prepare the authorization
 *      entries itself, opting into Protocol 27 upgraded (address-bound V2)
 *      credentials when `protocol27` is enabled,
 *   3. assemble the transaction with the simulation data (footprint, resource
 *      fee, and the recorded authorization entries),
 *   4. prepare the authorization entries: sign them (owner-signed operations)
 *      or wrap them with the policy delegate (merchant charges),
 *   5. sign the transaction envelope through the caller's {@link Signer},
 *   6. submit and wait for confirmation.
 *
 * Nothing here ever hardcodes an authorization envelope type: preimage
 * selection happens inside the stellar-sdk's `buildAuthorizationEntryPreimage`
 * based on the credential type the entry actually carries.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  UnsignedHyper,
  authorizeEntry,
  inspectAuthEntry,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { requireFilled } from "../config.ts";
import type { SdkConfig } from "../config.ts";
import { ContractCallError, mapContractError } from "../errors.ts";
import type { AddressString, Mandate, MandateStatus } from "../types.ts";

/**
 * A wallet-style signer the SDK can ask to sign transaction envelopes and
 * (for owner-signed operations) individual Soroban authorization entries.
 *
 * Implementations: {@link KeypairSigner} for server-side use, and a wallet
 * adapter (e.g. Freighter) in the browser. The wallet never sees a secret
 * key; it only signs what the SDK hands it.
 */
export interface Signer {
  /** The public address that will appear on signatures. */
  readonly publicKey: string;
  /**
   * Signs a transaction envelope XDR and returns the signed envelope XDR.
   * The envelope is the final assembled Soroban transaction, ready to submit.
   */
  signTransaction(
    txXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
  /**
   * Signs a single Soroban authorization entry XDR and returns the signed
   * entry XDR. Required for owner-signed operations against the
   * subrails-account contract, optional elsewhere.
   */
  signAuthEntry?(
    authEntryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
}

/**
 * A {@link Signer} backed by a local {@link Keypair}. For server-side SDK
 * use and for tests. Never use this in the browser frontend.
 */
export class KeypairSigner implements Signer {
  readonly publicKey: string;
  private readonly keypair: Keypair;
  private readonly networkPassphrase: string;

  constructor(keypair: Keypair, networkPassphrase: string) {
    this.keypair = keypair;
    this.networkPassphrase = networkPassphrase;
    this.publicKey = keypair.publicKey();
  }

  async signTransaction(txXdr: string, opts?: { networkPassphrase?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    const tx = TransactionBuilder.fromXDR(txXdr, opts?.networkPassphrase ?? this.networkPassphrase) as Transaction;
    tx.sign(this.keypair);
    return { signedTxXdr: tx.toXDR(), signerAddress: this.publicKey };
  }

  async signAuthEntry(authEntryXdr: string, opts?: { networkPassphrase?: string }): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, "base64");
    const info = inspectAuthEntry(entry);
    if (info.credentialType === "sourceAccount") {
      // Source-account credentials are covered by the envelope signature.
      return { signedAuthEntry: entry.toXDR("base64"), signerAddress: this.publicKey };
    }
    const validUntilLedgerSeq = info.signatureExpirationLedger ?? 0;
    const signed = await authorizeEntry(
      entry,
      this.keypair,
      validUntilLedgerSeq,
      opts?.networkPassphrase ?? this.networkPassphrase,
    );
    return { signedAuthEntry: signed.toXDR("base64"), signerAddress: this.publicKey };
  }
}

/** Shared configuration for one contract client. */
export interface ClientContextOptions {
  config: SdkConfig;
  contractId: string;
  /** Test seam: inject a fake RPC server instead of the real one. */
  server?: SorobanRpc.Server;
}

/**
 * A configured connection to one contract: RPC server, network passphrase,
 * and the machinery to build, simulate, sign, and confirm transactions.
 */
export class ClientContext {
  readonly config: SdkConfig;
  readonly contractId: string;
  readonly server: SorobanRpc.Server;

  constructor(opts: ClientContextOptions) {
    requireFilled(opts.contractId, `Contract id for ${opts.contractId}`);
    this.config = opts.config;
    this.contractId = opts.contractId;
    this.server =
      opts.server ??
      new SorobanRpc.Server(opts.config.rpcUrl, {
        allowHttp: opts.config.rpcUrl.startsWith("http://"),
      });
  }

  /** The network's current ledger sequence. */
  async latestLedger(): Promise<number> {
    try {
      return (await this.server.getLatestLedger()).sequence;
    } catch (cause) {
      throw mapContractError(cause);
    }
  }

  /**
   * Builds a single-invocation Soroban transaction for this contract's
   * `method` with the given pre-encoded ScVal arguments.
   *
   * The source account's sequence number is read from the network so the
   * transaction is valid for submission.
   */
  async buildInvocation(method: string, args: xdr.ScVal[], source: string): Promise<Transaction> {
    try {
      const account = await this.server.getAccount(source);
      return this.buildInvokeTransaction(method, args, account);
    } catch (cause) {
      throw mapContractError(cause);
    }
  }

  /**
   * Builds a single-invocation Soroban transaction for a view (read) call,
   * using a placeholder account with sequence 0. Views only need simulation,
   * so no real account is fetched.
   */
  async buildReadInvocation(method: string, args: xdr.ScVal[]): Promise<Transaction> {
    return this.buildInvokeTransaction(method, args, new Account(READ_ONLY_SOURCE, "0"));
  }

  private buildInvokeTransaction(method: string, args: xdr.ScVal[], account: Account): Transaction {
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .setTimeout(300)
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(this.contractId).toScAddress(),
              functionName: method,
              args,
            }),
          ),
          auth: [],
        }),
      )
      .build();
  }

  /**
   * Simulates `tx` in "record" auth mode so the caller can prepare the
   * authorization entries itself. When `protocol27` is enabled the SDK asks
   * the host for upgraded address-bound (V2) credentials.
   *
   * @throws a typed {@link SubrailsError} when simulation fails
   */
  async simulateRecord(tx: Transaction): Promise<SorobanRpc.Api.SimulateTransactionSuccessResponse> {
    try {
      const sim = await this.server.simulateTransaction(tx, undefined, "record", this.config.protocol27);
      return requireSimulationSuccess(sim);
    } catch (cause) {
      throw mapContractError(cause);
    }
  }

  /** Signs the envelope of `tx` through `signer` and returns the signed transaction. */
  async signEnvelope(tx: Transaction, signer: Signer): Promise<Transaction> {
    const { signedTxXdr } = await signer.signTransaction(tx.toXDR(), {
      networkPassphrase: this.config.networkPassphrase,
    });
    return TransactionBuilder.fromXDR(signedTxXdr, this.config.networkPassphrase) as Transaction;
  }

  /**
   * Submits `tx` and polls `getTransaction` until it is confirmed, failed,
   * or the timeout elapses.
   *
   * @returns the transaction hash and the ledger it was applied in (null if
   *   the confirmation never arrived within the timeout)
   */
  async submitAndConfirm(tx: Transaction, opts: { timeoutMs?: number } = {}): Promise<{ txHash: string; ledger: number | null }> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const send = await this.server.sendTransaction(tx);
    if (send.status === "ERROR") {
      throw mapContractError(
        new Error(`Transaction submission failed: ${describeTransactionFailure(send)}`),
      );
    }
    const deadline = Date.now() + timeoutMs;
    let lastStatus: SorobanRpc.Api.GetTransactionStatus | undefined;
    while (Date.now() < deadline) {
      const result = await this.server.getTransaction(send.hash);
      lastStatus = result.status;
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return { txHash: send.hash, ledger: result.ledger };
      }
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw mapContractError(
          new Error(`Transaction failed on ledger ${result.ledger}: ${describeTransactionFailure(result)}`),
        );
      }
      await sleep(1_000);
    }
    throw new ContractCallError(
      `Transaction ${send.hash} was not confirmed within ${timeoutMs} ms (last status ${lastStatus ?? "unknown"}).`,
    );
  }
}

/** Extracts the successful simulation result or throws a typed error. */
export function requireSimulationSuccess(
  sim: SorobanRpc.Api.SimulateTransactionResponse,
): SorobanRpc.Api.SimulateTransactionSuccessResponse {
  if ("result" in sim && sim.result !== undefined) {
    return sim;
  }
  const message = "error" in sim && typeof sim.error === "string" ? sim.error : "Transaction simulation failed.";
  throw mapContractError(new Error(message));
}

function describeTransactionFailure(result: SorobanRpc.Api.SendTransactionResponse | SorobanRpc.Api.GetTransactionResponse): string {
  if ("errorResult" in result && result.errorResult !== undefined) {
    const code = extractContractErrorFromResult(result.errorResult);
    return code === null ? "the network rejected the transaction." : `contract error ${code}.`;
  }
  return "the network rejected the transaction.";
}

/**
 * Extracts a contract error code from a failed transaction result XDR, if
 * the failure was a contract trap.
 *
 * The on-chain `InvokeHostFunctionResult` carries no error payload on a
 * trap, so this only inspects the operation switch; contract error codes are
 * surfaced earlier, by the pre-submit enforce-mode validation in
 * {@link validatePreparedAuth}, which runs the account's `__check_auth` (and
 * the policy delegate) with the prepared entries and maps the code to a
 * typed error. Returns null when the failure was not a contract trap.
 */
export function extractContractErrorFromResult(result: xdr.TransactionResult): number | null {
  try {
    const opResults = result.result().results();
    if (opResults === undefined || opResults.length === 0) {
      return null;
    }
    const opResult = opResults[0];
    if (opResult === undefined || opResult.tr().switch().value !== xdr.OperationType.invokeHostFunction().value) {
      return null;
    }
    const inner = opResult.tr().invokeHostFunctionResult();
    if (inner.switch().value !== xdr.InvokeHostFunctionResultCode.invokeHostFunctionTrapped().value) {
      return null;
    }
    // A contract trap contains no error payload in the result XDR; the code
    // is surfaced by the pre-submit enforce-mode simulation instead.
    return null;
  } catch {
    return null;
  }
}

/**
 * Re-simulates a prepared transaction in "enforce" auth mode so the host
 * actually runs the authorization checks (the account's `__check_auth` and
 * any policy delegate) against the prepared entries. This surfaces mandate
 * rule violations (TooEarly, AmountTooHigh, Expired, ...) as typed errors
 * before anything is submitted, and confirms the entries are valid.
 *
 * @throws a typed {@link SubrailsError} when enforcement fails
 */
export async function validatePreparedAuth(
  ctx: ClientContext,
  tx: Transaction,
): Promise<void> {
  try {
    const check = await ctx.server.simulateTransaction(tx, undefined, "enforce", ctx.config.protocol27);
    requireSimulationSuccess(check);
  } catch (cause) {
    throw mapContractError(cause);
  }
}

// ---------------------------------------------------------------------------
// ScVal conversion and result parsing.
//
// Addresses are `scvAddress` (never a bare string ScVal). Amounts are `i128`
// and stay `bigint` end to end. Ledger numbers and intervals are `u32`.
// ---------------------------------------------------------------------------

/** Encodes an address strkey as an `scvAddress` ScVal for a contract call. */
export function addressScVal(address: AddressString): xdr.ScVal {
  return xdr.ScVal.scvAddress(Address.fromString(address).toScAddress());
}

/** Encodes an `i128` token amount as an ScVal. Never use `number` here. */
export function i128ScVal(amount: bigint): xdr.ScVal {
  return nativeToScVal(amount);
}

/** Encodes a `u64` value (e.g. a mandate id) as an ScVal. */
export function u64ScVal(value: bigint): xdr.ScVal {
  return xdr.ScVal.scvU64(UnsignedHyper.fromString(value.toString()));
}

/** Encodes a `u32` ledger number or interval as an ScVal. */
export function u32ScVal(value: number): xdr.ScVal {
  return xdr.ScVal.scvU32(value);
}

function assertScValType(value: xdr.ScVal, expected: xdr.ScValType, what: string): void {
  if (value.switch().value !== expected.value) {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
}

/** Parses a `u64` ScVal as a bigint. */
export function parseU64(value: xdr.ScVal, what = "u64 value"): bigint {
  assertScValType(value, xdr.ScValType.scvU64(), what);
  return value.u64().toBigInt();
}

/** Parses an `i128` ScVal as a bigint (via the SDK's native conversion). */
export function parseI128(value: xdr.ScVal, what = "i128 value"): bigint {
  const native = scValToNative(value);
  if (typeof native !== "bigint") {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  return native;
}

/** Parses an address ScVal back to a strkey string. */
export function parseAddress(value: xdr.ScVal, what = "address"): string {
  const native = scValToNative(value);
  if (typeof native !== "string") {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  return native;
}

/** Parses a `u32` ScVal as a number. */
export function parseU32(value: xdr.ScVal, what = "u32 value"): number {
  const native = scValToNative(value);
  if (typeof native !== "number") {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  return native;
}

/** Parses a contract enum ScVal (a one-element vector) into its variant name. */
export function parseEnumName(value: xdr.ScVal, what = "enum"): string {
  if (value.switch().value !== xdr.ScValType.scvVec().value) {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  const items = value.vec() ?? [];
  const variant = items[0];
  if (variant === undefined || variant.switch().value !== xdr.ScValType.scvSymbol().value) {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  return variant.sym().toString();
}

/**
 * Parses the mandate-policy `Mandate` struct ScVal (a nine-element vector of
 * fields in declaration order) into the typed {@link Mandate}.
 */
export function parseMandate(value: xdr.ScVal): Mandate {
  if (value.switch().value !== xdr.ScValType.scvVec().value) {
    throw new ContractCallError("Unexpected ScVal for Mandate.");
  }
  const fields = value.vec() ?? [];
  if (fields.length < 9) {
    throw new ContractCallError(`Unexpected Mandate shape: expected 9 fields, got ${fields.length}.`);
  }
  const statusName = parseEnumName(fields[8]!, "Mandate.status");
  if (statusName !== "Active" && statusName !== "Revoked" && statusName !== "Expired") {
    throw new ContractCallError(`Unexpected Mandate status ${statusName}.`);
  }
  return {
    mandateId: parseU64(fields[0]!, "Mandate.mandate_id"),
    account: parseAddress(fields[1]!, "Mandate.account"),
    merchant: parseAddress(fields[2]!, "Mandate.merchant"),
    token: parseAddress(fields[3]!, "Mandate.token"),
    maxAmount: parseI128(fields[4]!, "Mandate.max_amount"),
    intervalLedgers: parseU32(fields[5]!, "Mandate.interval_ledgers"),
    nextValidLedger: parseU32(fields[6]!, "Mandate.next_valid_ledger"),
    expiryLedger: parseU32(fields[7]!, "Mandate.expiry_ledger"),
    status: statusName as MandateStatus,
  };
}

/** Parses a `Vec<u64>` ScVal (e.g. registry listings) into bigint ids. */
export function parseU64Vec(value: xdr.ScVal, what = "u64 vector"): bigint[] {
  if (value.switch().value !== xdr.ScValType.scvVec().value) {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  return (value.vec() ?? []).map((item) => parseU64(item, what));
}

/** Parses a symbol ScVal (e.g. a token symbol) into a string. */
export function parseSymbol(value: xdr.ScVal, what = "symbol"): string {
  if (value.switch().value !== xdr.ScValType.scvSymbol().value) {
    throw new ContractCallError(`Unexpected ScVal for ${what}.`);
  }
  return value.sym().toString();
}

/**
 * Sets the signature expiration ledger on an authorization entry (its
 * credential node), so a wallet can sign the payload with the expiration the
 * SDK intends before submission. Returns a copy; the input is untouched.
 */
export function setEntryExpiration(entry: xdr.SorobanAuthorizationEntry, ledger: number): xdr.SorobanAuthorizationEntry {
  const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const credentials = clone.credentials();
  switch (inspectAuthEntry(clone).credentialType) {
    case "address":
      credentials.address().signatureExpirationLedger(ledger);
      break;
    case "addressV2":
      credentials.addressV2().signatureExpirationLedger(ledger);
      break;
    case "addressWithDelegates":
      credentials.addressWithDelegates().addressCredentials().signatureExpirationLedger(ledger);
      break;
    case "sourceAccount":
      break;
  }
  return clone;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shared write/read pipelines.
// ---------------------------------------------------------------------------

/**
 * An account that never exists on any network, used as the source for
 * read-only simulations where no real account is needed.
 */
export const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Common options for write operations. */
export interface WriteOptions {
  /** The wallet or keypair that signs the envelope (and, for owner-signed operations, the auth entries). */
  signer: Signer;
  /** The submitting account; defaults to `signer.publicKey`. */
  source?: string;
  /** Ledger at which prepared auth entries expire; defaults to `latestLedger + 100`. */
  validUntilLedger?: number;
  /** How long to wait for confirmation; defaults to 60 s. */
  timeoutMs?: number;
}

/** The outcome of a write operation. */
export interface WriteOutcome {
  txHash: string;
  ledger: number | null;
}

/**
 * Assembles `tx` with the simulation data and the given authorization
 * entries baked into the operation.
 *
 * This mirrors `rpc.assembleTransaction` (footprint, resource fee, sequence)
 * but injects caller-prepared auth entries: the authorization entries are
 * prepared after simulation (signed, or wrapped with the policy delegate for
 * CAP-71 charges), so they cannot come from the simulation directly. The
 * returned transaction is what gets signed and submitted.
 */
export function assembleWithAuth(
  tx: Transaction,
  sim: SorobanRpc.Api.SimulateTransactionSuccessResponse,
  auth: xdr.SorobanAuthorizationEntry[],
): Transaction {
  const op = tx.operations[0];
  if (op === undefined || op.type !== "invokeHostFunction") {
    throw new ContractCallError("The transaction has no invokeHostFunction operation.");
  }
  const builder = SorobanRpc.assembleTransaction(tx, sim);
  builder.clearOperations();
  builder.addOperation(Operation.invokeHostFunction({ func: op.func, auth }));
  return builder.build();
}

/**
 * Runs a write operation through the full pipeline and returns the
 * confirmed outcome plus the simulated retval (when the contract returns
 * one), which read-only clients can parse for result values such as the
 * newly created mandate id.
 */
export async function runWrite(
  ctx: ClientContext,
  method: string,
  args: xdr.ScVal[],
  opts: WriteOptions,
  prepareAuth: (entries: xdr.SorobanAuthorizationEntry[], validUntilLedger: number) => Promise<xdr.SorobanAuthorizationEntry[]>,
): Promise<{ outcome: WriteOutcome; retval: xdr.ScVal | null }> {
  const source = opts.source ?? opts.signer.publicKey;
  const tx = await ctx.buildInvocation(method, args, source);
  const sim = await ctx.simulateRecord(tx);
  const retval = sim.result?.retval ?? null;
  const validUntilLedger = opts.validUntilLedger ?? (await ctx.latestLedger()) + 100;
  const prepared = await prepareAuth(sim.result?.auth ?? [], validUntilLedger);
  const assembled = assembleWithAuth(tx, sim, prepared);
  // Validate the prepared authorization before signing and submitting, so
  // mandate rule violations surface as typed errors and no fee is wasted.
  await validatePreparedAuth(ctx, assembled);
  const signed = await ctx.signEnvelope(assembled, opts.signer);
  const outcome = await ctx.submitAndConfirm(signed, { timeoutMs: opts.timeoutMs });
  return { outcome, retval };
}

/**
 * Signs every address-type authorization entry with `signer` (the owner's
 * wallet for subrails-account operations) and leaves source-account entries
 * untouched. This is the owner-signed path: the account contract's
 * `__check_auth` verifies the owner's ed25519 signature over the payload.
 */
export async function signAddressEntries(
  ctx: ClientContext,
  entries: xdr.SorobanAuthorizationEntry[],
  signer: Signer,
  validUntilLedger: number,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  if (entries.length === 0) {
    return entries;
  }
  if (signer.signAuthEntry === undefined) {
    throw new ContractCallError(
      "This operation requires the owner to sign authorization entries; the provided signer does not implement signAuthEntry.",
    );
  }
  const prepared: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of entries) {
    if (inspectAuthEntry(entry).credentialType === "sourceAccount") {
      prepared.push(entry);
      continue;
    }
    const withExpiry = setEntryExpiration(entry, validUntilLedger);
    const { signedAuthEntry } = await signer.signAuthEntry(withExpiry.toXDR("base64"), {
      networkPassphrase: ctx.config.networkPassphrase,
    });
    prepared.push(xdr.SorobanAuthorizationEntry.fromXDR(signedAuthEntry, "base64"));
  }
  return prepared;
}

/**
 * Runs a read operation (a view) and parses the retval. Views need no
 * real source account, so a placeholder account with sequence 0 is used.
 */
export async function runRead<T>(
  ctx: ClientContext,
  method: string,
  args: xdr.ScVal[],
  parseResult: (retval: xdr.ScVal) => T,
): Promise<T> {
  const tx = await ctx.buildReadInvocation(method, args);
  const sim = await ctx.simulateRecord(tx);
  const retval = sim.result?.retval;
  if (retval === undefined) {
    throw new ContractCallError(`Read call ${method} returned no result.`);
  }
  return parseResult(retval);
}
