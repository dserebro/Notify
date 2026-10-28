import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppDeps } from "../../src/app.ts";
import { createApp } from "../../src/app.ts";
import type { Config } from "../../src/config/schema.ts";
import { ConfigSchema } from "../../src/config/schema.ts";
import type { DeviceRepository } from "../../src/db/index.ts";
import { createSqliteRepository } from "../../src/db/sqlite.ts";
import type { Logger } from "../../src/logger.ts";
import {
    TEST_LOGINKEY,
    TEST_SENDKEY,
    TEST_SUB,
    TEST_VAPID_KEY,
} from "../fixtures/scenarios.ts";

/**
 * Shared test harness for the API tests.
 *
 * Each test case allocates a brand-new temp directory, writes the
 * SQLite file into it, builds an app from a stubbed `fetch`, and uses
 * `app.request(...)` for in-process HTTP. Teardown closes the DB and
 * deletes the directory so tests cannot leak files or state.
 */

export const SILENT_LOGGER: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

export type HarnessOpts = {
    sendkey?: string | null;
    loginkey?: string | null;
    cors?: boolean;
    frontend?: string | null;
    /** Stub for `globalThis.fetch` used by `notifyAll` -> `sendPush`. */
    fetch?: typeof fetch;
};

export type Harness = {
    config: Config;
    repository: DeviceRepository;
    app: ReturnType<typeof createApp>;
    deps: AppDeps;
    dataDir: string;
    teardown: () => void;
};

/** Build a config with sensible defaults for API tests. */
export function makeConfig(dataDir: string, opts: HarnessOpts = {}): Config {
    return ConfigSchema.parse({
        port: 8787,
        host: "127.0.0.1",
        vapidKey: TEST_VAPID_KEY,
        sub: TEST_SUB,
        cors: opts.cors ?? false,
        frontend: opts.frontend ?? null,
        sendkey: opts.sendkey === undefined ? TEST_SENDKEY : opts.sendkey,
        loginkey: opts.loginkey === undefined ? null : opts.loginkey,
        databasePath: join(dataDir, "notify.db"),
        logLevel: "error",
        trustProxy: false,
    });
}

const defaultStubFetch: typeof fetch = async () =>
    new Response("", { status: 201 });

/** Create a harness with an isolated DB and app. Always call teardown. */
export function makeHarness(opts: HarnessOpts = {}): Harness {
    const dataDir = mkdtempSync(join(tmpdir(), "notify-api-"));
    const config = makeConfig(dataDir, opts);
    const repository = createSqliteRepository(config.databasePath);
    const deps: AppDeps = {
        config,
        repository,
        fetch: opts.fetch ?? defaultStubFetch,
        logger: SILENT_LOGGER,
    };
    const app = createApp(deps);
    const teardown = (): void => {
        repository.close();
        rmSync(dataDir, { recursive: true, force: true });
    };
    return { config, repository, app, deps, dataDir, teardown };
}

/** Convenience: Bearer <token> header object. */
export function bearer(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` };
}

export { TEST_LOGINKEY, TEST_SENDKEY };
