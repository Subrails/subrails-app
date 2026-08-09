/**
 * Subrails SDK: typed client for the Subrails recurring-authorization
 * contracts on Stellar, including the CAP-71 delegated charge path.
 *
 * Entry points:
 * - {@link loadConfigFromEnv} / {@link SdkConfig}: network and contract configuration
 * - {@link MandatePolicyClient}: create, revoke, and read mandates
 * - {@link SubrailsAccountClient}: initialize and register mandates on a smart account
 * - {@link MandateRegistryClient}: index and list mandates by party
 * - {@link prepareDelegatedChargeAuth}: the Protocol 27 (CAP-71) merchant charge path
 */

export { loadConfigFromEnv, requireFilled, DEFAULT_NETWORKS, DEFAULT_PROTOCOL27 } from "./config.ts";
export type { SdkConfig, EnvLike } from "./config.ts";
export * from "./types.ts";
export * from "./errors.ts";
