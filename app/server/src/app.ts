import { failure, type Device } from "@notify/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import type { Config } from "./config/schema.js";
import type { DeviceRepository } from "./db/index.js";
import type { Logger } from "./logger.js";
import { createDeviceRoutes } from "./routes/device.js";
import { createHealthRoutes } from "./routes/health.js";
import { createKeysRoutes } from "./routes/keys.js";
import { createNotifyRoutes } from "./routes/notify.js";
import { createStaticHandler } from "./static-files.js";

/**
 * Dependencies injected into `createApp`. The hybrid DI shape from
 * briefing §1: closures carry config/repository/fetch/logger so sub-apps
 * can be built once, while per-request auth results travel through
 * typed Hono context variables (see `AppVariables`).
 */
export type AppDeps = {
    config: Config;
    repository: DeviceRepository;
    fetch: typeof fetch;
    logger: Logger;
};

/**
 * Context variables set by middleware and read by downstream handlers.
 * `device` is populated by `validateDeviceSecret` after a successful
 * secret match, so the per-device-id routes do not re-query the DB.
 */
export type AppVariables = {
    device: Device;
};

/**
 * Build an isolated Hono app from the injected dependencies. The
 * middleware order mirrors the legacy backend (log → optional CORS →
 * API routes → onError), plus a static-files fallback when a frontend
 * directory is configured.
 */
export function createApp(deps: AppDeps) {
    const app = new Hono<{ Variables: AppVariables }>();

    // Request logging via the hono-provided logger. The hono logger
    // calls back with one string per log line; feed it into our
    // structured logger as an info message.
    app.use("*", honoLogger((msg: string) => deps.logger.info(msg)));

    if (deps.config.cors) {
        app.use("*", cors());
    }

    // Global error handler: produces the `internal_error` envelope and
    // mirrors the legacy `util/oakreturn.ts` headers.
    app.onError((err, c) => {
        deps.logger.error("unhandled error", {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        return c.json(
            failure("internal_error", "An internal error occurred"),
            500,
            { "Cache-Control": "no-cache" },
        );
    });

    app.route("/api/device", createDeviceRoutes(deps));
    app.route("/api/keys", createKeysRoutes(deps));
    app.route("/api/notify", createNotifyRoutes(deps));
    app.route("/api/health", createHealthRoutes(deps));

    // Serve the built frontend when configured. The handler returns
    // next() for non-matching requests, so `/api/*` is unaffected.
    if (deps.config.frontend) {
        app.use(
            "*",
            createStaticHandler({
                root: deps.config.frontend,
                logger: deps.logger,
            }),
        );
    }

    return app;
}
