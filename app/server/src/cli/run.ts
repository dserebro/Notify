import { loadConfig, redactConfig } from "../config/load.js";
import type { Config, ConfigInput } from "../config/schema.js";
import { createSqliteRepository, type DeviceRepository } from "../db/index.js";
import { createLogger, type Logger } from "../logger.js";

/**
 * `notify run` — the default command. Loads config, logs a redacted
 * snapshot, opens the SQLite repository, and then calls the HTTP
 * startup path.
 *
 * The HTTP wiring (`createApp` + `@hono/node-server`) is being built
 * in a concurrent task that owns `src/webpush/*` and `src/app.ts`.
 * To avoid a merge race, this file stops at a `startServer(deps)`
 * stub and logs a warning. Once the other task lands, that stub is
 * replaced with the real server bootstrap in a follow-up change.
 */

export type RunFlags = ConfigInput;

export type RunDeps = {
    logger?: Logger;
};

export type StartServerDeps = {
    config: Config;
    repository: DeviceRepository;
    logger: Logger;
};

/**
 * Placeholder for the HTTP bootstrap. Replaced with the real
 * `createApp` + `serve` call once `src/app.ts` lands.
 */
export function startServer(_deps: StartServerDeps): never {
    throw new Error("TODO: wire createApp(...)");
}

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

    try {
        logger.warn(
            "http server wiring is pending; createApp will be wired " +
                "in a follow-up task",
        );
        startServer({ config, repository, logger });
    } catch (err) {
        // The stub throws by design today. Close the repository so a
        // real run of the stub-only CLI doesn't leak the handle.
        repository.close();
        throw err;
    }
}
