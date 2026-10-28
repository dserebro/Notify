import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/cli/run.ts", () => ({ runCommand: vi.fn() }));
vi.mock("../../src/cli/generate.ts", () => ({ generateCommand: vi.fn() }));
vi.mock("../../src/cli/notify-client.ts", () => ({ notifyCommand: vi.fn() }));
vi.mock("../../src/cli/import-devices.ts", () => ({
    importDevicesCommand: vi.fn(),
}));

import { generateCommand } from "../../src/cli/generate.ts";
import { importDevicesCommand } from "../../src/cli/import-devices.ts";
import { createProgram } from "../../src/cli/index.ts";
import { notifyCommand } from "../../src/cli/notify-client.ts";
import { runCommand } from "../../src/cli/run.ts";
import type { Logger } from "../../src/logger.ts";

/**
 * Commander wiring: option -> config-flag mapping for `run` (flag >
 * env > default starts here), the default command, and dispatch of the
 * other subcommands. The subcommand modules are mocked.
 */

const SILENT: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

const parse = (args: string[], logger?: Logger) => {
    const program = createProgram(logger ? { logger } : {});
    program.exitOverride();
    return program.parseAsync(["node", "notify", ...args]);
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe("createProgram", () => {
    it("maps run options to config flags, forwarding only set flags", async () => {
        await parse([
            "run",
            "--port",
            "9000",
            "--host",
            "127.0.0.1",
            "--cors",
            "--sendkey",
            "s",
            "--database",
            "/tmp/x.db",
            "--log-level",
            "debug",
            "--trust-proxy",
        ]);
        expect(runCommand).toHaveBeenCalledWith(
            {
                port: 9000,
                host: "127.0.0.1",
                cors: true,
                sendkey: "s",
                databasePath: "/tmp/x.db",
                logLevel: "debug",
                trustProxy: true,
            },
            { logger: undefined },
        );
    });

    it("runs `run` by default and forwards an injected logger", async () => {
        await parse([], SILENT);
        expect(runCommand).toHaveBeenCalledWith({}, { logger: SILENT });
    });

    it("dispatches notify with the default remote", async () => {
        await parse(["notify", "-t", "T", "-m", "M", "--tags", "a,b"]);
        expect(notifyCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "T",
                message: "M",
                tags: "a,b",
                remote: "http://localhost:8787",
            }),
        );
    });

    it("rejects notify without the required options", async () => {
        const stderr = vi
            .spyOn(process.stderr, "write")
            .mockImplementation(() => true);
        await expect(parse(["notify", "-t", "T"])).rejects.toThrow();
        expect(notifyCommand).not.toHaveBeenCalled();
        stderr.mockRestore();
    });

    it("dispatches generate and import-devices", async () => {
        await parse(["generate"]);
        expect(generateCommand).toHaveBeenCalledTimes(1);

        await parse(
            ["import-devices", "devices.json", "--database", "/d.db"],
            SILENT,
        );
        expect(importDevicesCommand).toHaveBeenCalledWith(
            "devices.json",
            { database: "/d.db" },
            { logger: SILENT },
        );
    });
});
