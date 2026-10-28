import { serve } from "@hono/node-server";
import { createApp } from "../app.js";
import { loadConfig, redactConfig } from "../config/load.js";
import type { ConfigInput } from "../config/schema.js";
import { createSqliteRepository } from "../db/index.js";
import { createLogger, type Logger } from "../logger.js";

/**
 * `notify run` — the default command. Loads config, logs a redacted
 * snapshot, opens the SQLite repository, builds the Hono app and
 * boots `@hono/node-server`. Registers SIGTERM / SIGINT handlers so
 * the HTTP server and the database handle close cleanly on container
 * shutdown.
 */

export type RunFlags = ConfigInput;

export type RunDeps = {
    logger?: Logger;
};

export async function runCommand(
    flags: RunFlags,
    deps: RunDeps = {},
): Promise<void> {
    const bootstrapLogger = deps.logger ?? createLogger("info");

    const config = await loadConfig({
        flags,
        env: process.env,
        logger: bootstrapLogger,
    });

    // Re-create the logger at the configured level so the rest of
    // startup honors `logLevel`.
    const logger = deps.logger ?? createLogger(config.logLevel);
    logger.info("notify server starting", { config: redactConfig(config) });

    const repository = createSqliteRepository(config.databasePath, logger);

    const app = createApp({
        config,
        repository,
        fetch: globalThis.fetch,
        logger,
    });

    const server = serve({
        fetch: app.fetch,
        hostname: config.host,
        port: config.port,
    });

    logger.info("server listening", {
        host: config.host,
        port: config.port,
    });

    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals): void => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        logger.info("received shutdown signal", { signal });
        server.close((err) => {
            if (err) {
                logger.error("http server close error", {
                    error: err.message,
                });
            }
            try {
                repository.close();
            } catch (closeErr) {
                logger.error("repository close error", {
                    error:
                        closeErr instanceof Error
                            ? closeErr.message
                            : String(closeErr),
                });
            }
            process.exit(0);
        });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}
