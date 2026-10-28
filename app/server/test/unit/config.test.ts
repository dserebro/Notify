import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, redactConfig } from "../../src/config/load.ts";
import type { Logger } from "../../src/logger.ts";
import { TEST_VAPID_KEY } from "../fixtures/scenarios.ts";

/**
 * `loadConfig` precedence (flag > env > default), VAPID auto-generation
 * with persistence, and the `redactConfig` snapshot. Every test runs
 * against a fresh temp directory, so files written by one case cannot
 * leak into another.
 */

const SILENT_LOGGER: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

let dataDir = "";

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notify-config-"));
});

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
});

const dbPath = (): string => join(dataDir, "notify.db");

describe("loadConfig precedence", () => {
    it("uses defaults when nothing is set", async () => {
        const config = await loadConfig({
            env: { DATABASE_PATH: dbPath() },
            logger: SILENT_LOGGER,
        });
        expect(config.port).toBe(8787);
        expect(config.host).toBe("0.0.0.0");
        expect(config.cors).toBe(false);
        expect(config.sendkey).toBeNull();
        expect(config.loginkey).toBeNull();
    });

    it("env overrides defaults", async () => {
        const config = await loadConfig({
            env: {
                DATABASE_PATH: dbPath(),
                PORT: "9191",
                HOST: "127.0.0.1",
                CORS: "true",
                SENDKEY: "env-send",
                LOGINKEY: "env-login",
                SUB: "mailto:env@example.com",
                VAPID_KEY: TEST_VAPID_KEY,
            },
            logger: SILENT_LOGGER,
        });
        expect(config.port).toBe(9191);
        expect(config.host).toBe("127.0.0.1");
        expect(config.cors).toBe(true);
        expect(config.sendkey).toBe("env-send");
        expect(config.loginkey).toBe("env-login");
        expect(config.sub).toBe("mailto:env@example.com");
        expect(config.vapidKey).toBe(TEST_VAPID_KEY);
    });

    it("flags override env", async () => {
        const config = await loadConfig({
            env: {
                DATABASE_PATH: dbPath(),
                PORT: "9191",
                SENDKEY: "env-send",
                VAPID_KEY: TEST_VAPID_KEY,
            },
            flags: {
                port: 7000,
                sendkey: "flag-send",
            },
            logger: SILENT_LOGGER,
        });
        expect(config.port).toBe(7000);
        expect(config.sendkey).toBe("flag-send");
        // env values with no flag override are preserved
        expect(config.vapidKey).toBe(TEST_VAPID_KEY);
    });
});

describe("VAPID auto-generation", () => {
    it("writes vapid.json on first run and reuses it on the second", async () => {
        const vapidFile = join(dataDir, "vapid.json");
        expect(existsSync(vapidFile)).toBe(false);

        const first = await loadConfig({
            env: { DATABASE_PATH: dbPath() },
            logger: SILENT_LOGGER,
        });
        expect(existsSync(vapidFile)).toBe(true);
        const stored = JSON.parse(readFileSync(vapidFile, "utf8")) as {
            vapidKey: string;
            createdAt: string;
        };
        expect(stored.vapidKey).toBe(first.vapidKey);
        expect(stored.createdAt).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        );

        const second = await loadConfig({
            env: { DATABASE_PATH: dbPath() },
            logger: SILENT_LOGGER,
        });
        expect(second.vapidKey).toBe(first.vapidKey);
    });

    it("honors an explicitly configured key over vapid.json", async () => {
        // Seed vapid.json with a (generated) key by one run,
        await loadConfig({
            env: { DATABASE_PATH: dbPath() },
            logger: SILENT_LOGGER,
        });
        // Then a run with VAPID_KEY set uses the configured key.
        const config = await loadConfig({
            env: {
                DATABASE_PATH: dbPath(),
                VAPID_KEY: TEST_VAPID_KEY,
            },
            logger: SILENT_LOGGER,
        });
        expect(config.vapidKey).toBe(TEST_VAPID_KEY);
    });
});

describe("VAPID key validation", () => {
    it("rejects a base64url key that the runtime atob() cannot decode", async () => {
        await expect(
            loadConfig({
                env: {
                    DATABASE_PATH: dbPath(),
                    VAPID_KEY: "eyJhIjoiPz8_Pj4-In0",
                },
                logger: SILENT_LOGGER,
            }),
        ).rejects.toThrow(/not valid base64/);
    });
});

describe("VAPID validation failures", () => {
    const b64 = (value: unknown): string =>
        Buffer.from(JSON.stringify(value), "utf8").toString("base64");
    const vapidFile = (): string => join(dataDir, "vapid.json");
    const load = (env: Record<string, string> = {}) =>
        loadConfig({
            env: { DATABASE_PATH: dbPath(), ...env },
            logger: SILENT_LOGGER,
        });

    it.each([
        [
            "raw non-base64 string",
            "!!!",
            /vapid key (is not valid base64|does not decode to JSON)/,
        ],
        [
            "base64 of non-JSON text",
            Buffer.from("not json").toString("base64"),
            /does not decode to JSON/,
        ],
        ["base64 of a JSON array", b64([1, 2, 3]), /must be a JSON object/],
        ["base64 of a JSON string", b64("hello"), /must be a JSON object/],
        [
            "base64 of a non-P-256 JWK",
            b64({ kty: "oct", k: "abc" }),
            /not a P-256 ECDSA private JWK/,
        ],
    ])("rejects VAPID_KEY that is a %s", async (_label, key, message) => {
        await expect(load({ VAPID_KEY: key })).rejects.toThrow(message);
    });

    it("rejects a vapid.json that is not valid JSON and leaves it untouched", async () => {
        writeFileSync(vapidFile(), "{broken");
        await expect(load()).rejects.toThrow(
            /vapid key file is not valid JSON/,
        );
        expect(readFileSync(vapidFile(), "utf8")).toBe("{broken");
    });

    it("rejects a vapid.json missing vapidKey/createdAt", async () => {
        const content = JSON.stringify({ vapidKey: TEST_VAPID_KEY });
        writeFileSync(vapidFile(), content);
        await expect(load()).rejects.toThrow(
            /missing "vapidKey" or "createdAt"/,
        );
        expect(readFileSync(vapidFile(), "utf8")).toBe(content);
    });

    it("rejects an unreadable vapid.json", async () => {
        mkdirSync(vapidFile());
        await expect(load()).rejects.toThrow(/failed to read/);
    });

    it("rejects a vapid.json whose stored key is invalid", async () => {
        const content = JSON.stringify({
            vapidKey: b64({ kty: "oct", k: "abc" }),
            createdAt: new Date().toISOString(),
        });
        writeFileSync(vapidFile(), content);
        await expect(load()).rejects.toThrow(/not a P-256 ECDSA private JWK/);
        expect(readFileSync(vapidFile(), "utf8")).toBe(content);
    });

    it("rejects a corrupt vapid.json even when a valid key is configured", async () => {
        writeFileSync(vapidFile(), "{broken");
        await expect(load({ VAPID_KEY: TEST_VAPID_KEY })).rejects.toThrow(
            /vapid key file is not valid JSON/,
        );
    });
});

describe("redactConfig", () => {
    it("masks every secret-ish field", async () => {
        const config = await loadConfig({
            env: {
                DATABASE_PATH: dbPath(),
                VAPID_KEY: TEST_VAPID_KEY,
                SENDKEY: "send-token-abc",
                LOGINKEY: "login-token-xyz",
            },
            logger: SILENT_LOGGER,
        });
        const redacted = redactConfig(config);
        expect(redacted.vapidKey).toBe(
            `*** (set, len=${TEST_VAPID_KEY.length})`,
        );
        expect(redacted.sendkey).toBe("*** (set, len=14)");
        expect(redacted.loginkey).toBe("*** (set, len=15)");
        expect(redacted.port).toBe(8787);
        // Nothing holding the raw secrets:
        expect(JSON.stringify(redacted)).not.toContain(TEST_VAPID_KEY);
        expect(JSON.stringify(redacted)).not.toContain("send-token-abc");
        expect(JSON.stringify(redacted)).not.toContain("login-token-xyz");
    });

    it("keeps null entries for unset secret-ish fields", async () => {
        const config = await loadConfig({
            env: { DATABASE_PATH: dbPath() },
            logger: SILENT_LOGGER,
        });
        const redacted = redactConfig(config);
        expect(redacted.sendkey).toBeNull();
        expect(redacted.loginkey).toBeNull();
    });
});
