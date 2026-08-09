/**
 * Client for the subrails-account contract.
 *
 * The subrails-account is a Protocol 27 custom smart account, one instance
 * per subscriber. The owner (an ed25519 keypair, i.e. the subscriber's
 * wallet) controls it. Recurring charges are authorized without the owner's
 * signature through CAP-71 delegation to the mandate-policy contract; every
 * other operation (initialize, register_mandate, revoke) requires the
 * owner's signature through the account's `__check_auth`.
 *
 * Each subscriber has their own account instance, so the account contract id
 * is not a workspace constant: it is produced by {@link deployAccount} and
 * passed to the other methods.
 *
 * Note on deployment: the contract wants `initialize` called in the same
 * transaction as deployment so a front-runner cannot claim the account with
 * their own owner key. The SDK exposes deployment and initialization as two
 * calls (the deploy transaction returns the new account id); a
 * same-transaction deploy-and-initialize is a future enhancement once
 * multi-operation Soroban transactions are uniformly supported by the RPC
 * tooling this SDK builds on.
 */

import {
  Address,
  BASE_FEE,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";

import { requireFilled } from "../config.ts";
import type { SdkConfig } from "../config.ts";
import { ContractCallError, mapContractError } from "../errors.ts";
import type { AddressString } from "../types.ts";
import {
  ClientContext,
  addressScVal,
  parseAddress,
  runWrite,
  signAddressEntries,
  u64ScVal,
} from "./base.ts";
import type { Signer, WriteOptions, WriteOutcome } from "./base.ts";

/** Result of {@link SubrailsAccountClient.deployAccount}. */
export interface DeployAccountResult extends WriteOutcome {
  /** The contract id of the newly deployed account. */
  accountId: AddressString;
}

/**
 * Client for the subrails-account contract.
 *
 * Maps to `initialize`, `register_mandate`, and the contract deployment
 * (createCustomContract with the installed wasm from
 * `config.subrailsAccountWasmHash`).
 */
export class SubrailsAccountClient {
  private readonly config: SdkConfig;
  private readonly server: SorobanRpc.Server;

  /**
   * @param config - SDK configuration (RPC, network, wasm hash)
   * @param opts - inject a test server
   */
  constructor(config: SdkConfig, opts: { server?: SorobanRpc.Server } = {}) {
    this.config = config;
    this.server =
      opts.server ??
      new SorobanRpc.Server(config.rpcUrl, {
        allowHttp: config.rpcUrl.startsWith("http://"),
      });
  }

  /** The network's current ledger sequence. */
  ledger(): Promise<number> {
    return this.server.getLatestLedger().then((r) => r.sequence);
  }

  /**
   * Deploys a new subrails-account instance from the installed wasm.
   *
   * Maps to the `createCustomContract` operation (write). The deployer (the
   * owner's wallet, `opts.signer`) funds the deployment and signs the
   * envelope. The new account's contract id is derived from the deployer
   * address, the salt (random unless provided), and the wasm hash, and is
   * returned from the transaction retval.
   *
   * @returns the new account id plus the transaction outcome
   */
  async deployAccount(
    params: {
      /** Ed25519 public key of the controlling owner, as a G... strkey. */
      owner: AddressString;
      /** The mandate-policy contract id this account delegates charges to. */
      policyContract: AddressString;
      /** Optional 32-byte salt; a random one is used when omitted. */
      salt?: Buffer;
    },
    opts: WriteOptions & { signer: Signer },
  ): Promise<DeployAccountResult> {
    requireFilled(this.config.subrailsAccountWasmHash, "SUBRAILS_ACCOUNT_WASM_HASH");
    const source = opts.source ?? opts.signer.publicKey;
    const wasmHash = Buffer.from(this.config.subrailsAccountWasmHash, "hex");
    if (wasmHash.length !== 32) {
      throw new ContractCallError("SUBRAILS_ACCOUNT_WASM_HASH must be a 32-byte hex wasm hash.");
    }
    if (params.salt !== undefined && params.salt.length !== 32) {
      throw new ContractCallError("The deployment salt must be 32 bytes.");
    }

    const account = await this.server.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .setTimeout(300)
      .addOperation(
        Operation.createCustomContract({
          address: new Address(source),
          wasmHash,
          salt: params.salt,
          constructorArgs: [],
        }),
      )
      .build();

    let sim;
    try {
      sim = await this.server.simulateTransaction(tx, undefined, "record", this.config.protocol27);
    } catch (cause) {
      throw mapContractError(cause);
    }
    if (!("result" in sim) || sim.result === undefined) {
      throw mapContractError(new Error("Account deployment simulation failed."));
    }
    const accountId = parseAddress(sim.result.retval, "deployment retval");

    const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
    const signed = await this.signEnvelope(assembled, opts.signer);
    const outcome = await this.confirm(signed, opts.timeoutMs);
    return { ...outcome, accountId };
  }

  /**
   * Initializes a deployed account with its owner and policy contract.
   *
   * Maps to the `initialize` contract function (write). Auth: none (the
   * one-time `Initialized` flag is the guard; the deployer should call this
   * immediately after deployment). `owner` is the raw 32-byte ed25519 public
   * key of the controlling wallet.
   */
  async initialize(
    params: { accountId: AddressString; owner: AddressString; policyContract: AddressString },
    opts: WriteOptions & { signer: Signer },
  ): Promise<WriteOutcome> {
    const ctx = this.contextFor(params.accountId);
    const { outcome } = await runWrite(
      ctx,
      "initialize",
      [xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(params.owner)), addressScVal(params.policyContract)],
      opts,
      (entries) => Promise.resolve(entries),
    );
    return outcome;
  }

  /**
   * Registers a mandate id on the account so its charges can be delegated to
   * the policy contract.
   *
   * Maps to the `register_mandate` contract function (write). Auth: the
   * account's own authorization, i.e. the owner's ed25519 signature through
   * `__check_auth`; pass the owner's wallet as `opts.signer`.
   */
  async registerMandate(
    params: { accountId: AddressString; mandateId: bigint },
    opts: WriteOptions & { signer: Signer },
  ): Promise<WriteOutcome> {
    const ctx = this.contextFor(params.accountId);
    const { outcome } = await runWrite(
      ctx,
      "register_mandate",
      [u64ScVal(params.mandateId)],
      opts,
      (entries, validUntil) => signAddressEntries(ctx, entries, opts.signer, validUntil),
    );
    return outcome;
  }

  private contextFor(accountId: AddressString): ClientContext {
    return new ClientContext({
      config: this.config,
      contractId: accountId,
      server: this.server,
    });
  }

  private async signEnvelope(tx: import("@stellar/stellar-sdk").Transaction, signer: Signer) {
    const { signedTxXdr } = await signer.signTransaction(tx.toXDR(), {
      networkPassphrase: this.config.networkPassphrase,
    });
    return TransactionBuilder.fromXDR(signedTxXdr, this.config.networkPassphrase) as import("@stellar/stellar-sdk").Transaction;
  }

  private async confirm(tx: import("@stellar/stellar-sdk").Transaction, timeoutMs?: number) {
    const send = await this.server.sendTransaction(tx);
    if (send.status === "ERROR") {
      throw mapContractError(new Error("Account deployment submission failed."));
    }
    const deadline = Date.now() + (timeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      const result = await this.server.getTransaction(send.hash);
      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return { txHash: send.hash, ledger: result.ledger };
      }
      if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw mapContractError(new Error(`Account deployment failed on ledger ${result.ledger}.`));
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new ContractCallError(`Account deployment ${send.hash} was not confirmed within the timeout.`);
  }
}
