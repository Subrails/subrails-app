/**
 * Subrails indexer entry point.
 *
 * - Applies the schema and starts the read-only API.
 * - Runs one ingest pass immediately, then polls `getEvents` every
 *   `INDEXER_POLL_INTERVAL_MS` (default 5 s), persisting the last processed
 *   ledger so restarts resume cleanly.
 * - A failed ingest run is logged and retried on the next tick; the process
 *   stays up.
 */

import { serve } from "@hono/node-server";
import { rpc } from "@stellar/stellar-sdk";

import { createApi } from "./api/server.ts";
import { loadIndexerConfig } from "./config.ts";
import { Db } from "./db/client.ts";
import { Ingester } from "./ingest.ts";
import { logger } from "./logging.ts";

async function main(): Promise<void> {
  const config = loadIndexerConfig();

  const db = new Db(config.databaseUrl);
  await db.init();
  logger.info("indexer schema ready");

  const server = new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
  const ingester = new Ingester(server, db, config);

  const api = createApi(db);
  const httpServer = serve({ fetch: api.fetch, port: config.apiPort }, (info) => {
    logger.info({ port: info.port }, "read API listening");
  });

  let running = true;
  const tick = async (): Promise<void> => {
    if (!running) {
      return;
    }
    try {
      const summary = await ingester.runOnce();
      if (summary.processed > 0) {
        logger.info(
          { fromLedger: summary.fromLedger, toLedger: summary.toLedger, processed: summary.processed },
          "ingested events",
        );
      }
    } catch (cause) {
      // Keep the last committed ledger; retry on the next tick.
      logger.error({ err: cause }, "ingest run failed; will retry");
    }
  };

  await tick();
  const timer = setInterval(() => void tick(), config.pollIntervalMs);
  timer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    if (!running) {
      return;
    }
    running = false;
    logger.info({ signal }, "shutting down");
    clearInterval(timer);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((cause) => {
  logger.fatal({ err: cause }, "indexer failed to start");
  process.exit(1);
});
