/**
 * Builds the SDK contract clients the reference UI talks to. Each client is
 * cheap to construct and stateless, so callers build one per operation.
 */

import { MandatePolicyClient, MandateRegistryClient, SubrailsAccountClient, TokenClient } from "@subrails/sdk";
import type { SdkConfig } from "@subrails/sdk";

export function policyClient(config: SdkConfig): MandatePolicyClient {
  return new MandatePolicyClient(config);
}

export function accountClient(config: SdkConfig): SubrailsAccountClient {
  return new SubrailsAccountClient(config);
}

export function registryClient(config: SdkConfig): MandateRegistryClient {
  return new MandateRegistryClient(config);
}

export function tokenClient(config: SdkConfig, tokenId: string): TokenClient {
  return new TokenClient(config, { tokenId });
}
