/**
 * Indexer configuration, read from the environment.
 *
 * See `.env.example` at the workspace root for the full list. Contract ids
 * are placeholders until the contracts are deployed.
 */

/** A minimal object that can stand in for `process.env`. */
export type EnvLike = Record<string, string | undefined>;

export interface IndexerConfig {
  /** Soroban RPC endpoint. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** The mandate-policy contract id (the source of the state events). */
  mandatePolicyId: string;
  /** The mandate-registry contract id (not yet consumed by the ingest filter). */
  mandateRegistryId: string;
  /** Postgres connection string. */
  databaseUrl: string;
  /** Ledger to begin ingesting from; null starts at the current ledger. */
  startLedger: number | null;
  /** Port for the read-only API. */
  apiPort: number;
  /** Delay between ingest polls, in milliseconds. */
  pollIntervalMs: number;
  /** Maximum events per getEvents page. */
  pageSize: number;
}

export const DEFAULT_TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const DEFAULT_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Loads and validates the indexer configuration.
 *
 * @param env - the environment to read (defaults to `process.env`)
 * @throws if DATABASE_URL is missing or a numeric setting is malformed
 */
export function loadIndexerConfig(env: EnvLike = readProcessEnv()): IndexerConfig {
  const databaseUrl = env.DATABASE_URL ?? "";
  if (databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required to run the indexer.");
  }
  const rpcUrl = env.SUBRAILS_RPC_URL ?? DEFAULT_TESTNET_RPC;
  return {
    rpcUrl,
    networkPassphrase: env.SUBRAILS_NETWORK_PASSPHRASE ?? DEFAULT_TESTNET_PASSPHRASE,
    mandatePolicyId: env.MANDATE_POLICY_ID ?? "",
    mandateRegistryId: env.MANDATE_REGISTRY_ID ?? "",
    databaseUrl,
    startLedger: parseOptionalInt(env.INDEXER_START_LEDGER, "INDEXER_START_LEDGER"),
    apiPort: parseOptionalInt(env.INDEXER_API_PORT, "INDEXER_API_PORT") ?? 8080,
    pollIntervalMs: parseOptionalInt(env.INDEXER_POLL_INTERVAL_MS, "INDEXER_POLL_INTERVAL_MS") ?? 5_000,
    pageSize: parseOptionalInt(env.INDEXER_PAGE_SIZE, "INDEXER_PAGE_SIZE") ?? 200,
  };
}

function parseOptionalInt(raw: string | undefined, name: string): number | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${JSON.stringify(raw)}.`);
  }
  return value;
}

function readProcessEnv(): EnvLike {
  return typeof process !== "undefined" ? process.env : {};
}
