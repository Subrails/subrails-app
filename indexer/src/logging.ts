/**
 * Structured logger for the indexer service paths.
 *
 * pino writes JSON lines; the level can be tuned with LOG_LEVEL. Service
 * paths must log through this logger, never `console.log`.
 */
import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
