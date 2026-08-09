/**
 * Shared helpers for the SDK test suite: a fake RPC server (duck-typed to
 * the subset of `rpc.Server` the SDK uses), test configurations, and ScVal
 * factories for contract return values.
 */

import {
  Account,
  Address,
  Keypair,
  StrKey,
  SorobanDataBuilder,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";

import type { SdkConfig } from "../src/config.ts";
import { addressScVal, i128ScVal, u32ScVal, u64ScVal } from "../src/clients/base.ts";

/** Builds a valid contract id strkey from a single repeated byte. */
export function contractId(byte: number): string {
  return StrKey.encodeContract(Buffer.from(new Uint8Array(32).fill(byte)));
}

/** A test SdkConfig with deterministic contract ids. */
export function testConfig(overrides: Partial<SdkConfig> = {}): SdkConfig {
  return {
    network: "testnet",
    rpcUrl: "http://fake-rpc.invalid",
    networkPassphrase: "Test SDF Network ; September 2015",
    protocol27: true,
    mandatePolicyId: contractId(1),
    subrailsAccountWasmHash: "ab".repeat(32),
    mandateRegistryId: contractId(2),
    ...overrides,
  };
}

/** A successful simulation response with the given retval and auth entries. */
export function successSimulation(
  retval: xdr.ScVal,
  auth: xdr.SorobanAuthorizationEntry[] = [],
): rpc.Api.SimulateTransactionResponse {
  return {
    id: "1",
    latestLedger: 1000,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "100",
    result: { auth, retval },
    events: [],
    _parsed: true,
  } as rpc.Api.SimulateTransactionResponse;
}

/** A failed simulation response carrying an RPC error message. */
export function errorSimulation(message: string): rpc.Api.SimulateTransactionResponse {
  return {
    id: "1",
    latestLedger: 1000,
    error: message,
    events: [],
    _parsed: true,
  } as rpc.Api.SimulateTransactionResponse;
}

/** Builds an address-credential auth entry (legacy ADDRESS) for `address`. */
export function addressEntryFor(
  address: string,
  invocation: xdr.SorobanAuthorizedInvocation,
  nonce = 5n,
): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(address).toScAddress(),
        nonce: new xdr.Int64(nonce),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
  });
}

/** Builds the invocation tree for a token `transfer` call. */
export function transferInvocation(params: {
  token: string;
  from: string;
  to: string;
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

/** Builds the mandate-policy `Mandate` struct ScVal (nine fields, in order). */
export function mandateScVal(overrides: {
  mandateId?: bigint;
  account?: string;
  merchant?: string;
  token?: string;
  maxAmount?: bigint;
  intervalLedgers?: number;
  nextValidLedger?: number;
  expiryLedger?: number;
  status?: "Active" | "Revoked" | "Expired";
} = {}): xdr.ScVal {
  return xdr.ScVal.scvVec([
    u64ScVal(overrides.mandateId ?? 1n),
    addressScVal(overrides.account ?? contractId(10)),
    addressScVal(overrides.merchant ?? Keypair.random().publicKey()),
    addressScVal(overrides.token ?? contractId(11)),
    i128ScVal(overrides.maxAmount ?? 1_000_000n),
    u32ScVal(overrides.intervalLedgers ?? 100),
    u32ScVal(overrides.nextValidLedger ?? 0),
    u32ScVal(overrides.expiryLedger ?? 10_000),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(overrides.status ?? "Active")]),
  ]);
}

/**
 * A fake RPC server implementing just the methods the SDK clients use.
 *
 * - `authEntries` are returned for "record"-mode simulations,
 * - `retval` is the simulated result,
 * - `enforceError` makes "enforce"-mode simulations fail with that message
 *   (used to test typed contract-error mapping),
 * - the last submitted transaction is captured on `submitted`.
 */
export class FakeServer {
  submitted: Transaction | null = null;
  authEntries: xdr.SorobanAuthorizationEntry[] = [];
  retval: xdr.ScVal = xdr.ScVal.scvVoid();
  enforceError: string | null = null;
  /** One entry per simulateTransaction call: { authMode, useUpgradedAuth }. */
  simulateCalls: Array<{ authMode?: string; useUpgradedAuth?: boolean }> = [];
  ledger = 1000;
  confirmationLedger = 1001;

  async getAccount(address: string): Promise<Account> {
    return new Account(address, "100");
  }

  async getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return { sequence: this.ledger } as rpc.Api.GetLatestLedgerResponse;
  }

  async simulateTransaction(
    _tx: Transaction,
    _addlResources?: unknown,
    authMode?: string,
    useUpgradedAuth?: boolean,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    this.simulateCalls.push({ authMode, useUpgradedAuth });
    if (authMode === "enforce" && this.enforceError !== null) {
      return errorSimulation(this.enforceError);
    }
    return successSimulation(this.retval, authMode === "record" ? this.authEntries : []);
  }

  async sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse> {
    this.submitted = tx;
    return {
      status: "PENDING",
      hash: "0000000000000000000000000000000000000000000000000000000000000000",
      latestLedger: this.ledger,
      latestLedgerCloseTime: 0,
      oldestLedger: 1,
      oldestLedgerCloseTime: 0,
    } as rpc.Api.SendTransactionResponse;
  }

  async getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    return {
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      txHash: hash,
      ledger: this.confirmationLedger,
      latestLedger: this.ledger,
      latestLedgerCloseTime: 0,
      oldestLedger: 1,
      oldestLedgerCloseTime: 0,
      createdAt: 0,
      applicationOrder: 0,
      feeBump: false,
    } as rpc.Api.GetTransactionResponse;
  }
}

/** A random G... account address. */
export function randomAddress(): string {
  return Keypair.random().publicKey();
}

/** The authorization entries of a submitted invokeHostFunction operation. */
export function operationAuth(tx: Transaction): xdr.SorobanAuthorizationEntry[] {
  const op = tx.operations[0];
  if (op === undefined || op.type !== "invokeHostFunction") {
    return [];
  }
  return op.auth ?? [];
}
