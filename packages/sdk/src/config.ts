/**
 * SDK configuration: network selection, RPC endpoints, deployed contract
 * ids, and the Protocol 27 (CAP-71) gate.
 *
 * All values can be supplied directly via {@link SdkConfig} or loaded from
 * the environment with {@link loadConfigFromEnv}. Contract ids and the
 * subrails-account wasm hash are placeholders until the contracts are
 * deployed; the SDK only rejects them when an operation actually needs them.
 */

import { InvalidConfigError } from "./errors.ts";
import type { NetworkName } from "./types.ts";

/** Built-in defaults per network. */
export const DEFAULT_NETWORKS: Readonly<Record<NetworkName, { rpcUrl: string; networkPassphrase: string }>> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

/**
 * The default Protocol 27 setting per network.
 *
 * CAP-71 (delegated credentials) is activated on a network by an upgrade
 * vote. Testnet has activated it; mainnet is assumed not to until proven
 * otherwise. Every consumer can override this through `protocol27` or the
 * `SUBRAILS_PROTOCOL27` environment variable.
 */
export const DEFAULT_PROTOCOL27: Readonly<Record<NetworkName, boolean>> = {
  testnet: true,
  mainnet: false,
};

/**
 * Fully resolved SDK configuration.
 *
 * `protocol27` gates CAP-71 delegated credentials: when `true`, the SDK opts
 * into `ADDRESS_V2` and `ADDRESS_WITH_DELEGATES` credential types; when
 * `false`, it uses legacy `ADDRESS` credentials and refuses delegated charges.
 */
export interface SdkConfig {
  /** The Stellar network this SDK talks to. */
  network: NetworkName;
  /** Soroban RPC endpoint. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** CAP-71 (Protocol 27) delegated credentials on or off. */
  protocol27: boolean;
  /** The mandate-policy contract id. Empty until the contracts are deployed. */
  mandatePolicyId: string;
  /** The installed subrails-account wasm hash. Empty until deployment. */
  subrailsAccountWasmHash: string;
  /** The mandate-registry contract id. Empty until the contracts are deployed. */
  mandateRegistryId: string;
}

/** A minimal object that can stand in for `process.env` in any runtime. */
export type EnvLike = Record<string, string | undefined>;

/**
 * Loads and validates {@link SdkConfig} from an environment object.
 *
 * `rpcUrl` and `networkPassphrase` fall back to the built-in defaults for the
 * configured network. Contract ids are kept as-is (they may be blank until
 * deployment). `SUBRAILS_PROTOCOL27` overrides the per-network default.
 *
 * @param env - the environment to read (defaults to `process.env`)
 * @throws {@link InvalidConfigError} if the network is unknown
 */
export function loadConfigFromEnv(env: EnvLike = readProcessEnv()): SdkConfig {
  const network = parseNetwork(env.SUBRAILS_NETWORK);
  const defaults = DEFAULT_NETWORKS[network];
  const protocol27 = env.SUBRAILS_PROTOCOL27 === undefined
    ? DEFAULT_PROTOCOL27[network]
    : parseBool(env.SUBRAILS_PROTOCOL27, "SUBRAILS_PROTOCOL27");
  return {
    network,
    rpcUrl: env.SUBRAILS_RPC_URL ?? defaults.rpcUrl,
    networkPassphrase: env.SUBRAILS_NETWORK_PASSPHRASE ?? defaults.networkPassphrase,
    protocol27,
    mandatePolicyId: env.MANDATE_POLICY_ID ?? "",
    subrailsAccountWasmHash: env.SUBRAILS_ACCOUNT_WASM_HASH ?? "",
    mandateRegistryId: env.MANDATE_REGISTRY_ID ?? "",
  };
}

/**
 * Asserts that a contract id or wasm hash has been filled in.
 *
 * Contract ids are placeholders until the contracts are deployed, so the SDK
 * refuses to use an empty one at the point of use rather than at load time.
 */
export function requireFilled(value: string, what: string): void {
  if (value.trim().length === 0) {
    throw new InvalidConfigError(
      `${what} is not configured. Deploy the contracts and fill in the corresponding environment variable.`,
    );
  }
}

function parseNetwork(raw: string | undefined): NetworkName {
  if (raw === "testnet" || raw === "mainnet") {
    return raw;
  }
  throw new InvalidConfigError(
    `SUBRAILS_NETWORK must be "testnet" or "mainnet", got ${raw === undefined ? "(unset)" : JSON.stringify(raw)}.`,
  );
}

function parseBool(raw: string, name: string): boolean {
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  throw new InvalidConfigError(`${name} must be "true" or "false", got ${JSON.stringify(raw)}.`);
}

function readProcessEnv(): EnvLike {
  // Safe in browsers and workers, where process.env is undefined.
  return typeof process !== "undefined" ? process.env : {};
}
