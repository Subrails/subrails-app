/**
 * Core data types shared across the Subrails SDK.
 *
 * Token amounts are `i128` in token base units and are represented as
 * `bigint` end to end. Ledger numbers are `u32` and are represented as
 * `number`. Addresses are Stellar strkeys (`G...` accounts or `C...`
 * contracts) and are represented as strings.
 */

/** A Stellar account (`G...`) or contract (`C...`) address string. */
export type AddressString = string;

/** Supported Stellar networks. */
export type NetworkName = "testnet" | "mainnet";

/**
 * Lifecycle status of a mandate.
 *
 * Only `"Active"` mandates authorize charges. `"Revoked"` and `"Expired"`
 * mandates reject every charge attempt.
 */
export type MandateStatus = "Active" | "Revoked" | "Expired";

/**
 * A recurring-payment authorization granted by `account` to `merchant`.
 *
 * Mirrors the `Mandate` struct returned by the mandate-policy contract's
 * `get_mandate` view.
 *
 * - `maxAmount`: maximum authorized per charge, in token base units.
 * - `intervalLedgers`: minimum number of ledgers between charges.
 * - `nextValidLedger`: earliest ledger at which the next charge may be
 *   authorized; advanced by `intervalLedgers` on every successful charge.
 * - `expiryLedger`: the ledger after which no charge is allowed.
 */
export interface Mandate {
  mandateId: bigint;
  account: AddressString;
  merchant: AddressString;
  token: AddressString;
  maxAmount: bigint;
  intervalLedgers: number;
  nextValidLedger: number;
  expiryLedger: number;
  status: MandateStatus;
}

/**
 * The outcome of a submitted merchant charge.
 *
 * `ledger` is `null` until the transaction is confirmed on-chain.
 */
export interface ChargeResult {
  /** The mandate the charge was validated against. */
  mandateId: bigint;
  /** Amount charged, in token base units. */
  amount: bigint;
  /** Hash of the submitted transaction. */
  txHash: string;
  /** Ledger in which the charge was applied, once confirmed. */
  ledger: number | null;
}
