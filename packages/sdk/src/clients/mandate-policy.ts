/**
 * Client for the mandate-policy contract.
 *
 * The mandate-policy contract is the core of Subrails: it stores the
 * recurring-payment authorizations (caps, cadence, expiry) that the account's
 * delegated authorization checks enforce at charge time.
 *
 * Writes flow through {@link runWrite}: build, simulate, prepare
 * authorization entries (signed by the caller's {@link Signer}), sign the
 * envelope, submit, and confirm. Views flow through {@link runRead}.
 */

import type { SdkConfig } from "../config.ts";
import type { AddressString, Mandate } from "../types.ts";
import {
  ClientContext,
  addressScVal,
  i128ScVal,
  parseMandate,
  parseU64,
  runRead,
  runWrite,
  signAddressEntries,
  u32ScVal,
  u64ScVal,
} from "./base.ts";
import type { Signer, WriteOptions, WriteOutcome } from "./base.ts";

/** Result of {@link MandatePolicyClient.createMandate}. */
export interface CreateMandateResult extends WriteOutcome {
  /** The id of the newly created mandate, starting at 1. */
  mandateId: bigint;
}

/**
 * A mandate-authorization grant: the account lets `merchant` pull up to
 * `maxAmount` of `token`, at most once every `intervalLedgers`, until
 * `expiryLedger`.
 */
export interface CreateMandateParams {
  /** The account being charged (a subrails-account contract id, typically). */
  account: AddressString;
  /** The merchant authorized to charge. */
  merchant: AddressString;
  /** The token the charges are denominated in. */
  token: AddressString;
  /** Maximum amount per charge, in token base units. Must be positive. */
  maxAmount: bigint;
  /** Minimum number of ledgers between charges. Must be positive. */
  intervalLedgers: number;
  /** The ledger after which no charge is allowed. Must be in the future. */
  expiryLedger: number;
}

/**
 * Client for the mandate-policy contract.
 *
 * Maps to the `create_mandate`, `revoke_mandate`, and `get_mandate` contract
 * functions. All contract error codes surface as typed
 * {@link import("../errors.ts").SubrailsError} subclasses.
 */
export class MandatePolicyClient {
  private readonly ctx: ClientContext;

  /**
   * @param config - SDK configuration (RPC, network, contract ids)
   * @param opts - override the contract id (defaults to `config.mandatePolicyId`)
   *   and inject a test server
   */
  constructor(config: SdkConfig, opts: { contractId?: string; server?: import("@stellar/stellar-sdk").rpc.Server } = {}) {
    this.ctx = new ClientContext({ config, contractId: opts.contractId ?? config.mandatePolicyId, server: opts.server });
  }

  /** The network's current ledger sequence. */
  ledger(): Promise<number> {
    return this.ctx.latestLedger();
  }

  /**
   * Creates a new Active mandate.
   *
   * Maps to the `create_mandate` contract function (write). Auth: the
   * `account` must authorize, which for a subrails-account means the owner
   * signs through the account's `__check_auth`; pass the owner's wallet as
   * `opts.signer`.
   *
   * @returns the new mandate id plus the transaction outcome
   * @throws typed errors mapped from contract codes (InvalidAmount,
   *   InvalidInterval, InvalidExpiry, DuplicateMandate, ...)
   */
  async createMandate(params: CreateMandateParams, opts: WriteOptions & { signer: Signer }): Promise<CreateMandateResult> {
    const { outcome, retval } = await runWrite(
      this.ctx,
      "create_mandate",
      [
        addressScVal(params.account),
        addressScVal(params.merchant),
        addressScVal(params.token),
        i128ScVal(params.maxAmount),
        u32ScVal(params.intervalLedgers),
        u32ScVal(params.expiryLedger),
      ],
      opts,
      (entries, validUntil) => signAddressEntries(this.ctx, entries, opts.signer, validUntil),
    );
    if (retval === null) {
      throw new Error("create_mandate returned no result.");
    }
    return { ...outcome, mandateId: parseU64(retval, "create_mandate retval") };
  }

  /**
   * Revokes an Active mandate.
   *
   * Maps to the `revoke_mandate` contract function (write). Auth: the
   * mandate's account must authorize (the contract requires the account, not
   * the merchant, to revoke; see the contract's documented deviation from
   * the original spec). Pass the account owner's wallet as `opts.signer`.
   *
   * @throws MandateNotFound, AlreadyResolved, ...
   */
  async revokeMandate(mandateId: bigint, opts: WriteOptions & { signer: Signer }): Promise<WriteOutcome> {
    const { outcome } = await runWrite(
      this.ctx,
      "revoke_mandate",
      [u64ScVal(mandateId)],
      opts,
      (entries, validUntil) => signAddressEntries(this.ctx, entries, opts.signer, validUntil),
    );
    return outcome;
  }

  /**
   * Reads a mandate by id.
   *
   * Maps to the `get_mandate` contract function (view). No auth required.
   *
   * @throws MandateNotFound if no mandate exists with that id
   */
  getMandate(mandateId: bigint): Promise<Mandate> {
    return runRead(this.ctx, "get_mandate", [u64ScVal(mandateId)], parseMandate);
  }
}
