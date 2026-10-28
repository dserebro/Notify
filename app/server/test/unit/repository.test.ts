import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Device } from "@notify/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteRepository } from "../../src/db/sqlite.ts";
import {
    TEST_PUSH_DATA,
    TEST_PUSH_DATA_2,
    TEST_PUSH_DATA_3,
} from "../fixtures/scenarios.ts";

/**
 * SQLite repository tests. Each test spins up a fresh file in a temp
 * directory, exercises the public interface, then tears everything
 * down. The `user_version` migration check is run against a brand-new
 * file so the 0 → 1 transition is observable.
 */

let dataDir = "";

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notify-repo-"));
});

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
});

const dbPath = (): string => join(dataDir, "notify.db");

const device = (
    id: string,
    pushData: {
        endpoint: string;
        key: string;
        auth: string;
    },
    overrides: Partial<Device> = {},
): Device => ({
    id,
    secret: id.replaceAll("a", "b"),
    pushData,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
});

describe("createSqliteRepository", () => {
    it("applies migrations once (user_version 0 -> 1)", () => {
        const file = dbPath();
        {
            const db = new Database(file);
            expect(db.pragma("user_version", { simple: true })).toBe(0);
            db.close();
        }
        const repo = createSqliteRepository(file);
        try {
            const db = new Database(file);
            try {
                expect(db.pragma("user_version", { simple: true })).toBe(1);
            } finally {
                db.close();
            }
        } finally {
            repo.close();
        }
    });

    it("is idempotent across reopens (no re-applied migration)", () => {
        createSqliteRepository(dbPath()).close();
        const repo = createSqliteRepository(dbPath());
        try {
            // listAll on a fresh second-open: schema is still there,
            // no error from a double-create.
            expect(repo.listAll()).toEqual([]);
        } finally {
            repo.close();
        }
    });
});

describe("DeviceRepository CRUD", () => {
    it("create/get/exists/delete round-trip", () => {
        const repo = createSqliteRepository(dbPath());
        try {
            const d = device(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                TEST_PUSH_DATA,
            );
            expect(repo.exists(d.id)).toBe(false);
            expect(repo.get(d.id)).toBeNull();

            repo.create(d);
            expect(repo.exists(d.id)).toBe(true);
            const got = repo.get(d.id);
            expect(got).not.toBeNull();
            expect(got?.id).toBe(d.id);
            expect(got?.secret).toBe(d.secret);
            expect(got?.pushData).toEqual(TEST_PUSH_DATA);

            expect(repo.delete(d.id)).toBe(true);
            expect(repo.exists(d.id)).toBe(false);
            expect(repo.get(d.id)).toBeNull();
            expect(repo.delete(d.id)).toBe(false);
        } finally {
            repo.close();
        }
    });

    it("listAll returns rows in insertion order", () => {
        const repo = createSqliteRepository(dbPath());
        try {
            const a = device(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                TEST_PUSH_DATA,
                { createdAt: 100 },
            );
            const b = device(
                "cccccccccccccccccccccccccccccccc",
                TEST_PUSH_DATA_2,
                { createdAt: 200 },
            );
            const c = device(
                "dddddddddddddddddddddddddddddddd",
                TEST_PUSH_DATA_3,
                { createdAt: 150 },
            );
            repo.create(a);
            repo.create(b);
            repo.create(c);
            const ids = repo.listAll().map((d) => d.id);
            expect(ids).toEqual([a.id, c.id, b.id]);
        } finally {
            repo.close();
        }
    });

    it("update patches pushData and/or secret, bumping updated_at", () => {
        const repo = createSqliteRepository(dbPath());
        try {
            const d = device(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                TEST_PUSH_DATA,
                { createdAt: 100, updatedAt: 100 },
            );
            repo.create(d);

            const patched = repo.update(d.id, { pushData: TEST_PUSH_DATA_2 });
            expect(patched).not.toBeNull();
            expect(patched?.pushData).toEqual(TEST_PUSH_DATA_2);
            expect(patched?.secret).toBe(d.secret); // unchanged
            expect(patched?.updatedAt).toBeGreaterThan(d.updatedAt);
            expect(patched?.createdAt).toBe(d.createdAt);

            // Secrets are always 32-char hex per `DeviceSchema`.
            const freshSecret = "fedcba9876543210fedcba9876543210";
            const rotated = repo.update(d.id, { secret: freshSecret });
            expect(rotated?.secret).toBe(freshSecret);
            expect(rotated?.pushData).toEqual(TEST_PUSH_DATA_2);

            const secondSecret = "1111222233334444555566667777cccc";
            const both = repo.update(d.id, {
                secret: secondSecret,
                pushData: TEST_PUSH_DATA_3,
            });
            expect(both?.secret).toBe(secondSecret);
            expect(both?.pushData).toEqual(TEST_PUSH_DATA_3);
        } finally {
            repo.close();
        }
    });

    it("update on an unknown id returns null", () => {
        const repo = createSqliteRepository(dbPath());
        try {
            const result = repo.update("deadbeefdeadbeefdeadbeefdeadbeef", {
                pushData: TEST_PUSH_DATA,
            });
            expect(result).toBeNull();
        } finally {
            repo.close();
        }
    });

    it("listAll skips and logs corrupt rows instead of throwing", () => {
        const file = dbPath();
        const warnings: Record<string, unknown>[] = [];
        const repo = createSqliteRepository(file, {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: (_msg, meta) => warnings.push(meta ?? {}),
            error: () => {},
        });
        try {
            const good = device(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                TEST_PUSH_DATA,
            );
            repo.create(good);
            const raw = new Database(file);
            try {
                raw.prepare(
                    "INSERT INTO devices (id, secret, push_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                ).run(
                    "cccccccccccccccccccccccccccccccc",
                    "dddddddddddddddddddddddddddddddd",
                    "{not json",
                    1,
                    1,
                );
            } finally {
                raw.close();
            }
            expect(repo.listAll().map((d) => d.id)).toEqual([good.id]);
            expect(warnings).toEqual([
                expect.objectContaining({
                    id: "cccccccccccccccccccccccccccccccc",
                }),
            ]);
            expect(() => repo.get("cccccccccccccccccccccccccccccccc")).toThrow(
                /corrupt device row/,
            );
        } finally {
            repo.close();
        }
    });
});
