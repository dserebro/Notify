import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverClose = vi.fn((cb: (err?: Error) => void) => cb());
vi.mock("@hono/node-server", () => ({
    serve: vi.fn(() => ({ close: serverClose })),
}));

const repoClose = vi.fn();
vi.mock("../../src/db/index.ts", () => ({
    createSqliteRepository: vi.fn(() => ({ close: repoClose })),
}));

import { runCommand } from "../../src/cli/run.ts";
import type { Logger } from "../../src/logger.ts";
import { TEST_VAPID_KEY } from "../fixtures/scenarios.ts";

/**
 * `notify run` graceful shutdown: SIGTERM/SIGINT close the HTTP server
 * and the repository, then exit 0; a second signal is ignored; a server
 * close error is logged and the repository still closes.
 */

let dataDir = "";
let handlers: Map<string, (signal: NodeJS.Signals) => void>;
let errors: string[];
let logger: Logger;

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notify-run-"));
    handlers = new Map();
    errors = [];
    logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (msg) => errors.push(msg),
    };
    vi.spyOn(process, "on").mockImplementation(((
        event: string,
        fn: (signal: NodeJS.Signals) => void,
    ) => {
        handlers.set(event, fn);
        return process;
    }) as typeof process.on);
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    serverClose.mockClear();
    repoClose.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
});

const start = () =>
    runCommand(
        { databasePath: join(dataDir, "notify.db"), vapidKey: TEST_VAPID_KEY },
        { logger },
    );

describe("runCommand shutdown", () => {
    it("registers SIGTERM and SIGINT handlers", async () => {
        await start();
        expect(handlers.has("SIGTERM")).toBe(true);
        expect(handlers.has("SIGINT")).toBe(true);
    });

    it("closes the server and repository, then exits 0", async () => {
        await start();
        handlers.get("SIGTERM")?.("SIGTERM");
        expect(serverClose).toHaveBeenCalledTimes(1);
        expect(repoClose).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
    });

    it("ignores a second signal", async () => {
        await start();
        handlers.get("SIGINT")?.("SIGINT");
        handlers.get("SIGTERM")?.("SIGTERM");
        expect(serverClose).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledTimes(1);
    });

    it("logs a server close error and still closes the repository", async () => {
        serverClose.mockImplementationOnce((cb) => cb(new Error("busy")));
        await start();
        handlers.get("SIGTERM")?.("SIGTERM");
        expect(errors).toContain("http server close error");
        expect(repoClose).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
    });
});
