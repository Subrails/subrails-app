/**
 * Frontend configuration, read from NEXT_PUBLIC_ environment variables at
 * build time and inlined into the client bundle.
 *
 * The contract ids and the subrails-account wasm hash are placeholders until
 * the contracts are deployed; the UI surfaces a setup notice and disables
 * on-chain actions while they are empty.
 */

import { DEFAULT_NETWORKS, DEFAULT_PROTOCOL27 } from "@subrails/sdk";
import type { NetworkName, SdkConfig } from "@subrails/sdk";

export type { SdkConfig } from "@subrails/sdk";

export interface WebConfig {
  /** The Stellar network this frontend points at. */
  network: NetworkName;
  /** The SDK configuration derived from the public environment. */
  sdk: SdkConfig;
  /** Base URL of the indexer read API. */
  indexerUrl: string;
  /** The mandate-policy contract id, or "" when not yet deployed. */
  policyId: string;
  /** The mandate-registry contract id, or "" when not yet deployed. */
  registryId: string;
  /** The installed subrails-account wasm hash, or "" when not yet deployed. */
  accountWasmHash: string;
  /** True when every contract-dependent action can run. */
  contractsDeployed: boolean;
}

export function loadWebConfig(): WebConfig {
  const network: NetworkName =
    process.env.NEXT_PUBLIC_SUBRAILS_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const defaults = DEFAULT_NETWORKS[network];
  const policyId = (process.env.NEXT_PUBLIC_MANDATE_POLICY_ID ?? "").trim();
  const registryId = (process.env.NEXT_PUBLIC_MANDATE_REGISTRY_ID ?? "").trim();
  const accountWasmHash = (process.env.NEXT_PUBLIC_SUBRAILS_ACCOUNT_WASM_HASH ?? "").trim();
  const sdk: SdkConfig = {
    network,
    rpcUrl: process.env.NEXT_PUBLIC_SUBRAILS_RPC_URL ?? defaults.rpcUrl,
    networkPassphrase: defaults.networkPassphrase,
    protocol27: DEFAULT_PROTOCOL27[network],
    mandatePolicyId: policyId,
    subrailsAccountWasmHash: accountWasmHash,
    mandateRegistryId: registryId,
  };
  return {
    network,
    sdk,
    indexerUrl: (process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:8080").replace(/\/+$/, ""),
    policyId,
    registryId,
    accountWasmHash,
    contractsDeployed: policyId.length > 0 && registryId.length > 0,
  };
}
