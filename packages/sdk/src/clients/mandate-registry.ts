/**
 * Client for the mandate-registry contract.
 *
 * The registry is an admin-maintained index of mandates by account and by
 * merchant. It makes "what mandates does this party have" queries cheap,
 * which the indexer's read API and the reference frontend rely on.
 */

import type { SdkConfig } from "../config.ts";
import type { AddressString } from "../types.ts";
import {
  ClientContext,
  addressScVal,
  parseU64Vec,
  runRead,
  runWrite,
  u64ScVal,
} from "./base.ts";
import type { Signer, WriteOptions, WriteOutcome } from "./base.ts";

/**
 * Client for the mandate-registry contract.
 *
 * Maps to `initialize`, `index_mandate`, `list_by_account`, and
 * `list_by_merchant`.
 */
export class MandateRegistryClient {
  private readonly ctx: ClientContext;

  /**
   * @param config - SDK configuration (RPC, network, contract ids)
   * @param opts - override the contract id (defaults to `config.mandateRegistryId`)
   *   and inject a test server
   */
  constructor(config: SdkConfig, opts: { contractId?: string; server?: import("@stellar/stellar-sdk").rpc.Server } = {}) {
    this.ctx = new ClientContext({ config, contractId: opts.contractId ?? config.mandateRegistryId, server: opts.server });
  }

  /** The network's current ledger sequence. */
  ledger(): Promise<number> {
    return this.ctx.latestLedger();
  }

  /**
   * Records a mandate in the registry.
   *
   * Maps to the `index_mandate` contract function (write). Auth: the admin
   * (who is normally the transaction's submitting account, so the envelope
   * signature covers it).
   *
   * @throws typed errors mapped from contract codes
   */
  async indexMandate(
    params: { mandateId: bigint; account: AddressString; merchant: AddressString },
    opts: WriteOptions & { signer: Signer },
  ): Promise<WriteOutcome> {
    const { outcome } = await runWrite(
      this.ctx,
      "index_mandate",
      [u64ScVal(params.mandateId), addressScVal(params.account), addressScVal(params.merchant)],
      opts,
      (entries) => Promise.resolve(entries),
    );
    return outcome;
  }

  /**
   * Lists the mandate ids recorded for an account.
   *
   * Maps to the `list_by_account` contract function (view).
   */
  listByAccount(account: AddressString): Promise<bigint[]> {
    return runRead(this.ctx, "list_by_account", [addressScVal(account)], parseU64Vec);
  }

  /**
   * Lists the mandate ids recorded for a merchant.
   *
   * Maps to the `list_by_merchant` contract function (view).
   */
  listByMerchant(merchant: AddressString): Promise<bigint[]> {
    return runRead(this.ctx, "list_by_merchant", [addressScVal(merchant)], parseU64Vec);
  }
}
