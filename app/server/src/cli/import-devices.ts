import { readFileSync } from "node:fs";
import { type Device, DeviceSchema } from "@notify/shared";
import { loadConfig } from "../config/load.js";
import { createSqliteRepository } from "../db/index.js";
import { createLogger, type Logger } from "../logger.js";

/**
 * `notify import-devices <file>` — bulk-load devices exported from
 * the legacy Deno KV layer (see `scripts/export-deno-kv.ts`) into the
 * new SQLite database.
 *
 * Each entry is validated with `DeviceSchema`; new rows are `imported`,
 * rows whose `id` already exists are `updated` (secret + pushData are
 * overwritten with the imported values — intended for one-time migration);
 * malformed rows are counted as `failed` and reported but don't abort the batch.
 *
 * The legacy PATCH defect (decision 13) stored the raw `Authorization`
 * header as the secret, so rotated devices carry `Bearer <32hex>`; that
 * prefix is stripped before validation so those devices are not lost.
 */

export type ImportDevicesOptions = {
    database?: string;
};

export type ImportDevicesDeps = {
    logger?: Logger;
};

export type ImportDevicesResult = {
    imported: number;
    updated: number;
    failed: number;
};

/**
 * Permissive input shape coming off disk. We fill `createdAt` /
 * `updatedAt` with `Date.now()` when missing (the legacy KV export
 * had no timestamps), then hand the row to `DeviceSchema` for the
 * strict check.
 */
type RawDevice = Partial<Device> & { createdAt?: number; updatedAt?: number };

const LEGACY_BEARER_PREFIX = "Bearer ";

export async function importDevicesCommand(
    file: string,
    opts: ImportDevicesOptions,
    deps: ImportDevicesDeps = {},
): Promise<ImportDevicesResult> {
    const logger = deps.logger ?? createLogger("info");

    const config = await loadConfig({
        flags: opts.database ? { databasePath: opts.database } : {},
        env: process.env,
        logger,
    });

    const text = readFileSync(file, "utf8");
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`import file is not valid JSON: ${detail}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error("import file must contain a JSON array of devices");
    }

    const repo = createSqliteRepository(config.databasePath, logger);
    const result: ImportDevicesResult = {
        imported: 0,
        updated: 0,
        failed: 0,
    };

    try {
        for (const [index, raw] of parsed.entries()) {
            const now = Date.now();
            const candidate: RawDevice = {
                ...(raw as RawDevice),
                createdAt: (raw as RawDevice)?.createdAt ?? now,
                updatedAt: (raw as RawDevice)?.updatedAt ?? now,
            };
            if (
                typeof candidate.secret === "string" &&
                candidate.secret.startsWith(LEGACY_BEARER_PREFIX)
            ) {
                candidate.secret = candidate.secret.slice(
                    LEGACY_BEARER_PREFIX.length,
                );
                logger.info("repaired legacy 'Bearer ' device secret", {
                    index,
                    id: candidate.id,
                });
            }
            const check = DeviceSchema.safeParse(candidate);
            if (!check.success) {
                result.failed += 1;
                logger.warn("skipping invalid device row", {
                    index,
                    issues: check.error.issues.map((i) => ({
                        path: i.path.join("."),
                        message: i.message,
                    })),
                });
                continue;
            }
            const device: Device = check.data;
            if (repo.exists(device.id)) {
                repo.update(device.id, {
                    pushData: device.pushData,
                    secret: device.secret,
                });
                result.updated += 1;
            } else {
                repo.create(device);
                result.imported += 1;
            }
        }
    } finally {
        repo.close();
    }

    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
}
