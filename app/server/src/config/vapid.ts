import type { webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../logger.js";

/**
 * VAPID key resolution and persistence.
 *
 * The server identifies itself to a browser's push service with an
 * ECDSA P-256 key pair encoded as a base64-wrapped JWK (same format
 * as the legacy `VAPID_KEY` env var). The browser pins the key when
 * it subscribes, so losing or rotating it silently invalidates every
 * subscription — see MILESTONE.md decision 4.
 *
 * Precedence (from the briefing + MILESTONE.md §6):
 *   1. A configured key (flag or env) always wins. If a `vapid.json`
 *      file exists and holds a different key, warn so the operator
 *      notices the mismatch, but use the configured key.
 *   2. Otherwise, read `<dataDir>/vapid.json` and return the stored
 *      key. Fail loudly if the file is present but malformed —
 *      silently regenerating it would break every subscriber.
 *   3. Otherwise, generate a new key, write it to disk with mode
 *      0600, and warn that existing subscribers (there shouldn't be
 *      any yet) are lost.
 */

const VAPID_FILE = "vapid.json";

type VapidFile = {
    vapidKey: string;
    createdAt: string;
};

/**
 * Parse a base64-encoded JWK and attempt to import it as an ECDSA
 * P-256 private key. Throws with a message that names the problem so
 * startup fails fast with a readable error.
 */
async function assertValidVapidKey(encoded: string): Promise<void> {
    let json: string;
    try {
        json = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
        throw new Error("vapid key is not valid base64");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error("vapid key does not decode to JSON (JWK expected)");
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        throw new Error("vapid key JWK must be a JSON object");
    }
    try {
        await crypto.subtle.importKey(
            "jwk",
            parsed as webcrypto.JsonWebKey,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"],
        );
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
            `vapid key is not a P-256 ECDSA private JWK: ${detail}`,
        );
    }
}

/**
 * Generate a fresh base64(JWK) VAPID key. Shared by the `generate`
 * CLI command and the auto-persist path below. Algorithm matches the
 * legacy `main.ts` so previously-exported keys stay compatible.
 */
export async function generateVapidKey(): Promise<string> {
    const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    return Buffer.from(JSON.stringify(jwk), "utf8").toString("base64");
}

/**
 * Read `<dataDir>/vapid.json` if it exists. Returns `null` when the
 * file is absent, and throws when it exists but can't be parsed —
 * both to flag disk corruption and to stop a silent key rotation.
 */
function readVapidFile(dataDir: string): VapidFile | null {
    const path = join(dataDir, VAPID_FILE);
    if (!existsSync(path)) {
        return null;
    }
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`failed to read ${path}: ${detail}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`vapid key file is not valid JSON: ${path}`);
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as VapidFile).vapidKey !== "string" ||
        typeof (parsed as VapidFile).createdAt !== "string"
    ) {
        throw new Error(
            `vapid key file is missing "vapidKey" or "createdAt": ${path}`,
        );
    }
    return parsed as VapidFile;
}

/**
 * Write `<dataDir>/vapid.json` atomically-ish with restrictive
 * permissions. The parent is created on demand so a first-run server
 * can bootstrap without out-of-band setup.
 */
function writeVapidFile(dataDir: string, vapidKey: string): void {
    mkdirSync(dataDir, { recursive: true });
    const payload: VapidFile = {
        vapidKey,
        createdAt: new Date().toISOString(),
    };
    const path = join(dataDir, VAPID_FILE);
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, {
        mode: 0o600,
    });
}

export type ResolveVapidKeyOpts = {
    configuredKey: string | null;
    dataDir: string;
    logger: Logger;
};

/**
 * Resolve the final VAPID key per the precedence described at the top
 * of this file. The returned string is the base64(JWK) blob the rest
 * of the pipeline expects.
 */
export async function resolveVapidKey(
    opts: ResolveVapidKeyOpts,
): Promise<string> {
    const { configuredKey, dataDir, logger } = opts;

    if (configuredKey) {
        await assertValidVapidKey(configuredKey);
        const stored = readVapidFile(dataDir);
        if (stored && stored.vapidKey !== configuredKey) {
            logger.warn(
                "configured vapid key differs from the stored " +
                    "vapid.json; using the configured key",
                { dataDir },
            );
        }
        return configuredKey;
    }

    const stored = readVapidFile(dataDir);
    if (stored) {
        await assertValidVapidKey(stored.vapidKey);
        return stored.vapidKey;
    }

    const fresh = await generateVapidKey();
    writeVapidFile(dataDir, fresh);
    logger.warn(
        "generated a new vapid key and wrote it to vapid.json; " +
            "any existing subscribers can no longer receive pushes",
        { dataDir, file: VAPID_FILE },
    );
    return fresh;
}
