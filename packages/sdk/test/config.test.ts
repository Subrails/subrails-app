import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_NETWORKS, loadConfigFromEnv, requireFilled } from "../src/config.ts";
import { InvalidConfigError } from "../src/errors.ts";

test("loads testnet defaults from an empty environment", () => {
  const config = loadConfigFromEnv({ SUBRAILS_NETWORK: "testnet" });
  assert.equal(config.network, "testnet");
  assert.equal(config.rpcUrl, DEFAULT_NETWORKS.testnet.rpcUrl);
  assert.equal(config.networkPassphrase, DEFAULT_NETWORKS.testnet.networkPassphrase);
});

test("protocol27 defaults on per network and can be overridden", () => {
  assert.equal(loadConfigFromEnv({ SUBRAILS_NETWORK: "testnet" }).protocol27, true);
  assert.equal(loadConfigFromEnv({ SUBRAILS_NETWORK: "mainnet" }).protocol27, false);
  assert.equal(loadConfigFromEnv({ SUBRAILS_NETWORK: "testnet", SUBRAILS_PROTOCOL27: "false" }).protocol27, false);
  assert.equal(loadConfigFromEnv({ SUBRAILS_NETWORK: "mainnet", SUBRAILS_PROTOCOL27: "true" }).protocol27, true);
});

test("env values override the network defaults", () => {
  const config = loadConfigFromEnv({
    SUBRAILS_NETWORK: "testnet",
    SUBRAILS_RPC_URL: "https://rpc.example.com",
    SUBRAILS_NETWORK_PASSPHRASE: "Custom Passphrase",
    MANDATE_POLICY_ID: "CCUSTOM",
  });
  assert.equal(config.rpcUrl, "https://rpc.example.com");
  assert.equal(config.networkPassphrase, "Custom Passphrase");
  assert.equal(config.mandatePolicyId, "CCUSTOM");
});

test("blank contract ids are tolerated at load time", () => {
  const config = loadConfigFromEnv({ SUBRAILS_NETWORK: "testnet" });
  assert.equal(config.mandatePolicyId, "");
  assert.equal(config.mandateRegistryId, "");
});

test("an unknown network is rejected", () => {
  assert.throws(() => loadConfigFromEnv({ SUBRAILS_NETWORK: "futurenet" }), InvalidConfigError);
  assert.throws(() => loadConfigFromEnv({}), InvalidConfigError);
});

test("an invalid protocol27 value is rejected", () => {
  assert.throws(
    () => loadConfigFromEnv({ SUBRAILS_NETWORK: "testnet", SUBRAILS_PROTOCOL27: "yes" }),
    InvalidConfigError,
  );
});

test("requireFilled rejects blank contract ids at point of use", () => {
  assert.throws(() => requireFilled("  ", "MANDATE_POLICY_ID"), InvalidConfigError);
  assert.doesNotThrow(() => requireFilled("CCUSTOM", "MANDATE_POLICY_ID"));
});
