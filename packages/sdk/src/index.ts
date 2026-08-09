/**
 * Subrails SDK: typed client for the Subrails recurring-authorization
 * contracts on Stellar, including the CAP-71 delegated charge path.
 *
 * Entry points:
 * - {@link loadConfigFromEnv} / {@link SdkConfig}: network and contract configuration
 * - {@link MandatePolicyClient}: create, revoke, and read mandates
 * - {@link SubrailsAccountClient}: deploy and initialize a smart account, register mandates
 * - {@link MandateRegistryClient}: index and list mandates by party
 * - {@link TokenClient}: fund the account and read balances (token interface)
 * - {@link charge} / {@link prepareChargeAuth}: the Protocol 27 (CAP-71) merchant charge path
 */

export { loadConfigFromEnv, requireFilled, DEFAULT_NETWORKS, DEFAULT_PROTOCOL27 } from "./config.ts";
export type { SdkConfig, EnvLike } from "./config.ts";
export * from "./types.ts";
export * from "./errors.ts";
export { MandatePolicyClient } from "./clients/mandate-policy.ts";
export type { CreateMandateParams, CreateMandateResult } from "./clients/mandate-policy.ts";
export { SubrailsAccountClient } from "./clients/subrails-account.ts";
export type { DeployAccountResult } from "./clients/subrails-account.ts";
export { MandateRegistryClient } from "./clients/mandate-registry.ts";
export { TokenClient } from "./clients/token.ts";
export {
  ClientContext,
  KeypairSigner,
  addressScVal,
  i128ScVal,
  parseAddress,
  parseEnumName,
  parseI128,
  parseMandate,
  parseSymbol,
  parseU32,
  parseU64,
  parseU64Vec,
  runRead,
  runWrite,
  setEntryExpiration,
  signAddressEntries,
  u32ScVal,
  u64ScVal,
} from "./clients/base.ts";
export type {
  Signer,
  WriteOptions,
  WriteOutcome,
  ClientContextOptions,
} from "./clients/base.ts";
export {
  buildOwnerAuthEntry,
  buildTransferInvocation,
  charge,
  prepareChargeAuth,
  requireProtocol27,
  wrapWithPolicyDelegate,
} from "./auth/delegated-charge.ts";
export type {
  ChargeParams,
  DelegateWrapParams,
  PrepareChargeAuthParams,
} from "./auth/delegated-charge.ts";
