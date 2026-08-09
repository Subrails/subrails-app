/**
 * Minimal client for a standard Soroban token contract.
 *
 * Subrails charges are token `transfer`s out of the subscriber's smart
 * account, and the demo flow needs to fund the account (transfer tokens in)
 * and show balances. This client covers just those pieces plus the metadata
 * views the frontend uses for display. It implements the token interface by
 * hand, so no spec or codegen is required.
 */

import type { SdkConfig } from "../config.ts";
import type { AddressString } from "../types.ts";
import {
  ClientContext,
  addressScVal,
  i128ScVal,
  parseI128,
  parseSymbol,
  parseU32,
  runRead,
  runWrite,
} from "./base.ts";
import type { Signer, WriteOptions, WriteOutcome } from "./base.ts";

/**
 * Client for a Soroban token contract.
 *
 * Maps to the token interface's `transfer`, `balance`, `symbol`, and
 * `decimals` functions.
 */
export class TokenClient {
  private readonly ctx: ClientContext;

  /**
   * @param config - SDK configuration (RPC, network)
   * @param opts - the token contract id to talk to, plus an optional test server
   */
  constructor(config: SdkConfig, opts: { tokenId: string; server?: import("@stellar/stellar-sdk").rpc.Server }) {
    this.ctx = new ClientContext({ config, contractId: opts.tokenId, server: opts.server });
  }

  /** The network's current ledger sequence. */
  ledger(): Promise<number> {
    return this.ctx.latestLedger();
  }

  /**
   * Transfers `amount` of the token from `from` to `to`.
   *
   * Maps to the token `transfer` function (write). Auth: `from` must
   * authorize. When `from` is the submitting account the envelope signature
   * is enough; when `from` is a contract (e.g. a subrails-account), the
   * caller is responsible for attaching a valid authorization entry, which
   * is exactly what the delegated charge helper does.
   */
  async transfer(
    params: { from: AddressString; to: AddressString; amount: bigint },
    opts: WriteOptions & { signer: Signer },
  ): Promise<WriteOutcome> {
    const { outcome } = await runWrite(
      this.ctx,
      "transfer",
      [addressScVal(params.from), addressScVal(params.to), i128ScVal(params.amount)],
      opts,
      (entries) => Promise.resolve(entries),
    );
    return outcome;
  }

  /** Reads a token balance, in token base units (i128 as bigint). */
  balance(address: AddressString): Promise<bigint> {
    return runRead(this.ctx, "balance", [addressScVal(address)], (retval) => parseI128(retval, "balance"));
  }

  /** Reads the token symbol (e.g. "USDC"). */
  symbol(): Promise<string> {
    return runRead(this.ctx, "symbol", [], (retval) => parseSymbol(retval, "symbol"));
  }

  /** Reads the token decimals (for display formatting at the UI edge). */
  decimals(): Promise<number> {
    return runRead(this.ctx, "decimals", [], (retval) => parseU32(retval, "decimals"));
  }
}
