import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importDevicesCommand } from "../../src/cli/import-devices.ts";
import { createSqliteRepository } from "../../src/db/sqlite.ts";
import type { Logger } from "../../src/logger.ts";
import {
    TEST_PUSH_DATA,
    TEST_PUSH_DATA_2,
    TEST_VAPID_KEY,
} from "../fixtures/scenarios.ts";

/**
 * `notify import-devices <file>` happy and failure paths. Each run gets
 * a fresh temp directory for the DB and the input JSON, and the config
 * loader is forced to read the right DB with `--database`.
 */

const SILENT_LOGGER: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

let dataDir = "";
let originalVapid: string | undefined;

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notify-import-"));
    // Ensure config.loadConfig picks up TEST_VAPID_KEY so no key is
    // generated for the import DB. Save/restore so cross-test isolation
    // is preserved.
    originalVapid = process.env.VAPID_KEY;
    process.env.VAPID_KEY = TEST_VAPID_KEY;
});

afterEach(() => {
    if (originalVapid === undefined) {
        delete process.env.VAPID_KEY;
    } else {
        process.env.VAPID_KEY = originalVapid;
    }
    rmSync(dataDir, { recursive: true, force: true });
});

describe("importDevicesCommand", () => {
    it("imports, upserts and reports counts", async () => {
        const importFile = join(dataDir, "devices.json");
        const dbFile = join(dataDir, "notify.db");

        const entries = [
            {
                id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                secret: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                pushData: TEST_PUSH_DATA,
                createdAt: 1,
                updatedAt: 1,
            },
            {
                id: "cccccccccccccccccccccccccccccccc",
                secret: "dddddddddddddddddddddddddddddddd",
                pushData: TEST_PUSH_DATA_2,
                createdAt: 2,
                updatedAt: 2,
            },
            { not: "a device" },
        ];
        writeFileSync(importFile, JSON.stringify(entries));

        const first = await importDevicesCommand(
            importFile,
            { database: dbFile },
            { logger: SILENT_LOGGER },
        );
        expect(first).toEqual({ imported: 2, updated: 0, failed: 1 });

        const repo = createSqliteRepository(dbFile);
        try {
            expect(repo.listAll()).toHaveLength(2);
            expect(repo.exists(entries[0].id as string)).toBe(true);
            expect(repo.exists(entries[1].id as string)).toBe(true);
        } finally {
            repo.close();
        }

        // Running again upserts: existing rows go into `updated` (their
        // secret and pushData are overwritten with the import file values).
        const second = await importDevicesCommand(
            importFile,
            { database: dbFile },
            { logger: SILENT_LOGGER },
        );
        expect(second).toEqual({ imported: 0, updated: 2, failed: 1 });
    });

    it("repairs legacy 'Bearer <32hex>' secrets from the old PATCH defect", async () => {
        const importFile = join(dataDir, "devices.json");
        const dbFile = join(dataDir, "notify.db");
        const entries = [
            {
                id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                secret: "Bearer ffffffffffffffffffffffffffffffff",
                pushData: TEST_PUSH_DATA,
            },
            {
                id: "11111111111111111111111111111111",
                secret: "Bearer short",
                pushData: TEST_PUSH_DATA_2,
            },
        ];
        writeFileSync(importFile, JSON.stringify(entries));

        const result = await importDevicesCommand(
            importFile,
            { database: dbFile },
            { logger: SILENT_LOGGER },
        );
        expect(result).toEqual({ imported: 1, updated: 0, failed: 1 });

        const repo = createSqliteRepository(dbFile);
        try {
            expect(repo.get(entries[0].id)?.secret).toBe(
                "ffffffffffffffffffffffffffffffff",
            );
            expect(repo.exists(entries[1].id)).toBe(false);
        } finally {
            repo.close();
        }
    });

    it("throws on an input file that isn't a JSON array", async () => {
        const importFile = join(dataDir, "devices.json");
        writeFileSync(importFile, '{"not": "an array"}');
        await expect(
            importDevicesCommand(
                importFile,
                { database: join(dataDir, "notify.db") },
                { logger: SILENT_LOGGER },
            ),
        ).rejects.toThrow(/JSON array/);
    });

    it("throws on invalid JSON", async () => {
        const importFile = join(dataDir, "devices.json");
        writeFileSync(importFile, "{broken json");
        await expect(
            importDevicesCommand(
                importFile,
                { database: join(dataDir, "notify.db") },
                { logger: SILENT_LOGGER },
            ),
        ).rejects.toThrow(/valid JSON/);
    });
});
